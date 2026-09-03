import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { GOOGLE_SIGNIN_CONFIGURED, getGoogleIdToken } from '../../lib/google-signin';
import { color, font, fontSize, radius, space } from '../../lib/theme';

/**
 * Issue 2 (mobile launch mission) — the mobile equivalent of apps/web's BookingFlow.tsx inline
 * GoogleIdentityButton: browse-first, auth-last. Rendered in place of the real submit button at
 * the final confirm/join step when the visitor is still a guest, never as a full-screen redirect,
 * so nothing about the screen's own state changes. `onBeforeSignIn` lets the caller stash its
 * exact in-progress params (see lib/guest-booking-handoff.ts) before the auth-status flip
 * inevitably swaps the whole navigator tree out from under this screen.
 */
export function GoogleSignInGate({
  label,
  onBeforeSignIn,
}: {
  label: string;
  onBeforeSignIn: () => void;
}) {
  const { googleLogin } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await getGoogleIdToken();
      if (result.type === 'cancelled') return;
      if (result.type === 'error') {
        setError(result.message);
        return;
      }
      onBeforeSignIn();
      await googleLogin({ idToken: result.idToken });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in with Google. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!GOOGLE_SIGNIN_CONFIGURED) {
    return <Text style={styles.unavailableText}>Sign-in is temporarily unavailable. Please try again shortly.</Text>;
  }

  return (
    <View>
      <Text style={styles.hint}>{label}</Text>
      {error && <Text style={styles.errorText}>{error}</Text>}
      <Pressable style={styles.button} onPress={() => void handleSignIn()} disabled={submitting}>
        {submitting ? <ActivityIndicator color={color.ink} /> : <Text style={styles.buttonText}>Continue with Google</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginBottom: space[3] },
  unavailableText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted },
  errorText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: '#8f302d', marginBottom: space[3] },
  button: {
    minHeight: 52,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.ink,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[3],
  },
  buttonText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
});
