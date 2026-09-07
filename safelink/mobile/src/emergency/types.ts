/**
 * Emergency Engine — shared types.
 *
 * The engine is deliberately source-agnostic: Manual SOS is just the first trigger.
 * AI distress detection, the Safety Timer, route deviation and a future IoT band all
 * activate through the same `activate({ source })` entry point and reuse the same
 * lifecycle, location tracking and contact notification.
 */

/** Client-side lifecycle state machine for an emergency. */
export type EmergencyPhase =
  | 'IDLE'
  | 'ACTIVATING'
  | 'ACTIVE'
  | 'RESOLVING'
  | 'RESOLVED'
  | 'FAILED';

/** What triggered the emergency (mirrors the backend `EmergencyType`). */
export type EmergencySource =
  | 'MANUAL_SOS'
  | 'AI_DETECTION'
  | 'SAFETY_TIMER'
  | 'ROUTE_DEVIATION'
  | 'OTHER';

/** Freshness of the live location stream, derived from the last successful update. */
export type LiveStatus = 'LIVE' | 'STALE' | 'OFFLINE';

/**
 * Client-side Safety Timer state machine.
 *   NONE       — no timer running
 *   ACTIVE     — counting down to expiry
 *   CHECK_IN   — expired; inside the grace window awaiting "Are you safe?"
 *   ESCALATING — grace lapsed / user asked for help; handing off to the Emergency Engine
 *   ERROR      — the last timer operation failed (message in timerError)
 */
export type TimerPhase = 'NONE' | 'ACTIVE' | 'CHECK_IN' | 'ESCALATING' | 'ERROR';

export interface ActivateOptions {
  source?: EmergencySource;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  aiEventId?: string;
  journeyId?: string;
}
