import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Refresh-token persistence — real Keychain/Keystore-backed SecureStore on iOS/Android per
 * ARCHITECTURE.md §4 ("secure storage on mobile"). expo-secure-store has no native backing on
 * web (its web module is an empty stub — there is no OS keychain in a browser), and the shipped
 * customer product for web is the separate Next.js site, not this Expo app. The localStorage
 * fallback below exists solely so this app's auth flow can be exercised via `expo start --web`
 * in environments with no iOS/Android device or emulator available — it is deliberately never
 * used on a real mobile build (Platform.OS is 'ios' or 'android' there, never 'web').
 */
export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
