import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  type User as FirebaseUser,
  type Unsubscribe,
} from 'firebase/auth';
import { firebaseAuth, firebaseConfigError } from '../config/firebase';

/**
 * Firebase-only authentication primitives. This module never talks to the SafeLink
 * backend directly (that would create an import cycle with the API layer, which
 * depends on `getIdToken` here). Screens compose these with `authAPI` from `api.ts`.
 */

const ensureAuth = () => {
  if (!firebaseAuth) {
    throw new Error(firebaseConfigError || 'Firebase is not configured.');
  }
  return firebaseAuth;
};

/** Human-friendly message for a Firebase auth error code. */
export const mapFirebaseError = (err: unknown): string => {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/email-already-in-use':
      return 'An account already exists for this email. Try signing in.';
    case 'auth/weak-password':
      return 'Password is too weak — use at least 6 characters.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return (err as Error)?.message || 'Authentication failed. Please try again.';
  }
};

/** Current Firebase user, or null if signed out / not configured. */
export const getCurrentFirebaseUser = (): FirebaseUser | null => firebaseAuth?.currentUser ?? null;

/**
 * The current user's Firebase ID token, or null when signed out. Every protected
 * backend request attaches this as `Authorization: Bearer <token>`. Firebase caches
 * and auto-refreshes the token; pass forceRefresh to bypass the cache.
 */
export const getIdToken = async (forceRefresh = false): Promise<string | null> => {
  const user = firebaseAuth?.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
};

/** Create a Firebase account and return the user + a fresh ID token. */
export const registerWithEmail = async (
  email: string,
  password: string,
  displayName?: string
): Promise<{ user: FirebaseUser; idToken: string }> => {
  const auth = ensureAuth();
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (displayName) {
    await updateProfile(cred.user, { displayName }).catch(() => undefined);
  }
  const idToken = await cred.user.getIdToken();
  return { user: cred.user, idToken };
};

/** Sign in with email/password and return the user + a fresh ID token. */
export const signInWithEmail = async (
  email: string,
  password: string
): Promise<{ user: FirebaseUser; idToken: string }> => {
  const auth = ensureAuth();
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  const idToken = await cred.user.getIdToken();
  return { user: cred.user, idToken };
};

/** Sign the user out of Firebase (clears persisted session). */
export const signOutUser = async (): Promise<void> => {
  if (!firebaseAuth) return;
  await signOut(firebaseAuth);
};

/** Send a password-reset email via Firebase. */
export const sendReset = async (email: string): Promise<void> => {
  const auth = ensureAuth();
  await sendPasswordResetEmail(auth, email.trim());
};

/**
 * Subscribe to Firebase auth-state changes. Fires once on startup with the
 * restored (persisted) user — the basis for session restoration on app launch.
 */
export const onAuthChange = (cb: (user: FirebaseUser | null) => void): Unsubscribe => {
  if (!firebaseAuth) {
    cb(null);
    return () => undefined;
  }
  return onAuthStateChanged(firebaseAuth, cb);
};
