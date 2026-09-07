import request from 'supertest';
import mongoose from 'mongoose';
import { buildTestApp } from './helpers/testApp';
import { createUser, createContact, authHeader } from './helpers/fixtures';
import Emergency from '../src/models/Emergency.model';
import Notification from '../src/models/Notification.model';
import { IUser } from '../src/models/User.model';

const app = buildTestApp();

// Helper: activate an emergency for a user and return the parsed body.
const activate = (user: IUser, body: Record<string, unknown> = {}) =>
  request(app).post('/api/emergencies').set('Authorization', authHeader(user)).send(body);

describe('Emergency API', () => {
  let alice: IUser;
  let bob: IUser;

  beforeEach(async () => {
    alice = await createUser();
    bob = await createUser();
  });

  describe('POST /api/emergencies (activate SOS)', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(app).post('/api/emergencies').send({});
      expect(res.status).toBe(401);
    });

    it('creates an active emergency -> 201', async () => {
      const res = await activate(alice, { latitude: 40.1, longitude: -74.2 });
      expect(res.status).toBe(201);
      expect(res.body.reused).toBe(false);
      expect(res.body.emergency.status).toBe('active');
      expect(res.body.emergency.type).toBe('MANUAL_SOS');
      expect(res.body.emergency.id).toBeDefined();

      const inDb = await Emergency.findById(res.body.emergency.id);
      expect(inDb?.status).toBe('active');
      expect(inDb?.userId.toString()).toBe(alice._id.toString());
    });

    it('prevents duplicates: second activation -> 200 reused=true, same id', async () => {
      const first = await activate(alice, { latitude: 40.1, longitude: -74.2 });
      expect(first.status).toBe(201);

      const second = await activate(alice, { latitude: 41.0, longitude: -75.0 });
      expect(second.status).toBe(200);
      expect(second.body.reused).toBe(true);
      expect(second.body.emergency.id).toBe(first.body.emergency.id);

      const count = await Emergency.countDocuments({ userId: alice._id });
      expect(count).toBe(1);
    });
  });

  describe('GET /api/emergencies/active', () => {
    it('returns the open emergency', async () => {
      const created = await activate(alice);
      const res = await request(app)
        .get('/api/emergencies/active')
        .set('Authorization', authHeader(alice));
      expect(res.status).toBe(200);
      expect(res.body.emergency).not.toBeNull();
      expect(res.body.emergency.id).toBe(created.body.emergency.id);
    });

    it('returns null when the user has none', async () => {
      const res = await request(app)
        .get('/api/emergencies/active')
        .set('Authorization', authHeader(alice));
      expect(res.status).toBe(200);
      expect(res.body.emergency).toBeNull();
    });
  });

  describe('GET /api/emergencies/:id (authorization)', () => {
    it('returns the emergency to its owner', async () => {
      const created = await activate(alice);
      const res = await request(app)
        .get(`/api/emergencies/${created.body.emergency.id}`)
        .set('Authorization', authHeader(alice));
      expect(res.status).toBe(200);
      expect(res.body.emergency.id).toBe(created.body.emergency.id);
      expect(res.body.emergency.recording).toBeNull();
    });

    it('returns 404 to a different user', async () => {
      const created = await activate(alice);
      const res = await request(app)
        .get(`/api/emergencies/${created.body.emergency.id}`)
        .set('Authorization', authHeader(bob));
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/emergencies/:id/location', () => {
    it('appends a valid location point -> 200', async () => {
      const created = await activate(alice, { latitude: 40.0, longitude: -74.0 });
      const id = created.body.emergency.id;

      const res = await request(app)
        .post(`/api/emergencies/${id}/location`)
        .set('Authorization', authHeader(alice))
        .send({ latitude: 42.5, longitude: -71.1, accuracy: 5, speed: 1.2 });
      expect(res.status).toBe(200);

      const inDb = await Emergency.findById(id);
      expect(inDb?.currentLatitude).toBe(42.5);
      expect(inDb?.currentLongitude).toBe(-71.1);
      // initial point (from activation) + the appended one
      expect(inDb?.locationHistory.length).toBe(2);
    });

    it('rejects an out-of-range latitude -> 400', async () => {
      const created = await activate(alice, { latitude: 40.0, longitude: -74.0 });
      const res = await request(app)
        .post(`/api/emergencies/${created.body.emergency.id}/location`)
        .set('Authorization', authHeader(alice))
        .send({ latitude: 200, longitude: -71.1 });
      expect(res.status).toBe(400);
    });

    it('returns 404 when a different user tries to append', async () => {
      const created = await activate(alice, { latitude: 40.0, longitude: -74.0 });
      const res = await request(app)
        .post(`/api/emergencies/${created.body.emergency.id}/location`)
        .set('Authorization', authHeader(bob))
        .send({ latitude: 42.5, longitude: -71.1 });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/emergencies/:id/location', () => {
    it('returns the latest location to the owner', async () => {
      const created = await activate(alice, { latitude: 40.0, longitude: -74.0 });
      const id = created.body.emergency.id;
      await request(app)
        .post(`/api/emergencies/${id}/location`)
        .set('Authorization', authHeader(alice))
        .send({ latitude: 42.5, longitude: -71.1 });

      const res = await request(app)
        .get(`/api/emergencies/${id}/location`)
        .set('Authorization', authHeader(alice));
      expect(res.status).toBe(200);
      expect(res.body.latitude).toBe(42.5);
      expect(res.body.longitude).toBe(-71.1);
      expect(Array.isArray(res.body.locationHistory)).toBe(true);
    });

    it('returns 404 to a different user', async () => {
      const created = await activate(alice, { latitude: 40.0, longitude: -74.0 });
      const res = await request(app)
        .get(`/api/emergencies/${created.body.emergency.id}/location`)
        .set('Authorization', authHeader(bob));
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/emergencies/:id/resolve', () => {
    it('resolves an active emergency -> 200 with durationSeconds >= 0', async () => {
      const created = await activate(alice);
      const id = created.body.emergency.id;

      const res = await request(app)
        .put(`/api/emergencies/${id}/resolve`)
        .set('Authorization', authHeader(alice));
      expect(res.status).toBe(200);
      expect(res.body.durationSeconds).toBeGreaterThanOrEqual(0);

      const inDb = await Emergency.findById(id);
      expect(inDb?.status).toBe('resolved');
      expect(inDb?.endedAt).toBeDefined();
    });

    it('returns 404 when resolving another user\'s emergency', async () => {
      const created = await activate(alice);
      const res = await request(app)
        .put(`/api/emergencies/${created.body.emergency.id}/resolve`)
        .set('Authorization', authHeader(bob));
      expect(res.status).toBe(404);
    });

    it('returns 404 for a nonexistent emergency', async () => {
      const res = await request(app)
        .put(`/api/emergencies/${new mongoose.Types.ObjectId()}/resolve`)
        .set('Authorization', authHeader(alice));
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/emergencies/:id/cancel', () => {
    it('cancels an active emergency -> 200', async () => {
      const created = await activate(alice);
      const id = created.body.emergency.id;

      const res = await request(app)
        .post(`/api/emergencies/${id}/cancel`)
        .set('Authorization', authHeader(alice));
      expect(res.status).toBe(200);

      const inDb = await Emergency.findById(id);
      expect(inDb?.status).toBe('cancelled');

      // once cancelled, there is no active emergency to restore
      const active = await request(app)
        .get('/api/emergencies/active')
        .set('Authorization', authHeader(alice));
      expect(active.body.emergency).toBeNull();
    });

    it('returns 404 for another user', async () => {
      const created = await activate(alice);
      const res = await request(app)
        .post(`/api/emergencies/${created.body.emergency.id}/cancel`)
        .set('Authorization', authHeader(bob));
      expect(res.status).toBe(404);
    });
  });

  describe('Contact notification side effect', () => {
    it('persists a Notification per active contact and reports the count', async () => {
      await createContact(alice, { name: 'Mom', priority: 1 });
      await createContact(alice, { name: 'Dad', priority: 2 });
      await createContact(alice, { name: 'Old Number', status: 'inactive' });

      const res = await activate(alice, { latitude: 40.0, longitude: -74.0 });
      expect(res.status).toBe(201);
      // only the 2 ACTIVE contacts are notified
      expect(res.body.notification.notified).toBe(2);
      expect(res.body.notification.totalContacts).toBe(2);
      expect(res.body.emergency.notifiedContacts).toBe(2);

      const notifications = await Notification.find({
        emergencyId: res.body.emergency.id,
        type: 'SOS_ACTIVATED',
      });
      expect(notifications.length).toBe(2);
      expect(notifications.every((n) => n.recipientUserId.toString() === alice._id.toString())).toBe(true);
    });

    it('reports zero notified when the user has no contacts', async () => {
      const res = await activate(alice);
      expect(res.status).toBe(201);
      expect(res.body.notification.notified).toBe(0);
      const notifications = await Notification.countDocuments({ emergencyId: res.body.emergency.id });
      expect(notifications).toBe(0);
    });
  });
});
