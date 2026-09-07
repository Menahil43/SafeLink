import SafetyTimer, { ISafetyTimer, OPEN_TIMER_STATUSES } from '../models/SafetyTimer.model';
import User, { IUser } from '../models/User.model';
import Emergency, { IEmergency } from '../models/Emergency.model';
import { createEmergency } from './emergency.service';
import { NotifyResult } from './notification.service';
import { logger } from '../utils/logger';

/**
 * Safety Timer server-side logic.
 *
 * The Safety Timer is NOT a second emergency system: when it expires without a
 * check-in it escalates through the SAME Emergency Engine (`createEmergency`) that
 * Manual SOS uses — so location, trusted-contact notification, live tracking, history
 * and resolution are all identical, only the `type` differs (SAFETY_TIMER).
 *
 * Two independent clocks drive expiry so the safety behaviour never depends solely on
 * the mobile JS process staying alive:
 *   1. The mobile app (foreground) shows the "Are you safe?" check-in and, if the grace
 *      period lapses, calls POST /api/timers/:id/escalate with a fresh GPS fix.
 *   2. This server-side sweeper independently escalates any timer whose grace period has
 *      elapsed, even if the app is closed/backgrounded/offline. It is the authority.
 * Both paths are idempotent (see escalateTimer) so at most one emergency is created.
 */

/** Default grace period if neither the request nor the user preference supplies one. */
export const DEFAULT_GRACE_SECONDS = 30;

/** Epoch of the escalation deadline for a timer (expiry + grace). */
export const escalateAtMs = (timer: Pick<ISafetyTimer, 'expiryTime' | 'responseGracePeriodSeconds'>): number =>
  timer.expiryTime.getTime() + timer.responseGracePeriodSeconds * 1000;

/** The user's single open timer (running or awaiting check-in), if any. */
export const getOpenTimer = (userId: unknown): Promise<ISafetyTimer | null> =>
  SafetyTimer.findOne({ userId, status: { $in: OPEN_TIMER_STATUSES } }).sort({ createdAt: -1 });

export interface EscalateResult {
  timer: ISafetyTimer;
  emergency: IEmergency;
  reused: boolean;
  notify: NotifyResult;
}

/**
 * Escalate a timer into an emergency.
 *
 * Atomically claims the timer (active/extended/expired → escalated) so concurrent
 * callers — the mobile app and the sweeper — cannot both escalate the same timer.
 * The winner creates the emergency (which itself de-duplicates per open emergency),
 * seeding location from the caller's fresh fix or the timer's last-known position.
 * Returns null if the timer was already resolved/cancelled/escalated by someone else.
 */
export const escalateTimer = async (
  timer: ISafetyTimer,
  user: IUser,
  coords?: { latitude?: number; longitude?: number }
): Promise<EscalateResult | null> => {
  const claimed = await SafetyTimer.findOneAndUpdate(
    { _id: timer._id, status: { $in: OPEN_TIMER_STATUSES } },
    { status: 'escalated' },
    { new: true }
  );
  if (!claimed) return null; // lost the race, or already terminal (resolved/cancelled/escalated)

  const latitude = coords?.latitude ?? claimed.lastLatitude;
  const longitude = coords?.longitude ?? claimed.lastLongitude;

  const { emergency, reused, notify } = await createEmergency(user, {
    type: 'SAFETY_TIMER',
    riskLevel: 'HIGH',
    latitude,
    longitude,
    safetyTimerId: claimed._id.toString(),
  });

  await SafetyTimer.findByIdAndUpdate(claimed._id, { emergencyId: emergency._id });

  return { timer: claimed, emergency, reused, notify };
};

/**
 * Find every timer whose response grace period has fully elapsed and escalate it.
 * Also promotes running timers past their expiry (but still inside grace) to `expired`
 * so GET /active and history reflect the "awaiting check-in" state. Each timer is
 * processed independently — one failure never blocks the rest (safety-critical).
 *
 * Returns the number of timers escalated (useful for tests/observability).
 */
export const sweepTimers = async (now: Date = new Date()): Promise<{ escalated: number; markedExpired: number }> => {
  let escalated = 0;

  // 1) Escalate timers whose grace deadline (expiry + grace) has passed.
  const graceElapsed = {
    status: { $in: OPEN_TIMER_STATUSES },
    $expr: {
      $lte: [
        { $add: ['$expiryTime', { $multiply: ['$responseGracePeriodSeconds', 1000] }] },
        now,
      ],
    },
  };

  const due = await SafetyTimer.find(graceElapsed).sort({ expiryTime: 1 }).limit(200);
  for (const timer of due) {
    try {
      const user = await User.findById(timer.userId);
      if (!user) {
        // Orphaned timer (user deleted) — cannot escalate; retire it so we stop reprocessing.
        await SafetyTimer.findByIdAndUpdate(timer._id, { status: 'cancelled' });
        continue;
      }
      const result = await escalateTimer(timer, user);
      if (result) escalated += 1;
    } catch (err) {
      logger.error('sweepTimers: failed to escalate timer', { timerId: String(timer._id), err });
    }
  }

  // 2) Promote running timers that are past expiry but still inside grace → `expired`.
  const inGrace = await SafetyTimer.updateMany(
    {
      status: { $in: ['active', 'extended'] },
      expiryTime: { $lte: now },
      $expr: {
        $gt: [
          { $add: ['$expiryTime', { $multiply: ['$responseGracePeriodSeconds', 1000] }] },
          now,
        ],
      },
    },
    { status: 'expired' }
  );

  return { escalated, markedExpired: inGrace.modifiedCount ?? 0 };
};

// ─── Background sweeper ──────────────────────────────────────────────────────
let sweepHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic Safety Timer sweeper. Interval is configurable via
 * SAFETY_TIMER_SWEEP_INTERVAL_MS (default 15s). Never started during tests — tests
 * call sweepTimers() directly for determinism.
 */
export const startTimerSweeper = (): void => {
  if (sweepHandle) return;
  const intervalMs = parseInt(process.env.SAFETY_TIMER_SWEEP_INTERVAL_MS || '15000', 10);
  sweepHandle = setInterval(() => {
    sweepTimers().catch((err) => logger.error('Safety Timer sweep failed', err));
  }, intervalMs);
  // Do not keep the event loop alive solely for the sweeper.
  if (typeof sweepHandle.unref === 'function') sweepHandle.unref();
  logger.info(`⏱  Safety Timer sweeper started (every ${intervalMs}ms)`);
};

export const stopTimerSweeper = (): void => {
  if (sweepHandle) {
    clearInterval(sweepHandle);
    sweepHandle = null;
  }
};
