import Emergency, { IEmergency, EmergencyType, RiskLevel } from '../models/Emergency.model';
import { IUser } from '../models/User.model';
import { notifyContacts, NotifyResult } from './notification.service';
import { getAddressFromCoords } from './maps.service';
import { logger } from '../utils/logger';

export const ACTIVE_STATUSES = ['activating', 'active'] as const;

export interface CreateEmergencyInput {
  type?: EmergencyType;
  latitude?: number;
  longitude?: number;
  riskLevel?: RiskLevel;
  aiEventId?: string;
  journeyId?: string;
  safetyTimerId?: string;
}

export interface LocationPointInput {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  direction?: number;
}

/**
 * The Emergency Engine (server side).
 *
 * A single source of truth for the emergency lifecycle so every trigger — Manual SOS,
 * AI distress detection, Safety Timer, route deviation, future IoT band — creates,
 * tracks and resolves emergencies identically, including trusted-contact notification.
 */

/** The user's currently-open emergency (activating or active), if any. */
export const getActiveEmergency = (userId: unknown): Promise<IEmergency | null> =>
  Emergency.findOne({ userId, status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: -1 });

/** An emergency owned by this user, or null (used for authorization on all reads). */
export const getOwnedEmergency = (userId: unknown, id: string): Promise<IEmergency | null> =>
  Emergency.findOne({ _id: id, userId });

/**
 * Create (activate) an emergency. If the user already has an open emergency, that one is
 * returned instead of creating a duplicate (reused = true) — this protects against double
 * taps and app restarts. New emergencies notify trusted contacts.
 */
export const createEmergency = async (
  user: IUser,
  input: CreateEmergencyInput
): Promise<{ emergency: IEmergency; reused: boolean; notify: NotifyResult }> => {
  const existing = await getActiveEmergency(user._id);
  if (existing) {
    return {
      emergency: existing,
      reused: true,
      notify: { totalContacts: existing.notifiedContacts, notified: existing.notifiedContacts, pushSent: 0, pushFailed: 0 },
    };
  }

  const emergency = await Emergency.create({
    userId: user._id,
    type: input.type || 'MANUAL_SOS',
    status: 'active',
    riskLevel: input.riskLevel || 'HIGH',
    activationSource: input.type || 'MANUAL_SOS',
    currentLatitude: input.latitude,
    currentLongitude: input.longitude,
    startedAt: new Date(),
    ...(input.latitude != null && input.longitude != null
      ? { locationHistory: [{ latitude: input.latitude, longitude: input.longitude, timestamp: new Date() }] }
      : {}),
    ...(input.aiEventId ? { aiEventId: input.aiEventId } : {}),
    ...(input.journeyId ? { journeyId: input.journeyId } : {}),
    ...(input.safetyTimerId ? { safetyTimerId: input.safetyTimerId } : {}),
  });

  // Reverse-geocode the initial location in the background (never blocks activation).
  if (input.latitude != null && input.longitude != null) {
    getAddressFromCoords(input.latitude, input.longitude)
      .then((address) => Emergency.findByIdAndUpdate(emergency._id, { currentAddress: address }))
      .catch((err) => logger.warn('createEmergency: geocode failed', err));
  }

  const notify = await notifyContacts(user, emergency, 'SOS_ACTIVATED');
  emergency.notifiedContacts = notify.notified;
  await Emergency.findByIdAndUpdate(emergency._id, { notifiedContacts: notify.notified });

  return { emergency, reused: false, notify };
};

/** Append a live location point and update the emergency's current position. */
export const appendLocation = async (
  userId: unknown,
  id: string,
  point: LocationPointInput
): Promise<boolean> => {
  const res = await Emergency.updateOne(
    { _id: id, userId, status: { $in: ACTIVE_STATUSES } },
    {
      $push: { locationHistory: { ...point, timestamp: new Date() } },
      $set: { currentLatitude: point.latitude, currentLongitude: point.longitude },
    }
  );
  return res.matchedCount > 0;
};

/** Resolve an active emergency, compute duration, and notify contacts they are safe. */
export const resolveEmergency = async (
  user: IUser,
  id: string
): Promise<{ durationSeconds: number; notify: NotifyResult } | null> => {
  const emergency = await Emergency.findOne({ _id: id, userId: user._id, status: { $in: ACTIVE_STATUSES } });
  if (!emergency) return null;

  const endedAt = new Date();
  const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - emergency.startedAt.getTime()) / 1000));

  emergency.status = 'resolved';
  emergency.endedAt = endedAt;
  emergency.durationSeconds = durationSeconds;
  await emergency.save();

  const notify = await notifyContacts(user, emergency, 'EMERGENCY_RESOLVED');
  return { durationSeconds, notify };
};
