import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { passwordChangeUrl } from '../lib/password-change-gate';
import { fastQue, font, fontSize, radius, space } from '../lib/theme';

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN ?? 'https://fastque.com';

/**
 * Shown instead of the app while the account holds an administrator-issued temporary password. The password is changed
 * on the FastQue website (the same page web users get); after that, signing in again with the new password opens the
 * app normally. Nothing in this notice handles a password.
 */
export function PasswordChangeRequiredNotice({ onSignOut }: { onSignOut: () => void }) {
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Text style={styles.title}>Choose your own password first</Text>
      <Text style={styles.body}>
        Your account was set up with a temporary password, so FastQue is paused for it until you replace it. Change it on the
        FastQue website, then sign in here again with your new password.
      </Text>
      <Pressable
        accessibilityRole="button"
        style={styles.primary}
        onPress={() => void Linking.openURL(passwordChangeUrl(WEB_ORIGIN))}
      >
        <Text style={styles.primaryText}>Open the FastQue website</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.secondary} onPress={onSignOut}>
        <Text style={styles.secondaryText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: space[6], backgroundColor: fastQue.background },
  title: { fontFamily: font.displayMedium, fontSize: fontSize.xl, color: fastQue.text, marginBottom: space[4] },
  body: { fontFamily: font.bodyRegular, fontSize: fontSize.base, color: fastQue.textSecondary, marginBottom: space[6] },
  primary: { backgroundColor: fastQue.coral, borderRadius: radius.md, padding: space[4], alignItems: 'center', marginBottom: space[4] },
  primaryText: { fontFamily: font.bodyBold, color: '#ffffff' },
  secondary: { padding: space[4], alignItems: 'center' },
  secondaryText: { fontFamily: font.bodyRegular, color: fastQue.textMuted },
});
