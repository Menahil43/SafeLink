import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth.middleware';
import Emergency from '../models/Emergency.model';
import AiDetectionEvent from '../models/AiDetectionEvent.model';
import Recording from '../models/Recording.model';

const router = Router();
router.use(verifyFirebaseToken);

// GET /api/history  — All emergency events for the user
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  const emergencies = await Emergency.find({ userId: req.user!._id })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select('type status riskLevel startedAt endedAt durationSeconds notifiedContacts currentAddress activationSource');

  const total = await Emergency.countDocuments({ userId: req.user!._id });

  const history = emergencies.map((e) => ({
    id: e._id,
    type: e.type,
    status: e.status,
    riskLevel: e.riskLevel,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    durationSeconds: e.durationSeconds,
    notifiedContacts: e.notifiedContacts,
    address: e.currentAddress,
  }));

  return res.json({
    history,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}));

// GET /api/history/:id  — Detailed emergency event
router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const emergency = await Emergency.findOne({
    _id: req.params.id,
    userId: req.user!._id,
  });

  if (!emergency) return res.status(404).json({ error: 'Emergency not found' });

  const [recording, aiEvent] = await Promise.all([
    Recording.findOne({ emergencyId: emergency._id }),
    emergency.aiEventId
      ? AiDetectionEvent.findById(emergency.aiEventId)
      : Promise.resolve(null),
  ]);

  return res.json({
    emergency: {
      id: emergency._id,
      type: emergency.type,
      status: emergency.status,
      riskLevel: emergency.riskLevel,
      activationSource: emergency.activationSource,
      currentAddress: emergency.currentAddress,
      currentLatitude: emergency.currentLatitude,
      currentLongitude: emergency.currentLongitude,
      locationHistory: emergency.locationHistory,
      startedAt: emergency.startedAt,
      endedAt: emergency.endedAt,
      durationSeconds: emergency.durationSeconds,
      notifiedContacts: emergency.notifiedContacts,
      recording: recording
        ? {
            id: recording._id,
            uploadStatus: recording.uploadStatus,
            durationSeconds: recording.durationSeconds,
          }
        : null,
      aiDetection: aiEvent
        ? {
            id: aiEvent._id,
            detectedPhrase: aiEvent.detectedPhrase,
            confidence: aiEvent.confidence,
            detectionType: aiEvent.detectionType,
            actionTaken: aiEvent.actionTaken,
          }
        : null,
    },
  });
}));

export default router;
