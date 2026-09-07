import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth.middleware';
import AiDetectionEvent from '../models/AiDetectionEvent.model';
import User from '../models/User.model';
import Joi from 'joi';

const router = Router();
router.use(verifyFirebaseToken);

// POST /api/ai/detection  — Log a detection event from mobile
router.post('/detection', asyncHandler(async (req: AuthRequest, res) => {
  const schema = Joi.object({
    detectedPhrase: Joi.string().allow('', null),
    detectionType: Joi.string().valid('KEYWORD', 'SCREAM', 'DISTRESS_AUDIO', 'COMBINED').required(),
    confidence: Joi.number().min(0).max(100).required(),
    keywordConfidence: Joi.number().min(0).max(100),
    acousticConfidence: Joi.number().min(0).max(100),
    rawTranscript: Joi.string().allow('', null),
    actionTaken: Joi.string().valid('ALERT_SHOWN', 'SOS_ACTIVATED', 'CANCELLED', 'IGNORED').default('ALERT_SHOWN'),
    emergencyId: Joi.string().allow(null),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  // Determine risk level from confidence
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
  if (value.confidence >= 90) riskLevel = 'CRITICAL';
  else if (value.confidence >= 75) riskLevel = 'HIGH';
  else if (value.confidence >= 50) riskLevel = 'MEDIUM';

  const event = await AiDetectionEvent.create({
    userId: req.user!._id,
    detectedPhrase: value.detectedPhrase,
    detectionType: value.detectionType,
    confidence: value.confidence,
    riskLevel,
    actionTaken: value.actionTaken,
    keywordConfidence: value.keywordConfidence,
    acousticConfidence: value.acousticConfidence,
    rawTranscript: value.rawTranscript,
    emergencyId: value.emergencyId || undefined,
    detectedAt: new Date(),
  });

  return res.status(201).json({ event: { id: event._id, riskLevel, confidence: event.confidence } });
}));

// PUT /api/ai/detection/:id/respond  — User responded (I'm Safe or SOS)
router.put('/detection/:id/respond', asyncHandler(async (req: AuthRequest, res) => {
  const { actionTaken } = req.body;
  if (!['SOS_ACTIVATED', 'CANCELLED'].includes(actionTaken)) {
    return res.status(400).json({ error: 'actionTaken must be SOS_ACTIVATED or CANCELLED' });
  }

  const event = await AiDetectionEvent.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!._id },
    { actionTaken, respondedAt: new Date() },
    { new: true }
  );

  if (!event) return res.status(404).json({ error: 'Detection event not found' });
  return res.json({ message: 'Response recorded', event });
}));

// GET /api/ai/settings  — Get user's AI settings
router.get('/settings', asyncHandler(async (req: AuthRequest, res) => {
  const user = await User.findById(req.user!._id).select('aiSettings');
  return res.json({ settings: user?.aiSettings });
}));

// PUT /api/ai/settings  — Update AI detection settings
router.put('/settings', asyncHandler(async (req: AuthRequest, res) => {
  const schema = Joi.object({
    enabled: Joi.boolean(),
    keywords: Joi.array().items(Joi.string().max(50)).max(50),
    acousticDetection: Joi.boolean(),
    confidenceThreshold: Joi.number().min(50).max(100),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const user = await User.findByIdAndUpdate(
    req.user!._id,
    { $set: { aiSettings: { ...req.user!.aiSettings, ...value } } },
    { new: true }
  );

  return res.json({ settings: user?.aiSettings });
}));

export default router;
