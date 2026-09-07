import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth.middleware';
import SafetyTimer, { ISafetyTimer, OPEN_TIMER_STATUSES } from '../models/SafetyTimer.model';
import Emergency from '../models/Emergency.model';
import {
  getOpenTimer,
  escalateTimer,
  escalateAtMs,
  DEFAULT_GRACE_SECONDS,
} from '../services/timer.service';
import Joi from 'joi';

const router = Router();
router.use(verifyFirebaseToken);

/** Public shape of a timer — includes the derived escalation deadline so the client
 *  can drive its countdown from server timestamps without re-deriving the formula. */
const serializeTimer = (t: ISafetyTimer) => ({
  id: t._id,
  status: t.status,
  durationSeconds: t.durationSeconds,
  startedAt: t.createdAt,
  expiryTime: t.expiryTime,
  responseGracePeriodSeconds: t.responseGracePeriodSeconds,
  escalateAt: new Date(escalateAtMs(t)),
  note: t.note,
  destination: t.destination,
  emergencyId: t.emergencyId,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

const serializeEmergency = (e: any) => ({
  id: e._id,
  type: e.type,
  status: e.status,
  riskLevel: e.riskLevel,
  activationSource: e.activationSource,
  currentLatitude: e.currentLatitude,
  currentLongitude: e.currentLongitude,
  currentAddress: e.currentAddress,
  startedAt: e.startedAt,
  endedAt: e.endedAt,
  durationSeconds: e.durationSeconds,
  notifiedContacts: e.notifiedContacts,
});

// POST /api/timers  — Create (start) a safety timer.
// Idempotent: if the user already has an open timer we return it (reused=true) rather
// than starting a second one, matching the emergency engine's duplicate guard (§18).
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const schema = Joi.object({
    durationSeconds: Joi.number().min(60).max(86400).required(),
    note: Joi.string().max(200).allow('', null),
    destination: Joi.string().max(200).allow('', null),
    journeyId: Joi.string().allow(null),
    responseGracePeriodSeconds: Joi.number().min(10).max(120),
    latitude: Joi.number().min(-90).max(90),
    longitude: Joi.number().min(-180).max(180),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const existing = await getOpenTimer(req.user!._id);
  if (existing) {
    return res.status(200).json({
      message: 'Safety Timer already active',
      reused: true,
      timer: serializeTimer(existing),
    });
  }

  const grace =
    value.responseGracePeriodSeconds ??
    req.user!.emergencyPreferences?.escalationDelaySeconds ??
    DEFAULT_GRACE_SECONDS;

  const expiryTime = new Date(Date.now() + value.durationSeconds * 1000);
  const hasCoords = value.latitude != null && value.longitude != null;

  const timer = await SafetyTimer.create({
    userId: req.user!._id,
    durationSeconds: value.durationSeconds,
    expiryTime,
    note: value.note,
    destination: value.destination,
    journeyId: value.journeyId || undefined,
    responseGracePeriodSeconds: grace,
    status: 'active',
    ...(hasCoords
      ? { lastLatitude: value.latitude, lastLongitude: value.longitude, lastLocationAt: new Date() }
      : {}),
  });

  return res.status(201).json({ reused: false, timer: serializeTimer(timer) });
}));

// GET /api/timers/active  — The user's current open timer (for restore / dup-guard).
router.get('/active', asyncHandler(async (req: AuthRequest, res) => {
  const timer = await getOpenTimer(req.user!._id);
  return res.json({ timer: timer ? serializeTimer(timer) : null });
}));

// PUT /api/timers/:id/extend  — Extend an active timer.
router.put('/:id/extend', asyncHandler(async (req: AuthRequest, res) => {
  const { additionalSeconds } = req.body;
  if (!additionalSeconds || additionalSeconds < 60) {
    return res.status(400).json({ error: 'additionalSeconds must be >= 60' });
  }

  const timer = await SafetyTimer.findOne({
    _id: req.params.id,
    userId: req.user!._id,
    status: { $in: OPEN_TIMER_STATUSES },
  });
  if (!timer) return res.status(404).json({ error: 'Active timer not found' });

  const newExpiry = new Date(timer.expiryTime.getTime() + additionalSeconds * 1000);
  const updated = await SafetyTimer.findByIdAndUpdate(
    timer._id,
    { expiryTime: newExpiry, status: 'extended', $inc: { extensions: 1 } },
    { new: true }
  );

  return res.json({ timer: serializeTimer(updated!) });
}));

// PUT /api/timers/:id/resolve  — Check in ("I'm safe"). Only valid while open.
// Never triggers an emergency; simply marks the timer safe (CHECKED_IN).
router.put('/:id/resolve', asyncHandler(async (req: AuthRequest, res) => {
  const timer = await SafetyTimer.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!._id, status: { $in: OPEN_TIMER_STATUSES } },
    { status: 'resolved' },
    { new: true }
  );
  if (!timer) {
    return res.status(409).json({ error: 'Timer is not active — it may have already ended, been cancelled, or escalated.' });
  }
  return res.json({ message: "You're safe — safety timer completed.", timer: serializeTimer(timer) });
}));

// POST /api/timers/:id/escalate  — App-driven escalation ("I need help" or grace lapsed).
// Escalates through the SAME Emergency Engine as Manual SOS. Idempotent.
router.post('/:id/escalate', asyncHandler(async (req: AuthRequest, res) => {
  const schema = Joi.object({
    latitude: Joi.number().min(-90).max(90),
    longitude: Joi.number().min(-180).max(180),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const timer = await SafetyTimer.findOne({ _id: req.params.id, userId: req.user!._id });
  if (!timer) return res.status(404).json({ error: 'Timer not found' });

  const result = await escalateTimer(timer, req.user!, value);

  // Already escalated (by the sweeper or a prior request): return the existing emergency
  // so the client can still hand off to the Emergency Active screen.
  if (!result) {
    if (timer.emergencyId) {
      const existing = await Emergency.findById(timer.emergencyId);
      if (existing) {
        return res.status(200).json({
          message: 'Emergency already active',
          reused: true,
          emergency: serializeEmergency(existing),
        });
      }
    }
    return res.status(409).json({ error: 'Timer is not active and has no linked emergency.' });
  }

  return res.status(result.reused ? 200 : 201).json({
    message: result.reused ? 'Emergency already active' : 'Safety Timer escalated to emergency',
    reused: result.reused,
    emergency: serializeEmergency(result.emergency),
    notification: result.notify,
  });
}));

// DELETE /api/timers/:id  — Cancel an open timer. No emergency is triggered.
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const timer = await SafetyTimer.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!._id, status: { $in: OPEN_TIMER_STATUSES } },
    { status: 'cancelled' },
    { new: true }
  );
  if (!timer) {
    return res.status(409).json({ error: 'Timer is not active — nothing to cancel.' });
  }
  return res.json({ message: 'Timer cancelled' });
}));

export default router;
