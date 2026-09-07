import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth.middleware';
import Journey from '../models/Journey.model';
import { calculateRoute, getAddressFromCoords } from '../services/maps.service';
import Joi from 'joi';

const router = Router();
router.use(verifyFirebaseToken);

// POST /api/journeys  — Create and calculate route
router.post('/', asyncHandler(async (req: AuthRequest, res) => {
  const schema = Joi.object({
    originAddress: Joi.string().required(),
    originLatitude: Joi.number().required(),
    originLongitude: Joi.number().required(),
    destinationAddress: Joi.string().required(),
    destinationLatitude: Joi.number().required(),
    destinationLongitude: Joi.number().required(),
    travelMode: Joi.string().valid('driving', 'walking', 'bicycling', 'transit').default('driving'),
    deviationThresholdMeters: Joi.number().min(50).max(1000).default(200),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const route = await calculateRoute(
    value.originLatitude,
    value.originLongitude,
    value.destinationLatitude,
    value.destinationLongitude,
    value.travelMode
  );

  const journey = await Journey.create({
    userId: req.user!._id,
    origin: {
      address: value.originAddress,
      latitude: value.originLatitude,
      longitude: value.originLongitude,
    },
    destination: {
      address: value.destinationAddress,
      latitude: value.destinationLatitude,
      longitude: value.destinationLongitude,
    },
    travelMode: value.travelMode,
    distanceMeters: route.distanceMeters,
    expectedDurationSeconds: route.durationSeconds,
    expectedEta: route.eta,
    routePolyline: route.polyline,
    deviationThresholdMeters: value.deviationThresholdMeters,
    status: 'planned',
  });

  return res.status(201).json({
    journey: {
      id: journey._id,
      origin: journey.origin,
      destination: journey.destination,
      travelMode: journey.travelMode,
      distanceMeters: journey.distanceMeters,
      expectedDurationSeconds: journey.expectedDurationSeconds,
      expectedEta: journey.expectedEta,
      routePolyline: journey.routePolyline,
      status: journey.status,
    },
  });
}));

// GET /api/journeys
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const journeys = await Journey.find({ userId: req.user!._id })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('-routePolyline');

  return res.json({ journeys });
}));

// GET /api/journeys/:id
router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const journey = await Journey.findOne({ _id: req.params.id, userId: req.user!._id });
  if (!journey) return res.status(404).json({ error: 'Journey not found' });
  return res.json({ journey });
}));

// POST /api/journeys/:id/start
router.post('/:id/start', asyncHandler(async (req: AuthRequest, res) => {
  const journey = await Journey.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!._id, status: 'planned' },
    { status: 'active', startedAt: new Date() },
    { new: true }
  );
  if (!journey) return res.status(404).json({ error: 'Journey not found or already started' });
  return res.json({ message: 'Journey started', journey });
}));

// POST /api/journeys/:id/end
router.post('/:id/end', asyncHandler(async (req: AuthRequest, res) => {
  const journey = await Journey.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!._id, status: 'active' },
    { status: 'completed', completedAt: new Date(), actualArrival: new Date() },
    { new: true }
  );
  if (!journey) return res.status(404).json({ error: 'Active journey not found' });
  return res.json({ message: 'Journey completed', journey });
}));

// POST /api/journeys/:id/deviation  — Report a deviation
router.post('/:id/deviation', asyncHandler(async (req: AuthRequest, res) => {
  const { latitude, longitude } = req.body;
  const journey = await Journey.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!._id, status: 'active' },
    { status: 'deviated', deviationDetectedAt: new Date() },
    { new: true }
  );
  if (!journey) return res.status(404).json({ error: 'Active journey not found' });

  // Reverse geocode the deviation location
  const address = await getAddressFromCoords(latitude, longitude);
  return res.json({ message: 'Deviation recorded', address });
}));

export default router;
