// QA review candidate: this must run before Expo imports React Native's Animated helper.
// Send each Animated flush to Android as one native batch. This is a private React Native
// feature flag, so the behavior requires device-level validation before any OTA publication.
// @ts-ignore - This private Flow-typed React Native module has no TypeScript declaration.
import * as ReactNativeFeatureFlags from 'react-native/src/private/featureflags/ReactNativeFeatureFlags';

ReactNativeFeatureFlags.override({ animatedShouldUseSingleOp: () => true });
