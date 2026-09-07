import { Platform } from 'react-native';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  Auth,
  getAuth,
  initializeAuth,
  getReactNativePersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Firebase client configuration.
 *
 * Values come from `EXPO_PUBLIC_FIREBASE_*` env vars (see `.env.example`). These
 * are the public Firebase *web app* config — not secrets — but the project MUST
 * match the backend's `FIREBASE_PROJECT_ID` so the ID tokens this app mints can be
 * verified server-side. Create `mobile/.env` before running on a device.
 */
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const REQUIRED_KEYS: (keyof typeof firebaseConfig)[] = ['apiKey', 'authDomain', 'projectId', 'appId'];
const missing = REQUIRED_KEYS.filter((k) => !firebaseConfig[k]);

/**
 * Non-null when Firebase env vars are missing. The UI surfaces this instead of
 * crashing with an opaque Firebase error, so a misconfigured `.env` is obvious.
 */
export const firebaseConfigError: string | null = missing.length
  ? `Missing Firebase config: ${missing
      .map((k) => `EXPO_PUBLIC_FIREBASE_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`)
      .join(', ')}. Create mobile/.env from .env.example.`
  : null;

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;

if (!firebaseConfigError) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig as Record<string, string>);

  // initializeAuth must run exactly once per app; Fast Refresh can re-run this
  // module, so fall back to getAuth() if it was already initialized.
  try {
    authInstance =
      Platform.OS === 'web'
        ? initializeAuth(app, { persistence: browserLocalPersistence })
        : initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    authInstance = getAuth(app);
  }
}

/** The Firebase Auth instance, or null when config is missing. */
export const firebaseAuth = authInstance;
export { app as firebaseApp };
