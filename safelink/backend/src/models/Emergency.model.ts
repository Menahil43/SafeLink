import mongoose, { Document, Schema } from 'mongoose';

export type EmergencyStatus = 'activating' | 'active' | 'resolved' | 'cancelled' | 'escalated';
export type EmergencyType = 'MANUAL_SOS' | 'AI_DETECTION' | 'SAFETY_TIMER' | 'ROUTE_DEVIATION' | 'OTHER';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ILocationPoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  direction?: number;
  timestamp: Date;
}

export interface IEmergency extends Document {
  userId: mongoose.Types.ObjectId;
  type: EmergencyType;
  status: EmergencyStatus;
  riskLevel: RiskLevel;
  activationSource: EmergencyType;
  currentLatitude?: number;
  currentLongitude?: number;
  currentAddress?: string;
  locationHistory: ILocationPoint[];
  startedAt: Date;
  endedAt?: Date;
  durationSeconds?: number;
  notifiedContacts: number;
  recordingId?: mongoose.Types.ObjectId;
  aiEventId?: mongoose.Types.ObjectId;
  journeyId?: mongoose.Types.ObjectId;
  safetyTimerId?: mongoose.Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LocationPointSchema = new Schema<ILocationPoint>(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy: Number,
    speed: Number,
    direction: Number,
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const EmergencySchema = new Schema<IEmergency>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['MANUAL_SOS', 'AI_DETECTION', 'SAFETY_TIMER', 'ROUTE_DEVIATION', 'OTHER'],
      required: true,
    },
    status: {
      type: String,
      enum: ['activating', 'active', 'resolved', 'cancelled', 'escalated'],
      default: 'activating',
      index: true,
    },
    riskLevel: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'HIGH',
    },
    activationSource: {
      type: String,
      enum: ['MANUAL_SOS', 'AI_DETECTION', 'SAFETY_TIMER', 'ROUTE_DEVIATION', 'OTHER'],
    },
    currentLatitude: Number,
    currentLongitude: Number,
    currentAddress: String,
    locationHistory: [LocationPointSchema],
    startedAt: { type: Date, default: Date.now },
    endedAt: Date,
    durationSeconds: Number,
    notifiedContacts: { type: Number, default: 0 },
    recordingId: { type: Schema.Types.ObjectId, ref: 'Recording' },
    aiEventId: { type: Schema.Types.ObjectId, ref: 'AiDetectionEvent' },
    journeyId: { type: Schema.Types.ObjectId, ref: 'Journey' },
    safetyTimerId: { type: Schema.Types.ObjectId, ref: 'SafetyTimer' },
    notes: String,
  },
  { timestamps: true }
);

EmergencySchema.index({ userId: 1, createdAt: -1 });
EmergencySchema.index({ status: 1, userId: 1 });

export default mongoose.model<IEmergency>('Emergency', EmergencySchema);
