import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { AUTH_PATHS, OTP_RESEND_COOLDOWN_SECONDS, otpRequestSchema, otpVerifySchema } from '@barbercue/shared';
import { ApiError, apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth-context';

// Required once per app by expo-auth-session so the in-app browser tab closes itself after
// Google redirects back — see https://docs.expo.dev/versions/v57.0.0/sdk/auth-session/.
WebBrowser.maybeCompleteAuthSession();

type Step = 'phone' | 'otp';

// expo-auth-session's Google provider throws synchronously (invariantClientId) when the
// platform-appropriate client ID is missing — it is NOT safe to call the hook unconditionally as
// originally assumed here. GoogleSignInButton is only ever mounted when at least one client ID is
// configured, so the hook never runs with a missing value; this constant gates that mount.
const GOOGLE_CONFIGURED = Boolean(
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
);

function GoogleSignInButton() {
  const { googleLogin } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleRequest, googleResponse, promptGoogleSignIn] = Google.useIdTokenAuthRequest({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });

  useEffect(() => {
    if (googleResponse?.type !== 'success') return;
    const idToken = googleResponse.params.id_token;
    if (!idToken) return;
    setError(null);
    setSubmitting(true);
    googleLogin({ idToken })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Could not sign in with Google. Please try again.');
      })
      .finally(() => setSubmitting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleResponse]);

  return (
    <>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={styles.googleButton}
        onPress={() => void promptGoogleSignIn()}
        disabled={!googleRequest || submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#1C1A17" />
        ) : (
          <Text style={styles.googleButtonText}>Continue with Google</Text>
        )}
      </Pressable>
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>
    </>
  );
}

// Customer-only per ARCHITECTURE.md §2 — staff/owner/admin use the web dashboard, not this app.
export default function PhoneOtpLoginScreen() {
  const { verifyCustomerOtp } = useAuth();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  // Seconds remaining before "Resend OTP" is enabled again; 0 = enabled. Starts counting the
  // moment a code is sent (initial send or a resend) — a client-side throttle only, layered on
  // top of (never replacing) OtpService's server-side per-phone rate limit. Mirrors apps/web's
  // login page so the two clients behave identically.
  const [resendCooldown, setResendCooldown] = useState(0);

  // Ticks the cooldown down once a second while on the OTP step. Cleared on unmount/step change
  // (including app backgrounding/killing, since this is component state, not persisted) so no
  // stale timer fires after the screen is gone.
  useEffect(() => {
    if (step !== 'otp' || resendCooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setResendCooldown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, resendCooldown]);

  async function sendOtp(targetPhone: string): Promise<void> {
    await apiFetch(`auth/${AUTH_PATHS.otpRequest}`, { method: 'POST', body: JSON.stringify({ phone: targetPhone }) });
  }

  async function requestOtp() {
    setError(null);
    const parsed = otpRequestSchema.safeParse({ phone });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid phone number.');
      return;
    }
    setSubmitting(true);
    try {
      await sendOtp(parsed.data.phone);
      setStep('otp');
      setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send OTP. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || resending) return;
    setError(null);
    setResendMessage(null);
    setResending(true);
    try {
      await sendOtp(phone);
      setResendMessage('A new code has been sent.');
    } catch (err) {
      // The backend's OTP_RATE_LIMITED message is already written for end users (see
      // OtpService) — surfaced as-is rather than replaced with a generic string.
      setError(err instanceof ApiError ? err.message : 'Could not resend the code. Please try again.');
    } finally {
      // Restart the cooldown on both success and failure — on failure this also prevents
      // hammering the resend button (and the server's rate limit) with instant retries.
      setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      setResending(false);
    }
  }

  async function verifyOtp() {
    setError(null);
    setResendMessage(null);
    const parsed = otpVerifySchema.safeParse({ phone, code });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid code.');
      return;
    }
    setSubmitting(true);
    try {
      await verifyCustomerOtp(parsed.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify OTP. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>BarberCue</Text>
      <Text style={styles.subtitle}>
        {step === 'phone'
          ? 'Continue with Google, or use a one-time code. New here? This creates your account automatically.'
          : `Enter the code sent to ${phone}.`}
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}
      {resendMessage && <Text style={styles.success}>{resendMessage}</Text>}

      {step === 'phone' ? (
        <>
          {GOOGLE_CONFIGURED && <GoogleSignInButton />}
          <TextInput
            style={styles.input}
            placeholder="+919876543210"
            placeholderTextColor="#B8AFA0"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />
          <Pressable style={styles.button} onPress={() => void requestOtp()} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#EDE6DA" /> : <Text style={styles.buttonText}>Send OTP</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="6-digit code"
            placeholderTextColor="#B8AFA0"
            keyboardType="number-pad"
            value={code}
            onChangeText={setCode}
            autoFocus
          />
          <Pressable style={styles.button} onPress={() => void verifyOtp()} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color="#EDE6DA" />
            ) : (
              <Text style={styles.buttonText}>Verify & Continue</Text>
            )}
          </Pressable>
          <Pressable
            style={styles.resendButton}
            onPress={() => void handleResend()}
            disabled={resendCooldown > 0 || resending}
          >
            {resending ? (
              <ActivityIndicator color="#EDE6DA" />
            ) : (
              <Text style={styles.resendButtonText}>
                {resendCooldown > 0 ? `Resend OTP in ${resendCooldown}s` : 'Resend OTP'}
              </Text>
            )}
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', justifyContent: 'center', padding: 24 },
  title: { fontSize: 34, fontWeight: '700', color: '#EDE6DA', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#B8AFA0', textAlign: 'center', marginTop: 8, marginBottom: 32 },
  error: { color: '#E24B4A', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  success: { color: '#5FA777', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  input: {
    backgroundColor: '#2A2723',
    color: '#EDE6DA',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    marginBottom: 16,
  },
  button: { backgroundColor: '#B0413E', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#EDE6DA', fontSize: 16, fontWeight: '600' },
  googleButton: {
    backgroundColor: '#EDE6DA',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  googleButtonText: { color: '#1C1A17', fontSize: 15, fontWeight: '600' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#2A2723' },
  dividerText: { color: '#B8AFA0', fontSize: 12, marginHorizontal: 10 },
  resendButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2723',
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  resendButtonText: { color: '#EDE6DA', fontSize: 14, fontWeight: '600' },
});
