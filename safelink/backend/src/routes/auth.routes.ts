import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth.middleware';
import User from '../models/User.model';
import { verifyIdToken } from '../services/firebase.service';
import Joi from 'joi';

const router = Router();

const registerSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().min(10).max(15).required(),
  firebaseIdToken: Joi.string().required(),
});

// POST /api/auth/register
router.post('/register', asyncHandler(async (req: AuthRequest, res) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { name, email, phone, firebaseIdToken } = value;

  // Verify the Firebase token
  const decoded = await verifyIdToken(firebaseIdToken);

  // Check if user already exists
  const existing = await User.findOne({ $or: [{ firebaseUid: decoded.uid }, { email }] });
  if (existing) return res.status(409).json({ error: 'Account already exists' });

  const user = await User.create({
    firebaseUid: decoded.uid,
    name,
    email,
    phone,
  });

  return res.status(201).json({
    message: 'Account created successfully',
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
    },
  });
}));

// POST /api/auth/login  (upsert FCM token, sync profile)
router.post('/login', asyncHandler(async (req: AuthRequest, res) => {
  const { firebaseIdToken, fcmToken } = req.body;
  if (!firebaseIdToken) return res.status(400).json({ error: 'firebaseIdToken required' });

  const decoded = await verifyIdToken(firebaseIdToken);
  const user = await User.findOneAndUpdate(
    { firebaseUid: decoded.uid },
    { ...(fcmToken ? { fcmToken } : {}) },
    { new: true }
  );

  if (!user) return res.status(404).json({ error: 'User not found. Please register.' });

  return res.json({
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      profileImage: user.profileImage,
    },
  });
}));

// POST /api/auth/logout  (clear FCM token)
router.post('/logout', verifyFirebaseToken, asyncHandler(async (req: AuthRequest, res) => {
  await User.findByIdAndUpdate(req.user!._id, { $unset: { fcmToken: '' } });
  return res.json({ message: 'Logged out successfully' });
}));

// POST /api/auth/forgot-password  (handled by Firebase client SDK, backend just logs)
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  // Firebase handles password reset emails on the client side
  return res.json({ message: 'If an account exists, a reset email has been sent.' });
}));

export default router;
