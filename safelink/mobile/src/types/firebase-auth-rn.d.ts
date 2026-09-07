// Firebase JS SDK ships `getReactNativePersistence` only in its React Native
// build (`@firebase/auth/dist/rn`). Metro resolves that build at runtime via the
// package's "react-native" export condition, so the function exists on the device —
// but the default `firebase/auth` type entry omits it, so TypeScript can't see it.
// This augmentation re-declares the missing export. Remove if a future firebase
// release exposes it from the main type entry.
import type { Persistence } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: {
    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;
  }): Persistence;
}
