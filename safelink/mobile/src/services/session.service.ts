import { authAPI, userAPI } from './api';
import { getIdToken } from './auth.service';
import { storage } from './storage';
import { useStore, User } from '../store';

/**
 * Session hydration: bridges a Firebase identity to a SafeLink backend profile.
 *
 * The backend's /auth/login and /auth/register read the Firebase ID token from the
 * request BODY (it re-verifies it), so we pass the raw token explicitly here in
 * addition to the Authorization header the API interceptor adds.
 */

export const mapBackendUser = (raw: any): User => ({
  id: raw.id,
  name: raw.name,
  email: raw.email,
  phone: raw.phone,
  profileImage: raw.profileImage,
  emergencyPreferences: raw.emergencyPreferences,
  aiSettings: raw.aiSettings,
  privacySettings: raw.privacySettings,
});

/**
 * Sync the FCM token (if any), then load the full profile (including
 * emergencyPreferences) and put it in the store. Throws if the account isn't
 * registered yet (backend returns 404) so callers can route to registration.
 */
export const hydrateSession = async (fcmToken?: string): Promise<User> => {
  const idToken = await getIdToken();
  if (!idToken) throw new Error('Not signed in.');

  await authAPI.login({ firebaseIdToken: idToken, ...(fcmToken ? { fcmToken } : {}) });
  const { data } = await userAPI.getMe();
  const user = mapBackendUser(data);

  useStore.getState().setUser(user);
  await storage.setUserProfile(user);
  return user;
};

/** Create the backend account for a newly-registered Firebase user, then hydrate. */
export const registerBackendUser = async (input: {
  name: string;
  email: string;
  phone: string;
}): Promise<User> => {
  const idToken = await getIdToken();
  if (!idToken) throw new Error('Not signed in.');

  await authAPI.register({ ...input, firebaseIdToken: idToken });
  return hydrateSession();
};
