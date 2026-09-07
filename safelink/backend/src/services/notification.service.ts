import User from '../models/User.model';
import TrustedContact from '../models/TrustedContact.model';
import Notification, { NotificationType } from '../models/Notification.model';
import { IEmergency } from '../models/Emergency.model';
import { IUser } from '../models/User.model';
import { sendMulticastNotification } from './firebase.service';
import { logger } from '../utils/logger';

export interface NotifyResult {
  totalContacts: number;
  notified: number;      // contacts we created an alert record for
  pushSent: number;      // FCM messages actually delivered
  pushFailed: number;    // FCM messages that failed
}

type Kind = Extract<NotificationType, 'SOS_ACTIVATED' | 'EMERGENCY_RESOLVED'>;

/**
 * Build the title/body for a given notification kind.
 * Kept here so Manual SOS, AI detection, Safety Timer, etc. all render alerts consistently,
 * while still identifying the trigger (an expired Safety Timer reads differently from a
 * hand-pressed SOS).
 */
const buildContent = (kind: Kind, user: IUser, emergency: IEmergency) => {
  if (kind === 'SOS_ACTIVATED') {
    if (emergency.type === 'SAFETY_TIMER') {
      return {
        title: `🚨 SafeLink Safety Alert`,
        body: `${user.name}'s Safety Timer expired and they did not confirm they were safe. Emergency assistance has been activated — tap to view their live location.`,
      };
    }
    return {
      title: `🚨 SafeLink Emergency Alert`,
      body: `${user.name} has activated an emergency alert. Tap to view their live location.`,
    };
  }
  // EMERGENCY_RESOLVED
  return {
    title: `SafeLink Update`,
    body: `${user.name} has ended the emergency and confirmed they are safe.`,
  };
};

/**
 * Notify a user's active trusted contacts about an emergency lifecycle event.
 *
 * Trusted contacts are not (yet) SafeLink account holders, so real push delivery only
 * happens for contacts whose email matches an existing User with a stored fcmToken
 * (forward-compatible "companion" support). Every active contact always gets a persisted
 * Notification record so the alert is auditable and the "N notified" count is real.
 *
 * This is the reusable notification stage of the Emergency Engine — Manual SOS, AI
 * detection, Safety Timer and future IoT triggers all call this same function.
 */
export const notifyContacts = async (
  user: IUser,
  emergency: IEmergency,
  kind: Kind
): Promise<NotifyResult> => {
  const contacts = await TrustedContact.find({
    userId: user._id,
    status: 'active',
  }).sort({ priority: 1 });

  const result: NotifyResult = {
    totalContacts: contacts.length,
    notified: 0,
    pushSent: 0,
    pushFailed: 0,
  };

  if (contacts.length === 0) return result;

  const { title, body } = buildContent(kind, user, emergency);
  const data: Record<string, string> = {
    emergencyId: emergency._id.toString(),
    type: kind,
    userName: user.name,
    latitude: emergency.currentLatitude?.toString() || '',
    longitude: emergency.currentLongitude?.toString() || '',
  };

  // Resolve any contacts that are themselves SafeLink users with an FCM token.
  const contactEmails = contacts.map((c) => c.email).filter(Boolean) as string[];
  const linkedUsers = contactEmails.length
    ? await User.find({ email: { $in: contactEmails }, fcmToken: { $exists: true, $ne: null } }).select('fcmToken')
    : [];
  const fcmTokens = linkedUsers.map((u) => u.fcmToken).filter(Boolean) as string[];

  if (fcmTokens.length > 0) {
    try {
      const resp = await sendMulticastNotification(fcmTokens, title, body, data);
      result.pushSent = resp.successCount;
      result.pushFailed = resp.failureCount;
    } catch (err) {
      logger.warn('notifyContacts: FCM multicast failed', err);
      result.pushFailed = fcmTokens.length;
    }
  }

  // Persist an auditable alert record for every active contact.
  const alertedLine = (contactName: string) =>
    kind === 'EMERGENCY_RESOLVED'
      ? `${user.name} ended the emergency. ${contactName} was notified they are safe.`
      : emergency.type === 'SAFETY_TIMER'
      ? `${user.name}'s Safety Timer expired without a check-in. ${contactName} was alerted.`
      : `${user.name} activated SOS. ${contactName} was alerted.`;

  await Promise.all(
    contacts.map((contact) =>
      Notification.create({
        recipientUserId: user._id,
        emergencyId: emergency._id,
        type: kind,
        title,
        message: alertedLine(contact.name),
        data,
        deliveryStatus: fcmTokens.length > 0 && result.pushFailed === 0 ? 'sent' : 'pending',
      }).catch((err) => logger.warn('notifyContacts: failed to persist notification record', err))
    )
  );

  result.notified = contacts.length;
  return result;
};
