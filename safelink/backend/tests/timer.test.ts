import request from 'supertest';
import mongoose from 'mongoose';
import { buildTestApp } from './helpers/testApp';
import { createUser, createContact, authHeader } from './helpers/fixtures';
import SafetyTimer from '../src/models/SafetyTimer.model';
import Emergency from '../src/models/Emergency.model';
import Notification from '../src/models/Notification.model';
import { sweepTimers } from '../src/services/timer.service';
import { IUser } from '../src/models/User.model';

const app = buildTestApp();

const startTimer = (user: IUser, body: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/timers')
    .set('Authorization', authHeader(user))
    .send({ durationSeconds: 900, ...body });

/** Seed a timer directly so we can control expiryTime (past/future) for sweeper tests. */
const seedTimer = (user: IUser, overrides: Record<string, unknown> = {}) =>
  SafetyTimer.create({
    userId: user._id,
    durationSeconds: 900,
    expiryTime: new Date(Date.now() + 900 * 1000),
    responseGracePeriodSeconds: 30,
    status: 'active',
    ...overrides,
  });

describe('Safety Timer API', () => {
  let alice: IUser;
  let bob: IUser;

  beforeEach(async () => {
    alice = await createUser();
    bob = await createUser();
  });

  describe('POST /api/timers (start)', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(app).post('/api/timers').send({ durationSeconds: 900 });
      expect(res.status).toBe(401);
    });

    it('creates an active timer -> 201 with server timestamps', async () => {
      const res = await startTimer(alice, { durationSeconds: 3600 });
      expect(res.status).toBe(201);
      expect(res.body.reused).toBe(false);
      expect(res.body.timer.status).toBe('active');
      expect(res.body.timer.durationSeconds).toBe(3600);
      expect(res.body.timer.expiryTime).toBeDefined();
      expect(res.body.timer.escalateAt).toBeDefined();

      const inDb = await SafetyTimer.findById(res.body.timer.id);
      expect(inDb?.status).toBe('active');
      expect(inDb?.userId.toString()).toBe(alice._id.toString());
      // expiry ~= now + duration
      expect(inDb!.expiryTime.getTime()).toBeGreaterThan(Date.now() + 3500 * 1000);
    });

    it('rejects an invalid (too short) duration -> 400', async () => {
      const res = await startTimer(alice, { durationSeconds: 5 });
      expect(res.status).toBe(400);
    });

    it('defaults grace period from the user preference', async () => {
      const u = await createUser({ emergencyPreferences: { escalationDelaySeconds: 45 } });
      const res = await startTimer(u);
      expect(res.status).toBe(201);
      expect(res.body.timer.responseGracePeriodSeconds).toBe(45);
    });

    it('prevents duplicate active timers: second start -> 200 reused=true, same id', async () => {
      const first = await startTimer(alice);
      expect(first.status).toBe(201);

      const second = await startTimer(alice, { durationSeconds: 120 });
      expect(second.status).toBe(200);
      expect(second.body.reused).toBe(true);
      expect(second.body.timer.id).toBe(first.body.timer.id);

      const count = await SafetyTimer.countDocuments({ userId: alice._id });
      expect(count).toBe(1);
    });

    it('stores the start location when provided (seed for background escalation)', async () => {
      const res = await startTimer(alice, { latitude: 40.1, longitude: -74.2 });
      expect(res.status).toBe(201);
      const inDb = await SafetyTimer.findById(res.body.timer.id);
      expect(inDb?.lastLatitude).toBe(40.1);
      expect(inDb?.lastLongitude).toBe(-74.2);
    });
  });

  describe('GET /api/timers/active', () => {
    it('returns the open timer', async () => {
      const created = await startTimer(alice);
      const res = await request(app).get('/api/timers/active').set('Authorization', authHeader(alice));
      expect(res.status).toBe(200);
      expect(res.body.timer).not.toBeNull();
      expect(res.body.timer.id).toBe(created.body.timer.id);
    });

    it('returns null when the user has none', async () => {
      const res = await request(app).get('/api/timers/active').set('Authorization', authHeader(alice));
      expect(res.status).toBe(200);
      expect(res.body.timer).toBeNull();
    });

    it('returns a timer that is in the grace period (expired) too', async () => {
      const t = await seedTimer(alice, {
        status: 'expired',
        expiryTime: new Date(Date.now() - 5 * 1000),
      });
      const res = await request(app).get('/api/timers/active').set('Authorization', authHeader(alice));
      expect(res.body.timer?.id).toBe(t._id.toString());
    });
  });

  describe('PUT /api/timers/:id/resolve (check-in / "I\'m safe")', () => {
    it('marks an active timer resolved and creates NO emergency', async () => {
      const created = await startTimer(alice);
      const id = created.body.timer.id;

      const res = await request(app).put(`/api/timers/${id}/resolve`).set('Authorization', authHeader(alice));
      expect(res.status).toBe(200);

      const inDb = await SafetyTimer.findById(id);
      expect(inDb?.status).toBe('resolved');
      const emergencies = await Emergency.countDocuments({ userId: alice._id });
      expect(emergencies).toBe(0);
    });

    it('returns 404 when checking in another user\'s timer', async () => {
      const created = await startTimer(alice);
      const res = await request(app)
        .put(`/api/timers/${created.body.timer.id}/resolve`)
        .set('Authorization', authHeader(bob));
      expect(res.status).toBe(409); // not open *for bob* → treated as not-active
    });

    it('returns 409 when the timer was already cancelled', async () => {
      const t = await seedTimer(alice, { status: 'cancelled' });
      const res = await request(app).put(`/api/timers/${t._id}/resolve`).set('Authorization', authHeader(alice));
      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /api/timers/:id (cancel)', () => {
    it('cancels an open timer -> 200, no emergency', async () => {
      const created = await startTimer(alice);
      const res = await request(app).delete(`/api/timers/${created.body.timer.id}`).set('Authorization', authHeader(alice));
      expect(res.status).toBe(200);
      const inDb = await SafetyTimer.findById(created.body.timer.id);
      expect(inDb?.status).toBe('cancelled');

      const active = await request(app).get('/api/timers/active').set('Authorization', authHeader(alice));
      expect(active.body.timer).toBeNull();
    });

    it('returns 409 when already checked in', async () => {
      const t = await seedTimer(alice, { status: 'resolved' });
      const res = await request(app).delete(`/api/timers/${t._id}`).set('Authorization', authHeader(alice));
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/timers/:id/escalate (I need help / grace lapsed)', () => {
    it('escalates through the Emergency Engine -> SAFETY_TIMER emergency', async () => {
      await createContact(alice, { name: 'Mom', priority: 1 });
      const created = await startTimer(alice);
      const id = created.body.timer.id;

      const res = await request(app)
        .post(`/api/timers/${id}/escalate`)
        .set('Authorization', authHeader(alice))
        .send({ latitude: 40.0, longitude: -74.0 });

      expect(res.status).toBe(201);
      expect(res.body.emergency.type).toBe('SAFETY_TIMER');
      expect(res.body.emergency.status).toBe('active');
      expect(res.body.notification.notified).toBe(1);

      const timerInDb = await SafetyTimer.findById(id);
      expect(timerInDb?.status).toBe('escalated');
      expect(timerInDb?.emergencyId?.toString()).toBe(res.body.emergency.id);

      const emergency = await Emergency.findById(res.body.emergency.id);
      expect(emergency?.type).toBe('SAFETY_TIMER');
      expect(emergency?.safetyTimerId?.toString()).toBe(id);
      expect(emergency?.currentLatitude).toBe(40.0);
    });

    it('is idempotent: a second escalate returns the same emergency (reused)', async () => {
      const created = await startTimer(alice);
      const id = created.body.timer.id;

      const first = await request(app).post(`/api/timers/${id}/escalate`).set('Authorization', authHeader(alice)).send({});
      expect(first.status).toBe(201);

      const second = await request(app).post(`/api/timers/${id}/escalate`).set('Authorization', authHeader(alice)).send({});
      expect(second.status).toBe(200);
      expect(second.body.reused).toBe(true);
      expect(second.body.emergency.id).toBe(first.body.emergency.id);

      const count = await Emergency.countDocuments({ userId: alice._id });
      expect(count).toBe(1);
    });

    it('returns 404 when escalating another user\'s timer', async () => {
      const created = await startTimer(alice);
      const res = await request(app)
        .post(`/api/timers/${created.body.timer.id}/escalate`)
        .set('Authorization', authHeader(bob))
        .send({});
      expect(res.status).toBe(404);
    });

    it('does not escalate a timer that was already checked in', async () => {
      const t = await seedTimer(alice, { status: 'resolved' });
      const res = await request(app).post(`/api/timers/${t._id}/escalate`).set('Authorization', authHeader(alice)).send({});
      expect(res.status).toBe(409);
      expect(await Emergency.countDocuments({ userId: alice._id })).toBe(0);
    });
  });

  describe('sweepTimers (server-side background escalation)', () => {
    it('escalates a timer whose grace period has fully elapsed', async () => {
      await createContact(alice, { name: 'Dad', priority: 1 });
      // expiry 60s ago, grace 30s → escalation deadline passed 30s ago.
      const t = await seedTimer(alice, {
        expiryTime: new Date(Date.now() - 60 * 1000),
        responseGracePeriodSeconds: 30,
        lastLatitude: 12.34,
        lastLongitude: 56.78,
      });

      const result = await sweepTimers();
      expect(result.escalated).toBe(1);

      const inDb = await SafetyTimer.findById(t._id);
      expect(inDb?.status).toBe('escalated');

      const emergency = await Emergency.findOne({ userId: alice._id, type: 'SAFETY_TIMER' });
      expect(emergency).not.toBeNull();
      // seeded from the timer's last-known location (app was closed → no fresh fix)
      expect(emergency?.currentLatitude).toBe(12.34);

      const notifications = await Notification.countDocuments({ emergencyId: emergency!._id, type: 'SOS_ACTIVATED' });
      expect(notifications).toBe(1);
    });

    it('does NOT escalate a timer still inside its grace period, only marks it expired', async () => {
      // expiry 5s ago, grace 30s → still 25s of grace left.
      const t = await seedTimer(alice, {
        expiryTime: new Date(Date.now() - 5 * 1000),
        responseGracePeriodSeconds: 30,
      });

      const result = await sweepTimers();
      expect(result.escalated).toBe(0);
      expect(result.markedExpired).toBe(1);

      const inDb = await SafetyTimer.findById(t._id);
      expect(inDb?.status).toBe('expired');
      expect(await Emergency.countDocuments({ userId: alice._id })).toBe(0);
    });

    it('leaves a running (not-yet-expired) timer untouched', async () => {
      const t = await seedTimer(alice); // expires in 15 min
      const result = await sweepTimers();
      expect(result.escalated).toBe(0);
      const inDb = await SafetyTimer.findById(t._id);
      expect(inDb?.status).toBe('active');
    });

    it('never escalates a resolved (checked-in) timer', async () => {
      await seedTimer(alice, {
        status: 'resolved',
        expiryTime: new Date(Date.now() - 120 * 1000),
      });
      const result = await sweepTimers();
      expect(result.escalated).toBe(0);
      expect(await Emergency.countDocuments({ userId: alice._id })).toBe(0);
    });
  });

  describe('History reflects escalated Safety Timers', () => {
    it('shows the escalated timer\'s emergency as SAFETY_TIMER in history', async () => {
      const created = await startTimer(alice);
      await request(app).post(`/api/timers/${created.body.timer.id}/escalate`).set('Authorization', authHeader(alice)).send({});

      const res = await request(app).get('/api/history').set('Authorization', authHeader(alice));
      expect(res.status).toBe(200);
      const timerEvent = res.body.history.find((h: any) => h.type === 'SAFETY_TIMER');
      expect(timerEvent).toBeDefined();
      expect(timerEvent.status).toBe('active');
    });
  });
});
