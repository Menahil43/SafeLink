import mongoose, { Document, Schema } from 'mongoose';

export type UploadStatus = 'recording' | 'uploading' | 'uploaded' | 'failed' | 'retrying' | 'completed';

export interface IRecordingChunk {
  index: number;
  ossKey: string;
  sizeBytes: number;
  durationSeconds: number;
  uploadedAt: Date;
}

export interface IRecording extends Document {
  emergencyId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  ossKey?: string;
  ossUrl?: string;
  storageProvider?: 'alibaba-oss' | 'oss';
  fileType: string;
  durationSeconds?: number;
  sizeBytes?: number;
  uploadStatus: UploadStatus;
  uploadAttempts: number;
  chunks: IRecordingChunk[];
  lastUploadedAt?: Date;
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RecordingSchema = new Schema<IRecording>(
  {
    emergencyId: { type: Schema.Types.ObjectId, ref: 'Emergency', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ossKey: String,
    ossUrl: String, // internal reference, never exposed directly
    storageProvider: { type: String, enum: ['alibaba-oss', 'oss'] },
    fileType: { type: String, default: 'audio/m4a' },
    durationSeconds: Number,
    sizeBytes: Number,
    uploadStatus: {
      type: String,
      enum: ['recording', 'uploading', 'uploaded', 'failed', 'retrying', 'completed'],
      default: 'recording',
    },
    uploadAttempts: { type: Number, default: 0 },
    chunks: [{
      index: { type: Number, required: true },
      ossKey: { type: String, required: true },
      sizeBytes: { type: Number, required: true },
      durationSeconds: { type: Number, required: true },
      uploadedAt: { type: Date, required: true },
    }],
    lastUploadedAt: Date,
    startedAt: { type: Date, default: Date.now },
    endedAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model<IRecording>('Recording', RecordingSchema);
