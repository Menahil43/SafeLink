import mongoose, { Document, Schema } from 'mongoose';

export type JourneyStatus = 'planned' | 'active' | 'completed' | 'cancelled' | 'deviated';
export type TravelMode = 'driving' | 'walking' | 'bicycling' | 'transit';

export interface IRouteStep {
  instruction: string;
  distance: number;
  duration: number;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
}

export interface IJourney extends Document {
  userId: mongoose.Types.ObjectId;
  origin: {
    address: string;
    latitude: number;
    longitude: number;
  };
  destination: {
    address: string;
    latitude: number;
    longitude: number;
  };
  travelMode: TravelMode;
  distanceMeters: number;
  expectedDurationSeconds: number;
  expectedEta: Date;
  actualArrival?: Date;
  status: JourneyStatus;
  routePolyline?: string; // encoded polyline
  deviationThresholdMeters: number;
  deviationDetectedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  emergencyId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const JourneySchema = new Schema<IJourney>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    origin: {
      address: { type: String, required: true },
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
    },
    destination: {
      address: { type: String, required: true },
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
    },
    travelMode: {
      type: String,
      enum: ['driving', 'walking', 'bicycling', 'transit'],
      default: 'driving',
    },
    distanceMeters: { type: Number, required: true },
    expectedDurationSeconds: { type: Number, required: true },
    expectedEta: { type: Date, required: true },
    actualArrival: Date,
    status: {
      type: String,
      enum: ['planned', 'active', 'completed', 'cancelled', 'deviated'],
      default: 'planned',
      index: true,
    },
    routePolyline: String,
    deviationThresholdMeters: { type: Number, default: 200 },
    deviationDetectedAt: Date,
    startedAt: Date,
    completedAt: Date,
    emergencyId: { type: Schema.Types.ObjectId, ref: 'Emergency' },
  },
  { timestamps: true }
);

JourneySchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<IJourney>('Journey', JourneySchema);
