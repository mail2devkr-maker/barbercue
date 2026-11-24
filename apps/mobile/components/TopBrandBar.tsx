import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

// Same approved artwork as components/ui/BrandLockup (958x259 clean lockup, never redrawn).
const lockupAsset = require('../assets/brand/fastque-clean-lockup.png');
const LOCKUP_ASPECT_RATIO = 958 / 259;
// The artwork has transparent padding around the mark; 34 px tall renders the wordmark ~19 px.
const LOGO_HEIGHT = 34;
const BAR_HEIGHT = 40;
// Always the brand's dark surface: the lockup's cream "Fast" is unreadable on a light bar, so the
// bar (and the status bar icons above it) stay dark/light in every theme.
const BAR_COLOR = '#0d0d12';

const RealInsetsContext = createContext<EdgeInsets | null>(null);

/**
 * The device's true safe-area insets. Inside BrandedShell the context's top inset is 0 (the brand
 * bar already sits under the status bar), so full-screen Modals, which cover the brand bar too,
 * must use this to stay clear of the status bar / notch.
 */
export function useRealInsets(): EdgeInsets {
  const shell = useContext(RealInsetsContext);
  const insets = useSafeAreaInsets();
  return shell ?? insets;
}

/**
 * Owner request: a small FastQue logo at the top of every signed-in page (Android and iOS).
 * Renders one slim bar under the status bar and gives every screen below it a top inset of 0, so
 * existing headers and PremiumScreen paddings start right under the bar instead of leaving a gap.
 */
export function BrandedShell({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const inner = useMemo(() => ({ ...insets, top: 0 }), [insets]);
  return (
    <RealInsetsContext.Provider value={insets}>
      <View style={styles.root}>
        <View style={[styles.bar, { paddingTop: insets.top, height: insets.top + BAR_HEIGHT }]} accessibilityRole="header" accessibilityLabel="FastQue">
          <Image source={lockupAsset} style={styles.logo} resizeMode="contain" accessible={false} />
        </View>
        <SafeAreaInsetsContext.Provider value={inner}>
          <View style={styles.body}>{children}</View>
        </SafeAreaInsetsContext.Provider>
      </View>
    </RealInsetsContext.Provider>
  );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: BAR_COLOR },
    bar: { alignItems: 'center', justifyContent: 'center', backgroundColor: BAR_COLOR, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.10)' },
    logo: { height: LOGO_HEIGHT, width: LOGO_HEIGHT * LOCKUP_ASPECT_RATIO },
    body: { flex: 1 },
  });
