import NetInfo from '@react-native-community/netinfo';

/**
 * Network reachability. The Emergency Engine uses this to distinguish a genuine
 * live connection from an offline state — so the UI can honestly show "LIVE" vs
 * "Reconnecting…" instead of pretending location updates are still flowing.
 */

const isConnected = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) =>
  // isInternetReachable is null while unknown; treat only an explicit false as offline.
  !!state.isConnected && state.isInternetReachable !== false;

/** Subscribe to connectivity changes. Returns an unsubscribe function. */
export const subscribeToNetwork = (onChange: (online: boolean) => void): (() => void) => {
  return NetInfo.addEventListener((state) => onChange(isConnected(state)));
};

/** One-shot connectivity check. */
export const getIsOnline = async (): Promise<boolean> => {
  try {
    const state = await NetInfo.fetch();
    return isConnected(state);
  } catch {
    return true; // assume online rather than block actions on a failed probe
  }
};
