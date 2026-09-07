import { useStore, Emergency } from '../store';
import { emergencyAPI } from '../services/api';
import {
  getCurrentPosition,
  watchPosition,
  type Coordinates,
  type LocationSubscription,
} from '../services/location.service';
import { presentLocalNotification } from '../services/notifications.service';
import { recordingService } from '../services/recording.service';
import { storage } from '../services/storage';
import type { ActivateOptions, EmergencySource, LiveStatus } from './types';

/**
 * The Emergency Engine (client side).
 *
 * Single source of truth for the emergency lifecycle on the device. UI, network,
 * location tracking, notifications, recording and persistence are separated so that
 * every trigger — Manual SOS today; AI detection, Safety Timer, route deviation and
 * a future IoT band later — activates and resolves emergencies identically by calling
 * `emergencyEngine.activate({ source })`.
 *
 * State lives in the zustand store; this module reads/writes it via getState/setState
 * so any screen can subscribe and stay in sync.
 */

const DEFAULT_INTERVAL_SECONDS = 5;
/** With a live connection, no successful server update within this window → STALE. */
const STALE_AFTER_MS = 15_000;

let locationSub: LocationSubscription | null = null;
let currentEmergencyId: string | null = null;
let recordingHandle: import('../services/recording.service').RecordingHandle | null = null;

const store = () => useStore.getState();

const mapEmergency = (raw: any): Emergency => ({
  id: raw.id,
  type: raw.type,
  status: raw.status,
  riskLevel: raw.riskLevel,
  startedAt: raw.startedAt,
  endedAt: raw.endedAt,
  durationSeconds: raw.durationSeconds,
  currentLatitude: raw.currentLatitude,
  currentLongitude: raw.currentLongitude,
  currentAddress: raw.currentAddress,
  notifiedContacts: raw.notifiedContacts ?? 0,
  recording: raw.recording ?? null,
});

const trackingInterval = (): number =>
  store().user?.emergencyPreferences?.locationUpdateIntervalEmergency || DEFAULT_INTERVAL_SECONDS;

/**
 * Push one location point to the backend for the active emergency. Skips the network
 * call while offline (so we don't spam failures) but still updates local coordinates.
 * `lastLocationUpdateAt` only advances on a confirmed server write — that timestamp is
 * what the UI uses to show LIVE vs STALE, so it never lies about connectivity.
 */
const sendLocationUpdate = async (coords: Coordinates): Promise<void> => {
  const s = store();
  s.setLocationAvailable(true);
  s.updateEmergency({ currentLatitude: coords.latitude, currentLongitude: coords.longitude });

  if (!currentEmergencyId || !s.isOnline) return;

  try {
    await emergencyAPI.updateLocation(currentEmergencyId, {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      speed: coords.speed,
      direction: coords.direction,
    });
    store().setLastLocationUpdateAt(Date.now());
  } catch {
    // Leave lastLocationUpdateAt untouched → UI degrades to "Reconnecting…".
  }
};

const startTracking = async (): Promise<void> => {
  await stopTracking();
  locationSub = await watchPosition((coords) => {
    void sendLocationUpdate(coords);
  }, trackingInterval());
  store().setLocationAvailable(locationSub !== null);
};

const stopTracking = async (): Promise<void> => {
  if (locationSub) {
    locationSub.remove();
    locationSub = null;
  }
};

/**
 * Transition into the ACTIVE emergency state and resume live tracking. Shared by
 * activate() (a fresh SOS), adopt() (another trigger — e.g. a Safety Timer escalation —
 * already created the emergency on the backend) and restore() (app relaunch). Writes the
 * store, caches the id for cold-start, kicks off recording and starts GPS tracking.
 */
const enterActive = async (
  emergency: Emergency,
  opts: { announce?: boolean; notified?: number; freshFix?: boolean } = {}
): Promise<void> => {
  const s = store();
  currentEmergencyId = emergency.id;
  s.setActiveEmergency(emergency);
  s.setEmergencyPhase('ACTIVE');
  s.setLastLocationUpdateAt(opts.freshFix ? Date.now() : null);
  await storage.setActiveEmergencyId(emergency.id);

  try {
    recordingHandle = await recordingService.start(emergency.id);
  } catch {
    recordingHandle = null;
    store().setRecordingState({ recordingStatus: 'failed' });
  }

  if (opts.announce) {
    const notified = opts.notified ?? emergency.notifiedContacts ?? 0;
    await presentLocalNotification(
      'SafeLink SOS active',
      notified > 0
        ? `Emergency active. ${notified} trusted contact${notified === 1 ? '' : 's'} notified.`
        : 'Emergency active. Add trusted contacts to alert them next time.'
    );
  }

  await startTracking();
};

/**
 * Activate an emergency from any trigger. Idempotent against double-taps and app
 * restarts: if one is already active locally it's a no-op, and the backend also
 * de-duplicates (returns the existing emergency with `reused: true`).
 */
const activate = async (options: ActivateOptions = {}): Promise<Emergency | null> => {
  const s = store();
  if (s.emergencyPhase === 'ACTIVATING' || s.emergencyPhase === 'ACTIVE' || s.activeEmergency) {
    return s.activeEmergency; // duplicate guard (client side)
  }

  const source: EmergencySource = options.source || 'MANUAL_SOS';
  s.setEmergencyError(null);
  s.setEmergencyPhase('ACTIVATING');
  s.setLastLocationUpdateAt(null);

  // Best-effort location fix — activation must proceed even if GPS is unavailable.
  const coords = await getCurrentPosition();
  s.setLocationAvailable(coords !== null);

  try {
    const { data } = await emergencyAPI.activate({
      type: source,
      riskLevel: options.riskLevel || 'HIGH',
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      aiEventId: options.aiEventId,
      journeyId: options.journeyId,
    });

    const emergency = mapEmergency(data.emergency);
    const notified = data.notification?.notified ?? emergency.notifiedContacts ?? 0;
    await enterActive(emergency, { announce: true, notified, freshFix: !!coords });
    return emergency;
  } catch (err) {
    s.setEmergencyPhase('FAILED');
    s.setEmergencyError((err as Error)?.message || 'Could not activate emergency.');
    await presentLocalNotification('SOS failed', 'Could not activate emergency. Please try again.');
    return null;
  }
};

/**
 * Adopt an emergency that another trigger already created on the backend (today: a
 * Safety Timer escalation). Hands the device off to the live-emergency experience —
 * live tracking, recording, the full-screen active view — without creating a duplicate.
 * No-op (returns the current one) if an emergency is already active locally.
 */
const adopt = async (
  rawEmergency: any,
  opts: { announce?: boolean; notified?: number } = {}
): Promise<Emergency | null> => {
  const s = store();
  if (s.activeEmergency) return s.activeEmergency;
  if (!rawEmergency?.id) return null;
  const emergency = mapEmergency(rawEmergency);
  await enterActive(emergency, { announce: opts.announce, notified: opts.notified, freshFix: false });
  return emergency;
};

/** Resolve the active emergency ("I'm safe"): stops tracking and notifies contacts. */
const resolve = async (): Promise<boolean> => {
  const s = store();
  const id = currentEmergencyId || s.activeEmergency?.id;
  if (!id) return false;

  s.setEmergencyPhase('RESOLVING');
  try {
    await emergencyAPI.resolve(id);
    await recordingService.stop(recordingHandle).catch(() => undefined);
    recordingHandle = null;
    await stopTracking();
    await storage.setActiveEmergencyId(null);
    currentEmergencyId = null;
    s.setActiveEmergency(null);
    s.setLastLocationUpdateAt(null);
    s.setEmergencyPhase('IDLE');
    await presentLocalNotification('Emergency ended', 'Your contacts were notified that you are safe.');
    return true;
  } catch (err) {
    // Roll back to ACTIVE so the user can retry — the emergency is still live.
    s.setEmergencyPhase('ACTIVE');
    s.setEmergencyError((err as Error)?.message || 'Could not resolve emergency.');
    return false;
  }
};

/** Cancel a false/accidental activation. */
const cancel = async (): Promise<boolean> => {
  const s = store();
  const id = currentEmergencyId || s.activeEmergency?.id;
  if (!id) return false;
  try {
    await emergencyAPI.cancel(id);
  } catch {
    // Best-effort; we still tear down locally below.
  }
  await recordingService.stop(recordingHandle).catch(() => undefined);
  recordingHandle = null;
  await stopTracking();
  await storage.setActiveEmergencyId(null);
  currentEmergencyId = null;
  s.setActiveEmergency(null);
  s.setLastLocationUpdateAt(null);
  s.setEmergencyPhase('IDLE');
  return true;
};

/**
 * On app launch (after auth), ask the backend whether an emergency is still open and,
 * if so, restore it and resume live tracking — without creating a duplicate.
 */
const restore = async (): Promise<void> => {
  try {
    const { data } = await emergencyAPI.getActive();
    if (data.emergency) {
      await enterActive(mapEmergency(data.emergency), { freshFix: false });
    } else {
      await storage.setActiveEmergencyId(null);
      store().setEmergencyPhase('IDLE');
    }
  } catch {
    // Offline at launch: keep whatever the store had; restore retried on reconnect.
  }
};

/** Tear down all engine state (used on sign-out). Does not touch the backend. */
const reset = async (): Promise<void> => {
  await recordingService.stop(recordingHandle).catch(() => undefined);
  recordingHandle = null;
  await stopTracking();
  currentEmergencyId = null;
  const s = store();
  s.setActiveEmergency(null);
  s.setEmergencyPhase('IDLE');
  s.setEmergencyError(null);
  s.setLastLocationUpdateAt(null);
  s.setLocationAvailable(false);
  s.setRecordingState({ recordingStatus: 'idle', recordingDurationSeconds: 0, recordingUploadedChunks: 0 });
};

/** Derive the honest live-tracking status shown in the UI. */
export const getLiveStatus = (
  lastLocationUpdateAt: number | null,
  isOnline: boolean,
  now: number = Date.now()
): LiveStatus => {
  if (!isOnline) return 'OFFLINE';
  if (!lastLocationUpdateAt || now - lastLocationUpdateAt > STALE_AFTER_MS) return 'STALE';
  return 'LIVE';
};

export const emergencyEngine = {
  activate,
  adopt,
  resolve,
  cancel,
  restore,
  reset,
  startTracking,
  stopTracking,
};
