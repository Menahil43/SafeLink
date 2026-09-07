import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth.middleware';
import Emergency from '../models/Emergency.model';
import Recording from '../models/Recording.model';
import {
  createEmergency,
  resolveEmergency,
  appendLocation,
  getActiveEmergency,
  getOwnedEmergency,
} from '../services/emergency.service';
import Joi from 'joi';

const router = Router();
router.use(verifyFirebaseToken);

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

// POST /api/emergencies  — Activate SOS (idempotent per active emergency)
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const schema = Joi.object({
    type: Joi.string().valid('MANUAL_SOS', 'AI_DETECTION', 'SAFETY_TIMER', 'ROUTE_DEVIATION', 'OTHER').default('MANUAL_SOS'),
    latitude: Joi.number().min(-90).max(90),
    longitude: Joi.number().min(-180).max(180),
    riskLevel: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL').default('HIGH'),
    aiEventId: Joi.string(),
    journeyId: Joi.string(),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { emergency, reused, notify } = await createEmergency(req.user!, value);

  return res.status(reused ? 200 : 201).json({
    message: reused ? 'Emergency already active' : 'Emergency activated',
    reused,
    emergency: serializeEmergency(emergency),
    notification: notify,
  });
}));

// GET /api/emergencies/active  — The user's current open emergency (for restore / dup-guard)
// NOTE: must be declared before GET /:id so "active" isn't captured as an id.
router.get('/active', asyncHandler(async (req: AuthRequest, res) => {
  const emergency = await getActiveEmergency(req.user!._id);
  return res.json({ emergency: emergency ? serializeEmergency(emergency) : null });
}));

// GET /api/emergencies/:id
router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const emergency = await getOwnedEmergency(req.user!._id, req.params.id);
  if (!emergency) return res.status(404).json({ error: 'Emergency not found' });

  const recording = await Recording.findOne({ emergencyId: emergency._id });

  return res.json({
    emergency: {
      ...serializeEmergency(emergency),
      recording: recording
        ? { id: recording._id, uploadStatus: recording.uploadStatus, durationSeconds: recording.durationSeconds }
        : null,
    },
  });
}));

// PUT /api/emergencies/:id/resolve
router.put('/:id/resolve', asyncHandler(async (req: AuthRequest, res) => {
  const result = await resolveEmergency(req.user!, req.params.id);
  if (!result) return res.status(404).json({ error: 'Active emergency not found' });

  return res.json({
    message: 'Emergency resolved',
    durationSeconds: result.durationSeconds,
    notification: result.notify,
  });
}));

// POST /api/emergencies/:id/cancel  — Cancel a false / accidental activation
router.post('/:id/cancel', asyncHandler(async (req: AuthRequest, res) => {
  const emergency = await Emergency.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!._id, status: { $in: ['activating', 'active'] } },
    { status: 'cancelled', endedAt: new Date() },
    { new: true }
  );

  if (!emergency) return res.status(404).json({ error: 'Emergency not found or already resolved' });
  return res.json({ message: 'Emergency cancelled' });
}));

// POST /api/emergencies/:id/location  — Update live location
router.post('/:id/location', asyncHandler(async (req: AuthRequest, res) => {
  const schema = Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    accuracy: Joi.number().min(0),
    speed: Joi.number(),
    direction: Joi.number().min(0).max(360),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const updated = await appendLocation(req.user!._id, req.params.id, value);
  if (!updated) return res.status(404).json({ error: 'Active emergency not found' });

  return res.json({ message: 'Location updated' });
}));

// GET /api/emergencies/:id/location  — Latest known location (owner only)
router.get('/:id/location', asyncHandler(async (req: AuthRequest, res) => {
  const emergency = await getOwnedEmergency(req.user!._id, req.params.id);
  if (!emergency) return res.status(404).json({ error: 'Emergency not found' });

  return res.json({
    latitude: emergency.currentLatitude,
    longitude: emergency.currentLongitude,
    address: emergency.currentAddress,
    lastUpdated: emergency.updatedAt,
    locationHistory: emergency.locationHistory.slice(-10),
  });
}));

export default router;
