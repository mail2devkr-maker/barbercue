import { NativeModules, TurboModuleRegistry } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * OTA safety (13 Nov): an EAS Update reaches EVERY binary on the same channel + runtime version,
 * including older Android 1.0.7 (vc30-33) and iOS 1.0.6 (builds 6-8) installs that do not contain
 * native modules added later (expo-document-picker, expo-speech-recognition, react-native-view-shot).
 * Importing such a module eagerly throws at app start on those binaries. Features built on them load
 * the module only after this check, and simply stay hidden on a binary that lacks it.
 */
export function hasExpoNativeModule(name: string): boolean {
  try {
    return requireOptionalNativeModule(name) != null;
  } catch {
    return false;
  }
}

export function hasTurboNativeModule(name: string): boolean {
  try {
    return TurboModuleRegistry.get(name) != null || NativeModules[name] != null;
  } catch {
    return false;
  }
}
