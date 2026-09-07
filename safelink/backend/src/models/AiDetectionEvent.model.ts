import mongoose, { Document, Schema } from 'mongoose';

export type DetectionType = 'KEYWORD' | 'SCREAM' | 'DISTRESS_AUDIO' | 'COMBINED';
export type AiActionTaken = 'ALERT_SHOWN' | 'SOS_ACTIVATED' | 'CANCELLED' | 'IGNORED';

export interface IAiDetectionEvent extends Document {
  userId: mongoose.Types.ObjectId;
  emergencyId?: mongoose.Types.ObjectId;
  detectedPhrase?: string;
  detectionType: DetectionType;
  confidence: number; // 0-100
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  actionTaken: AiActionTaken;
  keywordConfidence?: number;
  acousticConfidence?: number;
  rawTranscript?: string;
  detectedAt: Date;
  respondedAt?: Date;
  createdAt: Date;
}

const AiDetectionEventSchema = new Schema<IAiDetectionEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    emergencyId: { type: Schema.Types.ObjectId, ref: 'Emergency' },
    detectedPhrase: String,
    detectionType: {
      type: String,
      enum: ['KEYWORD', 'SCREAM', 'DISTRESS_AUDIO', 'COMBINED'],
      required: true,
    },
    confidence: { type: Number, required: true, min: 0, max: 100 },
    riskLevel: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      required: true,
    },
    actionTaken: {
      type: String,
      enum: ['ALERT_SHOWN', 'SOS_ACTIVATED', 'CANCELLED', 'IGNORED'],
      default: 'ALERT_SHOWN',
    },
    keywordConfidence: Number,
    acousticConfidence: Number,
    rawTranscript: String,
    detectedAt: { type: Date, default: Date.now },
    respondedAt: Date,
  },
  { timestamps: true }
);

AiDetectionEventSchema.index({ userId: 1, detectedAt: -1 });

export default mongoose.model<IAiDetectionEvent>('AiDetectionEvent', AiDetectionEventSchema);
