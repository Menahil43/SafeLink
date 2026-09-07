import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const LOCK_SCREEN_SOS_ACTION = 'ACTIVATE_SOS';
const LOCK_SCREEN_SOS_CATEGORY = 'SAFELINK_SOS_ACCESS';
const LOCK_SCREEN_SOS_CHANNEL = 'safelink-sos-access';
const LOCK_SCREEN_SOS_NOTIFICATION_ID = 'safelink-lock-screen-sos';

/**
 * Local notifications for on-device emergency feedback (e.g. confirming SOS was
 * sent). This powers *local* alerts only.
 *
 * NOTE — Expo Go limitation: Expo Go (SDK 53+) removed remote push support on
 * Android. Delivering push to a trusted contact's device therefore requires a
 * development build + FCM credentials. The trusted-contact notification itself is
 * performed server-side (persisted alert records + FCM to any linked SafeLink
 * users), so this module never fabricates a delivery it cannot make.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Ask for notification permission. Returns true only if granted. */
export const requestNotificationPermission = async (): Promise<boolean> => {
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return true;
    }
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
};

/**
 * Publish Android's supported lock-screen-accessible entry point. Android does not
 * expose the Camera/Torch shortcut area to third-party apps; this is a real system
 * notification action and contains no account, contact, token, or location data.
 */
export const showLockScreenSosAction = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;

  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return false;

    await Notifications.setNotificationChannelAsync(LOCK_SCREEN_SOS_CHANNEL, {
      name: 'Emergency access',
      description: 'Lock-screen action for starting a SafeLink emergency.',
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: null,
      vibrationPattern: [0, 250, 250, 250],
    });
    await Notifications.setNotificationCategoryAsync(
      LOCK_SCREEN_SOS_CATEGORY,
      [
        {
          identifier: LOCK_SCREEN_SOS_ACTION,
          buttonTitle: 'Activate SOS',
          options: { opensAppToForeground: true, isDestructive: true },
        },
      ]
    );
    await Notifications.cancelScheduledNotificationAsync(LOCK_SCREEN_SOS_NOTIFICATION_ID).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      identifier: LOCK_SCREEN_SOS_NOTIFICATION_ID,
      content: {
        title: 'SafeLink emergency access',
        body: 'Activate an SOS without opening the app.',
        categoryIdentifier: LOCK_SCREEN_SOS_CATEGORY,
        sticky: true,
        autoDismiss: false,
        data: { kind: 'LOCK_SCREEN_SOS' },
      },
      trigger: { channelId: LOCK_SCREEN_SOS_CHANNEL },
    });
    return true;
  } catch {
    return false;
  }
};

export const hideLockScreenSosAction = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;
  await Notifications.cancelScheduledNotificationAsync(LOCK_SCREEN_SOS_NOTIFICATION_ID).catch(() => undefined);
};

/** Show an immediate local notification on this device. Best-effort. */
export const presentLocalNotification = async (title: string, body: string): Promise<void> => {
  try {
    if (Platform.OS === 'web') return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null, // deliver now
    });
  } catch {
    /* non-fatal: local feedback only */
  }
};
