import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '../store';

/**
 * Thin typed wrapper over AsyncStorage for the small amount of state SafeLink
 * caches locally. The backend remains the source of truth (an active emergency is
 * restored via `GET /emergencies/active`); these values just let the UI show the
 * right thing instantly on a cold start before the network responds.
 */

const KEYS = {
  activeEmergencyId: 'safelink.activeEmergencyId',
  activeTimerId: 'safelink.activeTimerId',
  userProfile: 'safelink.userProfile',
} as const;

export const storage = {
  async setActiveEmergencyId(id: string | null): Promise<void> {
    try {
      if (id) await AsyncStorage.setItem(KEYS.activeEmergencyId, id);
      else await AsyncStorage.removeItem(KEYS.activeEmergencyId);
    } catch {
      /* non-fatal: cache only */
    }
  },

  async getActiveEmergencyId(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(KEYS.activeEmergencyId);
    } catch {
      return null;
    }
  },

  async setActiveTimerId(id: string | null): Promise<void> {
    try {
      if (id) await AsyncStorage.setItem(KEYS.activeTimerId, id);
      else await AsyncStorage.removeItem(KEYS.activeTimerId);
    } catch {
      /* non-fatal: cache only */
    }
  },

  async getActiveTimerId(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(KEYS.activeTimerId);
    } catch {
      return null;
    }
  },

  async setUserProfile(user: User | null): Promise<void> {
    try {
      if (user) await AsyncStorage.setItem(KEYS.userProfile, JSON.stringify(user));
      else await AsyncStorage.removeItem(KEYS.userProfile);
    } catch {
      /* non-fatal */
    }
  },

  async getUserProfile(): Promise<User | null> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.userProfile);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  },

  async clearSession(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([KEYS.activeEmergencyId, KEYS.activeTimerId, KEYS.userProfile]);
    } catch {
      /* non-fatal */
    }
  },
};
