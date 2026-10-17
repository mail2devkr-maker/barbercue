import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../lib/auth-context';
import { useLanguage } from '../lib/language-context';
import {
  OTP_EXPIRY_MINUTES,
  classifyOtpError,
  cleanOtpInput,
  cooldownUntil,
  isValidOtpCode,
  normalizeDialCode,
  requestOwnerOtp,
  secondsLeft,
  toE164,
  verifyOwnerOtp,
  type OtpFailure,
} from '../lib/owner-phone-otp';
import { ownerPhoneStrings, type OwnerPhoneStrings } from '../lib/owner-phone-otp-strings';
import { fastQue, font, fontSize, radius, space } from '../lib/theme';
import { BrandLockup, InlineError, PremiumButton, PremiumScreen, PremiumSectionHeader } from '../components/ui';
import type { AuthStackParamList } from '../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'OwnerPhoneLogin'>;

function messageFor(failure: OtpFailure, s: OwnerPhoneStrings): string {
  switch (failure) {
    case 'RATE_LIMITED':
      return s.rateLimited;
    case 'INVALID_OR_EXPIRED':
      return s.invalidOrExpired;
    case 'UNAVAILABLE':
      return s.unavailable;
    case 'NETWORK':
      return s.network;
    default:
      return s.other;
  }
}

/**
 * Returning shop owners sign in with a one-time SMS code (Issue #211). It is reached only when the server says
 * `ownerPhoneOtp` is on (see OwnerStaffLoginScreen). A new owner does not use this screen: they register with
 * email and password. The message after "Send code" is the same whatever number was typed, because the server
 * answers unknown and non-owner numbers identically and this client must not reveal which is which.
 * The session returned is applied exactly like the other sign-in methods; App.tsx then switches to the owner shell.
 */
export default function OwnerPhoneLoginScreen({ navigation }: Props) {
  const { applySession } = useAuth();
  const { language } = useLanguage();
  const s = ownerPhoneStrings(language);
  const [dialCode, setDialCode] = useState('+91');
  const [national, setNational] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // One-second tick only while a resend cooldown is running.
  useEffect(() => {
    if (until <= Date.now()) return undefined;
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [until]);

  const remaining = secondsLeft(until, now);

  async function sendCode() {
    setError(null);
    const e164 = toE164(dialCode, national);
    if (!e164) {
      setError(s.invalidPhone);
      return;
    }
    setBusy(true);
    try {
      await requestOwnerOtp(e164);
      if (!mounted.current) return;
      setPhone(e164);
      setStep('code');
      setCode('');
      setInfo(s.requestSent(OTP_EXPIRY_MINUTES));
      const t0 = Date.now();
      setNow(t0);
      setUntil(cooldownUntil(t0));
    } catch (err) {
      if (mounted.current) setError(messageFor(classifyOtpError(err), s));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function verify() {
    setError(null);
    if (!phone || !isValidOtpCode(code)) {
      setError(s.invalidCode);
      return;
    }
    setBusy(true);
    try {
      const session = await verifyOwnerOtp(phone, code);
      // No navigation call: AuthProvider flips to 'authenticated' and App.tsx swaps in the owner shell.
      await applySession(session);
    } catch (err) {
      if (mounted.current) setError(messageFor(classifyOtpError(err), s));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function changeNumber() {
    setStep('phone');
    setPhone(null);
    setCode('');
    setError(null);
    setInfo(null);
  }

  return (
    <PremiumScreen contentStyle={styles.screenContent}>
      <BrandLockup variant="auth" style={styles.brandLockup} />
      <PremiumSectionHeader eyebrow="OWNER" title={s.title} subtitle={s.subtitle} />

      {error && <InlineError message={error} />}
      {info && step === 'code' && (
        <Text style={styles.info} accessibilityLiveRegion="polite" testID="owner-phone-info">{info}</Text>
      )}

      {step === 'phone' ? (
        <>
          <View style={styles.phoneRow}>
            <View style={styles.dialField}>
              <Text style={styles.label}>{s.dialCodeLabel}</Text>
              <TextInput
                testID="owner-phone-dial"
                style={styles.input}
                value={dialCode}
                onChangeText={setDialCode}
                onBlur={() => setDialCode(normalizeDialCode(dialCode) ?? '+91')}
                keyboardType="phone-pad"
                maxLength={5}
                accessibilityLabel={s.dialCodeLabel}
              />
            </View>
            <View style={styles.numberField}>
              <Text style={styles.label}>{s.phoneLabel}</Text>
              <TextInput
                testID="owner-phone-number"
                style={styles.input}
                value={national}
                onChangeText={setNational}
                placeholder={s.phonePlaceholder}
                placeholderTextColor={fastQue.textSecondary}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                maxLength={18}
                accessibilityLabel={s.phoneLabel}
              />
            </View>
          </View>
          <PremiumButton title={s.sendCode} onPress={() => void sendCode()} loading={busy} style={styles.submit} />
        </>
      ) : (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>{s.codeLabel}</Text>
            <TextInput
              testID="owner-phone-code"
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={(value) => setCode(cleanOtpInput(value))}
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={6}
              accessibilityLabel={s.codeLabel}
            />
          </View>
          <PremiumButton title={s.verify} onPress={() => void verify()} loading={busy} style={styles.submit} />
          <Pressable
            testID="owner-phone-resend"
            style={styles.link}
            onPress={() => void sendCode()}
            disabled={remaining > 0 || busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: remaining > 0 || busy }}
            accessibilityLabel={remaining > 0 ? s.resendIn(remaining) : s.resend}
          >
            <Text style={[styles.linkText, remaining > 0 && styles.linkDisabled]}>{remaining > 0 ? s.resendIn(remaining) : s.resend}</Text>
          </Pressable>
          <Pressable testID="owner-phone-change" style={styles.link} onPress={changeNumber} accessibilityRole="button">
            <Text style={styles.linkText}>{s.changeNumber}</Text>
          </Pressable>
        </>
      )}

      <Pressable testID="owner-phone-email" style={styles.link} onPress={() => navigation.goBack()} accessibilityRole="button">
        <Text style={styles.linkText}>{s.useEmailInstead}</Text>
      </Pressable>
    </PremiumScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  brandLockup: { alignSelf: 'center', marginBottom: space[5] },
  phoneRow: { flexDirection: 'row', gap: space[3], marginBottom: space[4] },
  dialField: { width: 84 },
  numberField: { flex: 1 },
  field: { marginBottom: space[4] },
  label: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.text, marginBottom: space[2] },
  input: {
    minHeight: 50,
    backgroundColor: fastQue.input,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.sm,
    color: fastQue.text,
    fontFamily: font.bodyRegular,
    paddingHorizontal: space[4],
    fontSize: fontSize.base,
  },
  codeInput: { letterSpacing: 6, textAlign: 'center', fontSize: fontSize.lg },
  submit: { marginTop: space[2] },
  info: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textSecondary, marginBottom: space[4] },
  link: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: space[3] },
  linkText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.pink },
  linkDisabled: { color: fastQue.textSecondary },
});
