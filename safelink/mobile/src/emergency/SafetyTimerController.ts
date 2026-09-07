import { useStore, SafetyTimer } from '../store';
import { timerAPI } from '../services/api';
import { getCurrentPosition } from '../services/location.service';
import { presentLocalNotification } from '../services/notifications.service';
import { storage } from '../services/storage';
import { emergencyEngine } from './EmergencyEngine';
import type { TimerPhase } from './types';

/**
 * The Safety Timer controller (client side).
 *
 * The Safety Timer is NOT a second emergency system. When its grace period lapses it
 * escalates through the SAME Emergency Engine as Manual SOS (`emergencyEngine.adopt`),
 * so location, contact notification, live tracking and history are identical.
 *
 * Two independent clocks protect the user (mirrors the backend):
 *   1. THIS controller — a 1s tick, while the app is foregrounded, drives the countdown,
 *      the "Are you safe?" check-in and (if grace lapses) in-app escalation with a fresh
 *      GPS fix.
 *   2. The backend sweeper — the AUTHORITY. It escalates any timer whose grace elapsed
 *      even if the app is closed/backgrounded (where JS is suspended and no tick runs).
 *      On the next foreground/reconnect, `sync()` reconciles: if the backend already
 *      escalated, the Emergency Engine adopts the resulting emergency.
 *
 * Countdown is ALWAYS derived from server timestamps (expiryTime / escalateAt), never a
 * local decrementing counter — so it stays correct across background/reopen/restart.
 */

const store = () => useStore.getState();

let tickHandle: ReturnType<typeof setInterval> | null = null;
let checkInAnnounced = false; // fire the local "Are you safe?" notification once per timer
let escalating = false;       // guard against concurrent escalation
let lastEscalateAttempt = 0;  // backoff for auto-escalation retries
const ESCALATE_RETRY_MS = 15_000;

const mapTimer = (raw: any): SafetyTimer => ({
  id: raw.id,
  status: raw.status,
  durationSeconds: raw.durationSeconds,
  startedAt: raw.startedAt,
  expiryTime: raw.expiryTime,
  responseGracePeriodSeconds: raw.responseGracePeriodSeconds,
  escalateAt: raw.escalateAt,
  note: raw.note ?? undefined,
  destination: raw.destination ?? undefined,
  emergencyId: raw.emergencyId ?? undefined,
});

/** Derive the timer phase purely from server timestamps + the current clock. */
export const phaseFor = (
  timer: Pick<SafetyTimer, 'expiryTime' | 'escalateAt'>,
  now: number = Date.now()
): TimerPhase => {
  if (now >= new Date(timer.escalateAt).getTime()) return 'ESCALATING';
  if (now >= new Date(timer.expiryTime).getTime()) return 'CHECK_IN';
  return 'ACTIVE';
};

const clearTick = () => {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
};

/** Reset all local timer state (backend is untouched). */
const clearLocal = () => {
  clearTick();
  checkInAnnounced = false;
  escalating = false;
  lastEscalateAttempt = 0;
  const s = store();
  s.setActiveTimer(null);
  s.setTimerPhase('NONE');
  void storage.setActiveTimerId(null);
};

const startTick = () => {
  clearTick();
  tickHandle = setInterval(onTick, 1000);
  if (tickHandle && typeof (tickHandle as any).unref === 'function') (tickHandle as any).unref();
  onTick(); // evaluate immediately (e.g. a restored, already-expired timer)
};

/** Put a timer into local state, compute its phase now, and (re)start the tick. */
const adoptTimer = (timer: SafetyTimer) => {
  const s = store();
  checkInAnnounced = false;
  escalating = false;
  lastEscalateAttempt = 0;
  s.setActiveTimer(timer);
  s.setTimerPhase(phaseFor(timer));
  void storage.setActiveTimerId(timer.id);
  startTick();
};

/** The 1s heartbeat: advances the phase and triggers auto-escalation from timestamps. */
const onTick = () => {
  const s = store();
  const timer = s.activeTimer;
  if (!timer) {
    clearTick();
    return;
  }
  const phase = phaseFor(timer);

  if (phase === 'ESCALATING') {
    void autoEscalate();
    return;
  }

  if (phase === 'CHECK_IN') {
    if (s.timerPhase !== 'CHECK_IN') s.setTimerPhase('CHECK_IN');
    if (!checkInAnnounced) {
      checkInAnnounced = true;
      void presentLocalNotification(
        'SafeLink — Are you safe?',
        `Your Safety Timer ended. Tap "I'm safe", or your trusted contacts will be alerted in ${timer.responseGracePeriodSeconds}s.`
      );
    }
    return;
  }

  if (s.timerPhase !== 'ACTIVE') s.setTimerPhase('ACTIVE');
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start a new Safety Timer. Calls the real backend API, adopts the server-returned
 * timer (with authoritative timestamps), and begins the local countdown tick.
 * Idempotent: if the backend already has an open timer it is returned (reused=true).
 */
const start = async (
  durationSeconds: number,
  options?: { note?: string; destination?: string; responseGracePeriodSeconds?: number }
): Promise<SafetyTimer> => {
  const s = store();
  s.setTimerError(null);

  const coords = await getCurrentPosition();
  const { data } = await timerAPI.create({
    durationSeconds,
    note: options?.note,
    destination: options?.destination,
    responseGracePeriodSeconds: options?.responseGracePeriodSeconds,
    latitude: coords?.latitude,
    longitude: coords?.longitude,
  });

  const timer = mapTimer(data.timer);
  adoptTimer(timer);
  return timer;
};

/**
 * Synchronise local timer state with the backend. Called on app launch (after auth)
 * and on network reconnect. If the backend has an open timer we adopt it; if the
 * backend already escalated it (sweeper path) the Emergency Engine picks it up via
 * its own restore(). If no open timer exists, local state is cleared.
 */
const sync = async (): Promise<void> => {
  try {
    const { data } = await timerAPI.getActive();
    if (data.timer) {
      const timer = mapTimer(data.timer);
      adoptTimer(timer);
    } else {
      // No open timer on the backend — clear any stale local state.
      clearLocal();
    }
  } catch {
    // Offline / unreachable — keep existing local state; retry on next reconnect.
  }
};

/**
 * "I'm safe" — resolve the timer without creating an emergency. Stops monitoring,
 * clears local state, and shows a confirmation notification.
 */
const checkIn = async (): Promise<boolean> => {
  const timer = store().activeTimer;
  if (!timer) return false;
  try {
    await timerAPI.resolve(timer.id);
    clearLocal();
    await presentLocalNotification(
      "You're safe",
      'Safety timer completed successfully.'
    );
    return true;
  } catch (err) {
    store().setTimerPhase('ERROR');
    store().setTimerError((err as Error)?.message || 'Could not check in. Please try again.');
    return false;
  }
};

/**
 * Cancel the active timer. No emergency is triggered.
 */
const cancel = async (): Promise<boolean> => {
  const timer = store().activeTimer;
  if (!timer) return false;
  try {
    await timerAPI.cancel(timer.id);
    clearLocal();
    return true;
  } catch (err) {
    store().setTimerPhase('ERROR');
    store().setTimerError((err as Error)?.message || 'Could not cancel the timer. Please try again.');
    return false;
  }
};

/**
 * "I need help" — explicitly escalate the timer into an emergency through the
 * shared Emergency Engine (same as Manual SOS).
 */
const needHelp = async (): Promise<boolean> => {
  const timer = store().activeTimer;
  if (!timer) return false;
  store().setTimerPhase('ESCALATING');
  return doEscalate(timer, 'You requested help.');
};

export const safetyTimerController = {
  start,
  sync,
  checkIn,
  cancel,
  needHelp,
};

/**
 * Escalate the timer into an emergency through the shared Emergency Engine. Used by both
 * the automatic grace-lapse path and the explicit "I need help" button. Idempotent on the
 * backend, so racing the server-side sweeper never creates a second emergency.
 */
const doEscalate = async (timer: SafetyTimer, reason: string): Promise<boolean> => {
  const s = store();
  // Fresh GPS fix while foregrounded; backend falls back to the timer's last-known
  // location when coords are omitted (e.g. escalation happened with the app closed).
  const coords = await getCurrentPosition();
  try {
    const { data } = await timerAPI.escalate(timer.id, {
      latitude: coords?.latitude,
      longitude: coords?.longitude,
    });
    // Hand the device off to the live-emergency experience (same as Manual SOS).
    await emergencyEngine.adopt(data.emergency, { announce: false });
    clearLocal();
    const notified = data.notification?.notified ?? 0;
    await presentLocalNotification(
      'SafeLink emergency activated',
      `${reason}${notified > 0 ? ` ${notified} trusted contact${notified === 1 ? '' : 's'} alerted.` : ''}`
    );
    return true;
  } catch (err) {
    s.setTimerPhase('ERROR');
    s.setTimerError((err as Error)?.message || 'Could not escalate the Safety Timer.');
    return false;
  }
};

const autoEscalate = async (): Promise<void> => {
  const now = Date.now();
  if (escalating || now - lastEscalateAttempt < ESCALATE_RETRY_MS) return;
  const timer = store().activeTimer;
  if (!timer) return;
  escalating = true;
  lastEscalateAttempt = now;
  store().setTimerPhase('ESCALATING');
  try {
    await doEscalate(timer, 'Your Safety Timer expired without a check-in.');
  } finally {
    escalating = false;
  }
};
