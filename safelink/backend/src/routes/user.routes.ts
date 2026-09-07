import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth.middleware';
import User from '../models/User.model';
import Joi from 'joi';

const router = Router();

router.use(verifyFirebaseToken);

// GET /api/users/me
router.get('/me', asyncHandler(async (req: AuthRequest, res) => {
  const user = req.user!;
  return res.json({
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    profileImage: user.profileImage,
    emergencyPreferences: user.emergencyPreferences,
    aiSettings: user.aiSettings,
    privacySettings: user.privacySettings,
    createdAt: user.createdAt,
  });
}));

const updateSchema = Joi.object({
  name: Joi.string().min(2).max(100),
  phone: Joi.string().min(10).max(15),
  profileImage: Joi.string().uri(),
  fcmToken: Joi.string(),
  emergencyPreferences: Joi.object({
    autoEscalate: Joi.boolean(),
    escalationDelaySeconds: Joi.number().min(10).max(300),
    aiAutoActivate: Joi.boolean(),
    aiConfidenceThreshold: Joi.number().min(50).max(100),
    locationUpdateIntervalNormal: Joi.number().min(10).max(120),
    locationUpdateIntervalEmergency: Joi.number().min(3).max(30),
  }),
  aiSettings: Joi.object({
    enabled: Joi.boolean(),
    keywords: Joi.array().items(Joi.string()),
    acousticDetection: Joi.boolean(),
    confidenceThreshold: Joi.number().min(50).max(100),
  }),
  privacySettings: Joi.object({
    shareLocation: Joi.boolean(),
    shareRecordings: Joi.boolean(),
    dataRetentionDays: Joi.number().min(7).max(365),
  }),
});

// PUT /api/users/me
router.put('/me', asyncHandler(async (req: AuthRequest, res) => {
  const { error, value } = updateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const user = await User.findByIdAndUpdate(
    req.user!._id,
    { $set: value },
    { new: true, runValidators: true }
  );

  return res.json({
    message: 'Profile updated successfully',
    user: {
      id: user!._id,
      name: user!.name,
      email: user!.email,
      phone: user!.phone,
      profileImage: user!.profileImage,
      emergencyPreferences: user!.emergencyPreferences,
      aiSettings: user!.aiSettings,
      privacySettings: user!.privacySettings,
    },
  });
}));

// PUT /api/users/me/password  (Password change is handled client-side by Firebase)
router.put('/me/password', asyncHandler(async (_req: AuthRequest, res) => {
  return res.json({ message: 'Password update handled via Firebase Authentication on the client.' });
}));

export default router;
