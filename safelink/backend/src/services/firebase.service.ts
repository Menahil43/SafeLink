import admin from 'firebase-admin';
import { logger } from '../utils/logger';

let initialized = false;

export const initializeFirebase = (): void => {
  if (initialized) return;

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    initialized = true;
    logger.info('✅ Firebase Admin initialized');
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin:', error);
    throw error;
  }
};

export const getFirebaseAdmin = () => admin;

export const verifyIdToken = async (idToken: string) => {
  return admin.auth().verifyIdToken(idToken);
};

export const sendPushNotification = async (
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<string> => {
  const message: admin.messaging.Message = {
    token: fcmToken,
    notification: { title, body },
    data: data || {},
    android: {
      priority: 'high',
      notification: {
        sound: 'emergency_alert',
        priority: 'max',
        channelId: 'safelink_emergency',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'emergency_alert.caf',
          badge: 1,
          contentAvailable: true,
        },
      },
      headers: { 'apns-priority': '10' },
    },
  };

  const response = await admin.messaging().send(message);
  return response;
};

export const sendMulticastNotification = async (
  fcmTokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<admin.messaging.BatchResponse> => {
  const message: admin.messaging.MulticastMessage = {
    tokens: fcmTokens,
    notification: { title, body },
    data: data || {},
    android: {
      priority: 'high',
      notification: {
        sound: 'emergency_alert',
        priority: 'max',
        channelId: 'safelink_emergency',
      },
    },
    apns: {
      payload: {
        aps: { sound: 'emergency_alert.caf', badge: 1, contentAvailable: true },
      },
      headers: { 'apns-priority': '10' },
    },
  };

  return admin.messaging().sendEachForMulticast(message);
};
