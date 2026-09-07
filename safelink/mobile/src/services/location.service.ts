import * as Location from 'expo-location';

/**
 * Device GPS access for the Emergency Engine. All functions are defensive: a denied
 * permission or a hardware failure resolves to a safe value (false / null) rather
 * than throwing, so activating an emergency never crashes the app — the emergency
 * still proceeds, just without a location fix.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  direction?: number;
}

export type LocationSubscription = { remove: () => void };

/** Ask for foreground location permission. Returns true only if granted. */
export const requestLocationPermission = async (): Promise<boolean> => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
};

/** Whether foreground location permission is currently granted. */
export const hasLocationPermission = async (): Promise<boolean> => {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
};

const toCoords = (loc: Location.LocationObject): Coordinates => ({
  latitude: loc.coords.latitude,
  longitude: loc.coords.longitude,
  accuracy: loc.coords.accuracy ?? undefined,
  speed: loc.coords.speed ?? undefined,
  direction: loc.coords.heading ?? undefined,
});

/**
 * One-shot current position. Requests permission if needed. Returns null when
 * permission is denied or the fix fails — callers must handle "location unavailable".
 */
export const getCurrentPosition = async (): Promise<Coordinates | null> => {
  try {
    const granted = (await hasLocationPermission()) || (await requestLocationPermission());
    if (!granted) return null;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return toCoords(loc);
  } catch {
    return null;
  }
};

/**
 * Continuously watch position for live emergency tracking. `intervalSeconds`
 * mirrors the user's `locationUpdateIntervalEmergency` preference. Returns a
 * subscription whose `remove()` stops tracking, or null if it couldn't start.
 */
export const watchPosition = async (
  onUpdate: (coords: Coordinates) => void,
  intervalSeconds = 5
): Promise<LocationSubscription | null> => {
  try {
    const granted = (await hasLocationPermission()) || (await requestLocationPermission());
    if (!granted) return null;
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: Math.max(1, intervalSeconds) * 1000,
        distanceInterval: 5,
      },
      (loc) => onUpdate(toCoords(loc))
    );
    return sub;
  } catch {
    return null;
  }
};
