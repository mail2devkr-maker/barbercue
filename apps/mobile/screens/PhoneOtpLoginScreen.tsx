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
  AUTH_PATHS,
  OTP_RESEND_COOLDOWN_SECONDS,
  otpRequestSchema,
  otpVerifySchema,
  type AuthMethodsDto,
} from '@barbercue/shared';
import { ApiError, apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { GOOGLE_SIGNIN_CONFIGURED, getGoogleIdToken } from '../lib/google-signin';
import { useLanguage } from '../lib/language-context';
import { color, fastQue, font, fontSize, radius, space } from '../lib/theme';
import { BrandLockup, GradientView } from '../components/ui';

// Exact website 3-stop brand gradient (pink 0% -> coral 55% -> orange 100%, matching
// apps/web/components/landing/landing.module.css's `--fq-gradient` on master).
const GRADIENT_COLORS = [fastQue.gradientStart, fastQue.gradientMid, fastQue.gradientEnd] as const;
const GRADIENT_STOPS = [0, 0.55, 1] as const;

type Step = 'phone' | 'otp';

function GoogleSignInButton() {
  const { googleLogin } = useAuth();
  const { t } = useLanguage();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await getGoogleIdToken(t);
      if (result.type === 'cancelled') return;
      if (result.type === 'error') {
        setError(result.message);
        return;
      }
      await googleLogin({ idToken: result.idToken });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotSignInWithGoogle);
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
          <ActivityIndicator color={fastQue.text} />
        ) : (
          <Text style={styles.googleButtonText}>{t.continueWithGoogle}</Text>
        )}
      </Pressable>
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{t.orDivider}</Text>
        <View style={styles.dividerLine} />
      </View>
    </>
  );
}

// Customer-only per ARCHITECTURE.md §2 — staff/owner/admin use the web dashboard, not this app.
export default function PhoneOtpLoginScreen() {
  const { verifyCustomerOtp } = useAuth();
  const { t } = useLanguage();
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
      setError(parsed.error.issues[0]?.message ?? t.invalidPhoneNumber);
      return;
    }
    setSubmitting(true);
    try {
      await sendOtp(parsed.data.phone);
      setStep('otp');
      setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotSendOtp);
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
      setResendMessage(t.newCodeSent);
    } catch (err) {
      // The backend's OTP_RATE_LIMITED message is already written for end users (see
      // OtpService) — surfaced as-is rather than replaced with a generic string.
      setError(err instanceof ApiError ? err.message : t.couldNotResendCode);
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
      setError(parsed.error.issues[0]?.message ?? t.invalidCode);
      return;
    }
    setSubmitting(true);
    try {
      await verifyCustomerOtp(parsed.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotVerifyOtp);
    } finally {
      setSubmitting(false);
    }
  }

  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
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
          <BrandLockup variant="auth" style={styles.brandLockup} />

          <Text style={styles.eyebrow}>{t.signInTitle}</Text>
          <Text style={styles.subtitle}>
            {step === 'phone'
              ? phoneOtpAvailable === false
                ? t.otpSubtitleGoogleOnly
                : t.otpSubtitleBoth
              : `${t.enterCodeSentToPrefix}${phone}.`}
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
                {GOOGLE_SIGNIN_CONFIGURED && <GoogleSignInButton />}
                {phoneOtpAvailable === false ? (
                  <View style={styles.noticeCard}>
                    <Text style={styles.noticeCardText}>
                      {t.phoneOtpUnavailableNotice}
                    </Text>
                  </View>
                ) : phoneOtpAvailable === null ? (
                  <ActivityIndicator color={fastQue.textSecondary} />
                ) : (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder={t.phoneNumberPlaceholder}
                      placeholderTextColor={fastQue.textSecondary}
                      keyboardType="phone-pad"
                      value={phone}
                      onChangeText={setPhone}
                    />
                    <Pressable onPress={() => void requestOtp()} disabled={submitting}>
                      <GradientView colors={GRADIENT_COLORS} stops={GRADIENT_STOPS} style={styles.primaryButton}>
                        {submitting ? (
                          <ActivityIndicator color={color.accentContrast} />
                        ) : (
                          <Text style={styles.primaryButtonText}>{t.sendOtpAction}</Text>
                        )}
                      </GradientView>
                    </Pressable>
                  </>
                )}
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder={t.otpCodePlaceholder}
                  placeholderTextColor={fastQue.textSecondary}
                  keyboardType="number-pad"
                  value={code}
                  onChangeText={setCode}
                  autoFocus
                />
                <Pressable onPress={() => void verifyOtp()} disabled={submitting}>
                  <GradientView colors={GRADIENT_COLORS} stops={GRADIENT_STOPS} style={styles.primaryButton}>
                    {submitting ? (
                      <ActivityIndicator color={color.accentContrast} />
                    ) : (
                      <Text style={styles.primaryButtonText}>{t.verifyAndContinueAction}</Text>
                    )}
                  </GradientView>
                </Pressable>
                <Pressable
                  style={[styles.resendButton, (resendCooldown > 0 || resending) && styles.resendButtonDisabled]}
                  onPress={() => void handleResend()}
                  disabled={resendCooldown > 0 || resending}
                >
                  {resending ? (
                    <ActivityIndicator color={fastQue.text} />
                  ) : (
                    <Text style={styles.resendButtonText}>
                      {resendCooldown > 0 ? `${t.resendOtpInPrefix}${resendCooldown}${t.resendOtpInSuffix}` : t.resendOtpAction}
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
  root: { flex: 1, backgroundColor: fastQue.background },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space[5] },

  // Restrained warmth — two soft, low-opacity tinted circles standing in for a gradient. Brand
  // pink (decorative) top-left, brand orange (also decorative here, not an action) bottom-right —
  // the website-parity `--fq-pink`/`--fq-orange` hues instead of the legacy gold/terracotta pair,
  // both subtle enough to read as texture, not decoration competing with the form.
  blobGold: {
    position: 'absolute',
    top: -80,
    left: -70,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(242, 10, 131, 0.12)',
  },
  blobAccent: {
    position: 'absolute',
    bottom: -100,
    right: -90,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255, 122, 69, 0.10)',
  },

  brandLockup: { alignSelf: 'center', marginBottom: space[6] },

  eyebrow: {
    fontFamily: font.bodyBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: fastQue.orange,
    textAlign: 'center',
    marginBottom: space[2],
  },
  subtitle: {
    fontFamily: font.bodyRegular,
    fontSize: fontSize.sm,
    lineHeight: 21,
    color: fastQue.textSecondary,
    textAlign: 'center',
    marginBottom: space[5],
  },

  errorCard: {
    borderWidth: 1,
    borderColor: 'rgba(255, 139, 154, 0.35)',
    backgroundColor: 'rgba(255, 139, 154, 0.12)',
    borderRadius: radius.sm,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    marginBottom: space[4],
  },
  errorCardText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: fastQue.error, textAlign: 'center' },

  successCard: {
    borderWidth: 1,
    borderColor: 'rgba(114, 213, 154, 0.35)',
    backgroundColor: 'rgba(114, 213, 154, 0.12)',
    borderRadius: radius.sm,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    marginBottom: space[4],
  },
  successCardText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: fastQue.success, textAlign: 'center' },

  noticeCard: {
    borderWidth: 1,
    borderColor: fastQue.border,
    backgroundColor: fastQue.card,
    borderRadius: radius.sm,
    padding: space[4],
  },
  noticeCardText: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: 19, color: fastQue.textSecondary },

  card: {
    backgroundColor: fastQue.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: fastQue.border,
    padding: space[5],
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  input: {
    minHeight: 52,
    backgroundColor: fastQue.input,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.sm,
    color: fastQue.text,
    fontFamily: font.bodyRegular,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    fontSize: fontSize.base,
    marginBottom: space[4],
  },

  primaryButton: {
    minHeight: 52,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[3],
  },
  primaryButtonText: { fontFamily: font.bodyBold, fontSize: fontSize.base, color: color.accentContrast },

  googleButton: {
    minHeight: 52,
    backgroundColor: fastQue.card,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[3],
  },
  googleButtonText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.text },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: space[4] },
  dividerLine: { flex: 1, height: 1, backgroundColor: fastQue.border },
  dividerText: {
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: fastQue.textSecondary,
    marginHorizontal: space[3],
  },

  resendButton: {
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: fastQue.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[2] + 4,
    marginTop: space[3],
  },
  resendButtonDisabled: { borderColor: fastQue.border },
  resendButtonText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.text },
});
