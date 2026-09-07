import mongoose, { Document, Schema } from 'mongoose';

export interface ITrustedContact extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  phone: string;
  email?: string;
  relationship: string;
  priority: number;
  status: 'active' | 'inactive';
  avatarColor?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TrustedContactSchema = new Schema<ITrustedContact>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    relationship: { type: String, required: true, trim: true },
    priority: { type: Number, default: 1, min: 1, max: 10 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    avatarColor: { type: String, default: '#7C3AED' },
  },
  { timestamps: true }
);

TrustedContactSchema.index({ userId: 1, priority: 1 });

export default mongoose.model<ITrustedContact>('TrustedContact', TrustedContactSchema);
