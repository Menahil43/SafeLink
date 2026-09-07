import mongoose, { Document, Schema } from 'mongoose';

export type NotificationType =
  | 'SOS_ACTIVATED'
  | 'AI_DISTRESS_DETECTED'
  | 'ROUTE_DEVIATION'
  | 'ETA_DELAY'
  | 'SAFETY_TIMER_EXPIRED'
  | 'EMERGENCY_RESOLVED'
  | 'RECORDING_UPLOAD_FAILED'
  | 'JOURNEY_STARTED'
  | 'JOURNEY_COMPLETED';

export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed';

export interface INotification extends Document {
  recipientUserId: mongoose.Types.ObjectId;
  emergencyId?: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, string>;
  deliveryStatus: DeliveryStatus;
  fcmMessageId?: string;
  deliveredAt?: Date;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    recipientUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    emergencyId: { type: Schema.Types.ObjectId, ref: 'Emergency' },
    type: {
      type: String,
      enum: [
        'SOS_ACTIVATED',
        'AI_DISTRESS_DETECTED',
        'ROUTE_DEVIATION',
        'ETA_DELAY',
        'SAFETY_TIMER_EXPIRED',
        'EMERGENCY_RESOLVED',
        'RECORDING_UPLOAD_FAILED',
        'JOURNEY_STARTED',
        'JOURNEY_COMPLETED',
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Map, of: String },
    deliveryStatus: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'failed'],
      default: 'pending',
    },
    fcmMessageId: String,
    deliveredAt: Date,
  },
  { timestamps: true }
);

NotificationSchema.index({ recipientUserId: 1, createdAt: -1 });

export default mongoose.model<INotification>('Notification', NotificationSchema);
