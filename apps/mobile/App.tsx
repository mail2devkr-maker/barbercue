import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Fraunces_500Medium, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import {
  WorkSans_400Regular,
  WorkSans_500Medium,
  WorkSans_600SemiBold,
  WorkSans_700Bold,
} from '@expo-google-fonts/work-sans';
import { Role } from '@barbercue/shared';
import { AuthProvider, useAuth } from './lib/auth-context';
import { LanguageProvider } from './lib/language-context';
import { hasIntroPlayed, markIntroPlayed } from './lib/startup-intro';
import { color } from './lib/theme';
import { OfflineBanner } from './components/OfflineBanner';
import { StartupIntro, StartupIntroErrorBoundary } from './components/StartupIntro';
import AuthStack from './navigation/AuthStack';
import RootNavigator from './navigation/RootNavigator';
import OwnerNavigator from './navigation/OwnerNavigator';
import StaffNavigator from './navigation/StaffNavigator';
import { navigationRef } from './navigation/navigation-ref';
import { replayPendingOwnerBookingPushNavigation } from './lib/push-navigation';
import { PushNotificationCoordinator } from './components/PushNotificationCoordinator';

const FOREGROUND_UPDATE_MIN_BACKGROUND_MS = 30_000;

function useAppUpdates(): void {
  const checkingRef = useRef(false);
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkAndApplyUpdate(): Promise<void> {
      if (cancelled || checkingRef.current || __DEV__ || !Updates.isEnabled) return;
      checkingRef.current = true;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable || cancelled) return;
        await Updates.fetchUpdateAsync();
        if (!cancelled) await Updates.reloadAsync();
      } catch {
        // Update/network failures must never block the embedded app bundle.
      } finally {
        checkingRef.current = false;
      }
    }

    void checkAndApplyUpdate();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        if (backgroundedAtRef.current === null) backgroundedAtRef.current = Date.now();
        return;
      }

      if (nextState === 'active') {
        const backgroundedAt = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (backgroundedAt !== null && Date.now() - backgroundedAt >= FOREGROUND_UPDATE_MIN_BACKGROUND_MS) {
          void checkAndApplyUpdate();
        }
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
}

// Routes by the account's ACTUAL roles (never by which login screen was used to sign in) — an
// owner-role account routes to the Owner shell even if it somehow also carries CUSTOMER, and an
// owner+staff account gets the strictly-more-capable Owner shell. Customer is the fallback: every
// account has at least one role, and the only other roles this app's login screens ever produce
// are OWNER/STAFF, so falling through to Customer only happens for a genuine customer account.
function AuthenticatedNavigator({ roles }: { roles: Role[] }) {
  if (roles.includes(Role.SALON_OWNER)) return <OwnerNavigator />;
  if (roles.includes(Role.SALON_STAFF)) return <StaffNavigator />;
  return <RootNavigator />;
}

function Root() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={color.accent} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} onReady={replayPendingOwnerBookingPushNavigation}>
      <OfflineBanner />
      {status === 'authenticated' && user ? <AuthenticatedNavigator roles={user.roles} /> : <AuthStack />}
    </NavigationContainer>
  );
}

export default function App() {
  useAppUpdates();

  // Cold-start brand intro (P0 mobile app opening brand intro mission) — a centralized gate at
  // the root, above every navigator, so it never needs duplicating inside signed-out/customer/
  // owner/staff shells and works identically regardless of which one the session resolves to.
  // Initialized from hasIntroPlayed() (not a hardcoded false) so a state update elsewhere in this
  // same process — e.g. a fast-refresh in dev — can never replay it either; only a genuinely new
  // process re-evaluates the module and gets false again. Deliberately checked before fontsLoaded
  // below: the video needs no custom font, so gating it on font-load would only delay "immediately
  // transition into the intro" for no reason.
  const [introDone, setIntroDone] = useState(hasIntroPlayed());

  function finishIntro(): void {
    markIntroPlayed();
    setIntroDone(true);
  }

  // Loaded once for the whole app — Fraunces (display/headings) + Work Sans (body/UI), matching
  // apps/web's --font-display / --font-body. Gated behind the same loading view already used for
  // the auth-status check below, rather than a second splash/loading mechanism.
  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    WorkSans_400Regular,
    WorkSans_500Medium,
    WorkSans_600SemiBold,
    WorkSans_700Bold,
  });

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <LanguageProvider>
          {!introDone ? (
            // AuthProvider above already started session restoration on mount — it continues
            // running behind the intro, not blocked by it (see the mission's own requirement).
            <>
              <StartupIntroErrorBoundary onError={finishIntro}>
                <StartupIntro onFinish={finishIntro} />
              </StartupIntroErrorBoundary>
              <StatusBar style="light" />
            </>
          ) : !fontsLoaded ? (
            <View style={styles.loading}>
              <ActivityIndicator color={color.accent} size="large" />
            </View>
          ) : (
            <>
              <PushNotificationCoordinator />
              <Root />
              <StatusBar style="dark" />
            </>
          )}
        </LanguageProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
});
