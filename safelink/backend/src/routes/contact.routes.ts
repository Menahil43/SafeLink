import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth.middleware';
import TrustedContact from '../models/TrustedContact.model';
import Joi from 'joi';

const router = Router();
router.use(verifyFirebaseToken);

const contactSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  phone: Joi.string().min(10).max(15).required(),
  email: Joi.string().email().allow('', null),
  relationship: Joi.string().min(1).max(50).required(),
  priority: Joi.number().min(1).max(10).default(1),
  status: Joi.string().valid('active', 'inactive').default('active'),
  avatarColor: Joi.string(),
});

// GET /api/contacts
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const contacts = await TrustedContact.find({
    userId: req.user!._id,
  }).sort({ priority: 1, createdAt: 1 });

  return res.json({ contacts });
}));

// POST /api/contacts
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const { error, value } = contactSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const AVATAR_COLORS = [
    '#7C3AED', '#EF4444', '#22C55E', '#F59E0B', '#3B82F6',
    '#EC4899', '#14B8A6', '#F97316', '#8B5CF6', '#06B6D4',
  ];
  const existingCount = await TrustedContact.countDocuments({ userId: req.user!._id });
  const avatarColor = value.avatarColor || AVATAR_COLORS[existingCount % AVATAR_COLORS.length];

  const contact = await TrustedContact.create({
    userId: req.user!._id,
    ...value,
    avatarColor,
  });

  return res.status(201).json({ message: 'Contact added', contact });
}));

// PUT /api/contacts/:id
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const { error, value } = contactSchema.validate(req.body, { allowUnknown: false });
  if (error) return res.status(400).json({ error: error.details[0].message });

  const contact = await TrustedContact.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!._id },
    { $set: value },
    { new: true }
  );

  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  return res.json({ message: 'Contact updated', contact });
}));

// DELETE /api/contacts/:id
router.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const contact = await TrustedContact.findOneAndDelete({
    _id: req.params.id,
    userId: req.user!._id,
  });

  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  return res.json({ message: 'Contact deleted' });
}));

export default router;
