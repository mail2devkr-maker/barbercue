import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PasswordVisibilityButton, PASSWORD_FIELD_PADDING } from '../components/ui/PasswordVisibilityButton';
import { employeeLoginSchema } from '@barbercue/shared';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useLanguage } from '../lib/language-context';
import { fastQue, font, fontSize, space } from '../lib/theme';
import { BrandLockup, InlineError, PremiumButton, PremiumScreen, PremiumSectionHeader, PremiumTextField } from '../components/ui';

export default function EmployeeLoginScreen() {
  const { employeeLogin } = useAuth();
  const { t } = useLanguage();
  const [employeeCode, setEmployeeCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function handleSubmit() {
    if (submittingRef.current) return;
    setError(null);
    const parsed = employeeLoginSchema.safeParse({ employeeCode, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.employeeLoginSubtitle);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      // Employee login is a distinct server endpoint; the backend validates status, password,
      // FIELD_EXECUTIVE role, audience and login throttling. There is no self-signup or OTP path.
      await employeeLogin(parsed.data);
    } catch (err) {
      // Keep account/status failures indistinguishable. Only a transport outage gets a
      // connectivity message; server authentication details never reach the signed-out UI.
      setError(err instanceof ApiError && err.code === 'NETWORK_OFFLINE' ? err.message : t.couldNotSignIn);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <PremiumScreen contentStyle={styles.content}>
      <BrandLockup variant="auth" style={styles.brand} />
      <PremiumSectionHeader
        eyebrow={t.employeeLoginEyebrow}
        title={t.employeeLoginTitle}
        subtitle={t.employeeLoginSubtitle}
      />

      {error ? <InlineError message={error} /> : null}

      <View style={styles.field}>
        <Text style={styles.label}>{t.employeeCodeLabel}</Text>
        <PremiumTextField
          accessibilityLabel={t.employeeCodeLabel}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="username"
          maxLength={32}
          placeholder="FQ-FE-00101"
          returnKeyType="next"
          value={employeeCode}
          onChangeText={setEmployeeCode}
          editable={!submitting}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t.employeePasswordLabel}</Text>
        <View style={styles.passwordWrap}>
          <PremiumTextField
            accessibilityLabel={t.employeePasswordLabel}
            autoCapitalize="none"
            autoComplete="password"
            secureTextEntry={!showPassword}
            returnKeyType="done"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => void handleSubmit()}
            editable={!submitting}
            style={{ paddingRight: PASSWORD_FIELD_PADDING }}
          />
          <PasswordVisibilityButton visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />
        </View>
      </View>

      <PremiumButton title={t.signInTitle} onPress={() => void handleSubmit()} loading={submitting} />
      <Text style={styles.help}>{t.employeeLoginHelp}</Text>
    </PremiumScreen>
  );
}

const styles = StyleSheet.create({
  passwordWrap: { position: 'relative' },
  content: { paddingHorizontal: space[5] },
  brand: { alignSelf: 'center', marginBottom: space[5] },
  field: { marginBottom: space[4] },
  label: { color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.sm, marginBottom: space[2] },
  help: { color: fastQue.textSecondary, fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: 20, marginTop: space[4], textAlign: 'center' },
});
