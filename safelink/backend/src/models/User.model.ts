import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  firebaseUid: string;
  name: string;
  email: string;
  phone: string;
  profileImage?: string;
  fcmToken?: string;
  accountStatus: 'active' | 'suspended' | 'deleted';
  emergencyPreferences: {
    autoEscalate: boolean;
    escalationDelaySeconds: number;
    aiAutoActivate: boolean;
    aiConfidenceThreshold: number;
    locationUpdateIntervalNormal: number;
    locationUpdateIntervalEmergency: number;
  };
  aiSettings: {
    enabled: boolean;
    keywords: string[];
    keywordLanguages: string[];
    acousticDetection: boolean;
    confidenceThreshold: number;
  };
  privacySettings: {
    shareLocation: boolean;
    shareRecordings: boolean;
    dataRetentionDays: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    firebaseUid: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    profileImage: { type: String },
    fcmToken: { type: String },
    accountStatus: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
    emergencyPreferences: {
      autoEscalate: { type: Boolean, default: false },
      escalationDelaySeconds: { type: Number, default: 30 },
      aiAutoActivate: { type: Boolean, default: false },
      aiConfidenceThreshold: { type: Number, default: 85 },
      locationUpdateIntervalNormal: { type: Number, default: 30 },
      locationUpdateIntervalEmergency: { type: Number, default: 5 },
    },
    aiSettings: {
      enabled: { type: Boolean, default: true },
      keywords: {
        type: [String],
        default: ['help', 'bachao', 'bachaoo', 'save me', 'please help', 'stop', 'madad karo', 'help me', 'choro'],
      },
      keywordLanguages: { type: [String], default: ['en', 'ur'] },
      acousticDetection: { type: Boolean, default: true },
      confidenceThreshold: { type: Number, default: 75 },
    },
    privacySettings: {
      shareLocation: { type: Boolean, default: true },
      shareRecordings: { type: Boolean, default: true },
      dataRetentionDays: { type: Number, default: 90 },
    },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>('User', UserSchema);
