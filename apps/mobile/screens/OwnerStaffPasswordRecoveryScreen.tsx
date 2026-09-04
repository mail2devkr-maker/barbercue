import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AUTH_PATHS, forgotPasswordSchema } from '@barbercue/shared';
import { apiFetch } from '../lib/api';
import { useLanguage } from '../lib/language-context';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Button, InlineError, Screen, SectionHeader } from '../components/ui';
import type { AuthStackParamList } from '../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'PasswordRecovery'>;

/**
 * Owner and staff use the one existing, enumeration-resistant recovery endpoint. The reset link
 * remains a web URL by design: it is the same single-use, HTTPS flow used by the web sign-in
 * surfaces, so native does not create a second token-handling implementation.
 */
export default function OwnerStaffPasswordRecoveryScreen({ navigation, route }: Props) {
  const { audience } = route.params;
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleLabel = audience === 'owner' ? t.roleLabelOwner : t.roleLabelStaff;

  async function submit(): Promise<void> {
    setError(null);
    const parsed = forgotPasswordSchema.safeParse({ email, audience });
    if (!parsed.success) {
      setError(t.enterValidEmail);
      return;
    }

    setSubmitting(true);
    try {
      // The backend intentionally returns the same public response whether an eligible account
      // exists or not. Never read or render the dev-only reset URL in a mobile client.
      await apiFetch(`auth/${AUTH_PATHS.forgotPassword}`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      setSubmitted(true);
    } catch {
      // Keep provider/configuration errors non-technical and never turn them into an account
      // enumeration signal. A retry remains safe because the server owns rate limiting.
      setError(t.recoveryUnavailableNotice);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Screen contentStyle={styles.screenContent}>
        <SectionHeader eyebrow={t.passwordRecoveryTitle} title={t.checkYourInboxTitle} />
        <View style={styles.successCard}>
          <Text style={styles.successText}>
            {t.eligibleAccountPrefix}{roleLabel}{t.eligibleAccountSuffix}
          </Text>
          <Text style={styles.successHint}>{t.afterResetHint}</Text>
        </View>
        <Button title={t.backToSignIn} onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.screenContent}>
      <SectionHeader
        eyebrow={t.passwordRecoveryTitle}
        title={t.resetYourPasswordTitle}
        subtitle={`${t.enterEmailForAccountPrefix}${roleLabel}${t.enterEmailForAccountSuffix}`}
      />

      {error && <InlineError message={error} />}

      <View style={styles.field}>
        <Text style={styles.label}>{t.email}</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor={color.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          accessibilityLabel={t.emailAddressAccessibilityLabel}
        />
      </View>

      <Button title={t.sendResetLinkAction} onPress={() => void submit()} loading={submitting} />
      <Pressable style={styles.backLink} onPress={() => navigation.goBack()} accessibilityRole="button">
        <Text style={styles.backLinkText}>{t.backToSignIn}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  field: { marginBottom: space[4] },
  label: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink, marginBottom: space[2] },
  input: {
    minHeight: 50,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    color: color.ink,
    fontFamily: font.bodyRegular,
    paddingHorizontal: space[4],
    fontSize: fontSize.base,
  },
  successCard: {
    backgroundColor: color.successSoft,
    borderWidth: 1,
    borderColor: 'rgba(46, 125, 50, 0.24)',
    borderRadius: radius.sm,
    padding: space[4],
    marginBottom: space[4],
  },
  successText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: 21, color: color.ink },
  successHint: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, lineHeight: 18, color: color.muted, marginTop: space[3] },
  backLink: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: space[2] },
  backLinkText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.accent },
});
