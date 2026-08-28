import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  GoogleOneTapSignIn,
  isCancelledResponse,
  isErrorWithCode,
  isNoSavedCredentialFoundResponse,
  isSuccessResponse,
  statusCodes,
} from 'react-native-nitro-google-signin';
import {
  AUTH_PATHS,
  OTP_RESEND_COOLDOWN_SECONDS,
  otpRequestSchema,
  otpVerifySchema,
  type AuthMethodsDto,
} from '@barbercue/shared';
import { ApiError, apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { color, font, fontSize, radius, space } from '../lib/theme';

// GoogleSignInButton is only ever mounted when a web client ID is configured (see
// GOOGLE_CONFIGURED below), so configure() only ever runs with a real value. Native Google
// Sign-In via Android Credential Manager — no browser redirect, no custom URI scheme, so no
// dependency on this app's own package/scheme being reachable from a browser tab. The Android
// OAuth client (package name + release SHA-1, registered in Google Cloud Console) is still what
// Credential Manager checks the caller against; only the Web client ID is passed here — Google's
// own convention for native sign-in, so ID tokens can be verified server-side (GoogleAuthService)
// against the same audience the web app already uses.
const GOOGLE_CONFIGURED = Boolean(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);
if (GOOGLE_CONFIGURED) {
  GoogleOneTapSignIn.configure({ webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID! });
}

type Step = 'phone' | 'otp';

function GoogleSignInButton() {
  const { googleLogin } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setError(null);
    setSubmitting(true);
    try {
      await GoogleOneTapSignIn.checkPlayServices();
      // signIn() is the low-friction path (no account picker if there's already one saved
      // credential); createAccount() falls back to the full picker when signIn() has nothing to
      // offer — same "new here? this creates your account automatically" promise as OTP below.
      let response = await GoogleOneTapSignIn.signIn();
      if (isNoSavedCredentialFoundResponse(response)) {
        response = await GoogleOneTapSignIn.createAccount();
      }
      if (isCancelledResponse(response)) return;
      if (isSuccessResponse(response)) {
        await googleLogin({ idToken: response.data.idToken });
      }
    } catch (err) {
      if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) {
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not sign in with Google. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorCardText}>{error}</Text>
        </View>
      )}
      <Pressable style={styles.googleButton} onPress={() => void handleGoogleSignIn()} disabled={submitting}>
        {submitting ? (
          <ActivityIndicator color={color.ink} />
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
  // Whether this deployment can actually complete a phone OTP. Null while unknown, so the form is
  // hidden until we know rather than briefly offering something guaranteed to fail. Mirrors
  // apps/web's login page exactly — the two clients must not disagree about what sign-in is
  // available.
  const [phoneOtpAvailable, setPhoneOtpAvailable] = useState<boolean | null>(null);

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

  // OTP delivery depends on an SMS provider that may not be configured; when it isn't,
  // auth/otp/request answers 502 OTP_DELIVERY_FAILED after the customer has already typed their
  // number. Asking the backend up front lets us offer Google instead of a dead end.
  useEffect(() => {
    let cancelled = false;
    apiFetch<AuthMethodsDto>(`auth/${AUTH_PATHS.methods}`)
      .then((m) => {
        if (!cancelled) setPhoneOtpAvailable(m.phoneOtp);
      })
      // If the probe itself fails, show the form as before: a working sign-in method must not
      // disappear because one extra request was unlucky.
      .catch(() => {
        if (!cancelled) setPhoneOtpAvailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {/* Restrained warmth without a gradient dependency — two soft, low-opacity tinted circles,
          not an illustration or photo. */}
      <View style={styles.blobGold} pointerEvents="none" />
      <View style={styles.blobAccent} pointerEvents="none" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={insets.top}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: Math.max(insets.top, space[6]), paddingBottom: Math.max(insets.bottom, space[6]) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <View style={styles.badgeHalo}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>BC</Text>
              </View>
            </View>
            <Text style={styles.wordmark}>BarberCue</Text>
          </View>

          <Text style={styles.eyebrow}>Sign in</Text>
          <Text style={styles.subtitle}>
            {step === 'phone'
              ? phoneOtpAvailable === false
                ? 'Continue with Google. New here? This creates your account automatically.'
                : 'Continue with Google, or use a one-time code. New here? This creates your account automatically.'
              : `Enter the code sent to ${phone}.`}
          </Text>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorCardText}>{error}</Text>
            </View>
          )}
          {resendMessage && (
            <View style={styles.successCard}>
              <Text style={styles.successCardText}>{resendMessage}</Text>
            </View>
          )}

          <View style={styles.card}>
            {step === 'phone' ? (
              <>
                {GOOGLE_CONFIGURED && <GoogleSignInButton />}
                {phoneOtpAvailable === false ? (
                  <View style={styles.noticeCard}>
                    <Text style={styles.noticeCardText}>
                      Phone sign-in is temporarily unavailable. Please continue with Google above —
                      it&apos;s the same account either way.
                    </Text>
                  </View>
                ) : phoneOtpAvailable === null ? (
                  <ActivityIndicator color={color.muted} />
                ) : (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder="+919876543210"
                      placeholderTextColor={color.muted}
                      keyboardType="phone-pad"
                      value={phone}
                      onChangeText={setPhone}
                    />
                    <Pressable style={styles.primaryButton} onPress={() => void requestOtp()} disabled={submitting}>
                      {submitting ? (
                        <ActivityIndicator color={color.accentContrast} />
                      ) : (
                        <Text style={styles.primaryButtonText}>Send OTP</Text>
                      )}
                    </Pressable>
                  </>
                )}
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="6-digit code"
                  placeholderTextColor={color.muted}
                  keyboardType="number-pad"
                  value={code}
                  onChangeText={setCode}
                  autoFocus
                />
                <Pressable style={styles.primaryButton} onPress={() => void verifyOtp()} disabled={submitting}>
                  {submitting ? (
                    <ActivityIndicator color={color.accentContrast} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Verify & Continue</Text>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.resendButton, (resendCooldown > 0 || resending) && styles.resendButtonDisabled]}
                  onPress={() => void handleResend()}
                  disabled={resendCooldown > 0 || resending}
                >
                  {resending ? (
                    <ActivityIndicator color={color.ink} />
                  ) : (
                    <Text style={styles.resendButtonText}>
                      {resendCooldown > 0 ? `Resend OTP in ${resendCooldown}s` : 'Resend OTP'}
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space[5] },

  // Restrained warmth — two soft, low-opacity tinted circles standing in for a gradient. Gold
  // (decorative) top-left, terracotta (also decorative here, not an action) bottom-right, both
  // subtle enough to read as texture, not decoration competing with the form.
  blobGold: {
    position: 'absolute',
    top: -80,
    left: -70,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: color.goldSoft,
    opacity: 0.6,
  },
  blobAccent: {
    position: 'absolute',
    bottom: -100,
    right: -90,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: color.accentSoft,
  },

  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[6],
  },
  badgeHalo: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(168, 121, 31, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space[3],
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: color.surface,
    fontFamily: font.bodyBold,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  wordmark: {
    fontFamily: font.displaySemiBold,
    fontSize: fontSize.xl,
    color: color.ink,
    letterSpacing: -0.3,
  },

  eyebrow: {
    fontFamily: font.bodyBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: color.gold,
    textAlign: 'center',
    marginBottom: space[2],
  },
  subtitle: {
    fontFamily: font.bodyRegular,
    fontSize: fontSize.sm,
    lineHeight: 21,
    color: color.muted,
    textAlign: 'center',
    marginBottom: space[5],
  },

  errorCard: {
    borderWidth: 1,
    borderColor: 'rgba(176, 65, 62, 0.24)',
    backgroundColor: color.accentSoft,
    borderRadius: radius.sm,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    marginBottom: space[4],
  },
  errorCardText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: '#8f302d', textAlign: 'center' },

  successCard: {
    borderWidth: 1,
    borderColor: 'rgba(46, 125, 50, 0.24)',
    backgroundColor: color.successSoft,
    borderRadius: radius.sm,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    marginBottom: space[4],
  },
  successCardText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: '#286d2c', textAlign: 'center' },

  noticeCard: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.goldSoft,
    borderRadius: radius.sm,
    padding: space[4],
  },
  noticeCardText: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: 19, color: color.muted },

  card: {
    backgroundColor: '#ffffff',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: space[5],
    shadowColor: color.ink,
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  input: {
    minHeight: 52,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    color: color.ink,
    fontFamily: font.bodyRegular,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    fontSize: fontSize.base,
    marginBottom: space[4],
  },

  primaryButton: {
    minHeight: 52,
    backgroundColor: color.accent,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[3],
  },
  primaryButtonText: { fontFamily: font.bodyBold, fontSize: fontSize.base, color: color.accentContrast },

  googleButton: {
    minHeight: 52,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.ink,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[3],
  },
  googleButtonText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: space[4] },
  dividerLine: { flex: 1, height: 1, backgroundColor: color.border },
  dividerText: {
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: color.muted,
    marginHorizontal: space[3],
  },

  resendButton: {
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[2] + 4,
    marginTop: space[3],
  },
  resendButtonDisabled: { borderColor: color.border },
  resendButtonText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink },
});
