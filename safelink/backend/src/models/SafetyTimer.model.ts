import mongoose, { Document, Schema } from 'mongoose';

/**
 * Safety Timer lifecycle.
 *
 * Maps the product's conceptual states onto the existing enum names, adding only
 * `escalated` (which mirrors the Emergency model's own `escalated`):
 *   active/extended → running ("ACTIVE")
 *   expired         → reached zero, inside the response grace period ("CHECK-IN REQUIRED")
 *   resolved        → user checked in safe ("CHECKED_IN")
 *   cancelled       → user cancelled
 *   escalated       → grace elapsed / user asked for help → an Emergency was created
 */
export type TimerStatus = 'active' | 'expired' | 'cancelled' | 'extended' | 'resolved' | 'escalated';

/** Statuses that represent a timer still "in flight" (running or awaiting check-in). */
export const OPEN_TIMER_STATUSES: TimerStatus[] = ['active', 'extended', 'expired'];

export interface ISafetyTimer extends Document {
  userId: mongoose.Types.ObjectId;
  journeyId?: mongoose.Types.ObjectId;
  durationSeconds: number;
  expiryTime: Date;
  note?: string;
  destination?: string;
  status: TimerStatus;
  responseGracePeriodSeconds: number;
  extensions: number;
  /** Best-effort last-known device location, seeded at start (used to seed an emergency
   *  if the backend sweeper has to escalate while the app is closed). */
  lastLatitude?: number;
  lastLongitude?: number;
  lastLocationAt?: Date;
  /** The Emergency created when this timer escalated (link for history/idempotency). */
  emergencyId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SafetyTimerSchema = new Schema<ISafetyTimer>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    journeyId: { type: Schema.Types.ObjectId, ref: 'Journey' },
    durationSeconds: { type: Number, required: true },
    expiryTime: { type: Date, required: true },
    note: String,
    destination: String,
    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled', 'extended', 'resolved', 'escalated'],
      default: 'active',
      index: true,
    },
    responseGracePeriodSeconds: { type: Number, default: 30 },
    extensions: { type: Number, default: 0 },
    lastLatitude: Number,
    lastLongitude: Number,
    lastLocationAt: Date,
    emergencyId: { type: Schema.Types.ObjectId, ref: 'Emergency' },
  },
  { timestamps: true }
);

SafetyTimerSchema.index({ userId: 1, status: 1 });
SafetyTimerSchema.index({ expiryTime: 1, status: 1 });

export default mongoose.model<ISafetyTimer>('SafetyTimer', SafetyTimerSchema);
