import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { staffLoginSchema } from '@barbercue/shared';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { GOOGLE_SIGNIN_CONFIGURED, getGoogleIdToken } from '../lib/google-signin';
import { stashPendingShopRegistrationIntent } from '../lib/shop-registration-intent';
import { useLanguage } from '../lib/language-context';
import { fastQue, font, fontSize, radius, space } from '../lib/theme';
import { BrandLockup, InlineError, PremiumButton, PremiumScreen, PremiumSectionHeader } from '../components/ui';
import type { UiStrings } from '@barbercue/shared';
import type { AuthStackParamList } from '../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'OwnerStaffLogin'>;

function copyFor(t: UiStrings, role: 'OWNER' | 'STAFF'): { eyebrow: string; title: string } {
  return role === 'OWNER'
    ? { eyebrow: t.roleOwner, title: t.signInToYourShop }
    : { eyebrow: t.roleStaff, title: t.signInToWorkToday };
}

// Same POST auth/staff/login web's own /owner/login and /staff/login pages call — the account's
// actual roles (not which button was tapped here) determine what the app shows after sign-in.
// This screen never invents a password-reset or 2FA step the backend doesn't have; forgot-password
// exists (auth/forgot-password) and could be wired in later the same way web's page does it.
export default function OwnerStaffLoginScreen({ route, navigation }: Props) {
  const { role } = route.params;
  const { staffLogin, staffGoogleLogin } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    const parsed = staffLoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.enterValidEmailPassword);
      return;
    }
    setSubmitting(true);
    try {
      await staffLogin(parsed.data);
      // No further navigation call needed — App.tsx re-routes to the Owner/Staff shell the
      // moment AuthProvider's status flips to 'authenticated', same pattern as customer login.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotSignIn);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setGoogleSubmitting(true);
    try {
      const result = await getGoogleIdToken(t);
      if (result.type === 'cancelled') return;
      if (result.type === 'error') {
        setError(result.message);
        return;
      }
      // Backend rejects this exact idToken outright if the Google account isn't already a
      // registered SALON_OWNER/SALON_STAFF — see auth.service.ts's staffGoogleLogin. Never
      // creates an account and never grants a role based on this call.
      await staffGoogleLogin({ idToken: result.idToken });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotSignInWithGoogle);
    } finally {
      setGoogleSubmitting(false);
    }
  }

  const copy = copyFor(t, role);

  return (
    <PremiumScreen contentStyle={styles.screenContent}>
      <BrandLockup variant="auth" style={styles.brandLockup} />
      <PremiumSectionHeader eyebrow={copy.eyebrow} title={copy.title} subtitle={t.useYourDashboardAccount} />

      {error && <InlineError message={error} />}

      {GOOGLE_SIGNIN_CONFIGURED && (
        <>
          <Pressable style={styles.googleButton} onPress={() => void handleGoogleSignIn()} disabled={googleSubmitting}>
            {googleSubmitting ? (
              <ActivityIndicator color={fastQue.text} />
            ) : (
              <Text style={styles.googleButtonText}>{t.continueWithGoogle}</Text>
            )}
          </Pressable>
          <Text style={styles.googleNote}>
            {role === 'OWNER' ? t.onlyWorksIfRegisteredOwner : t.onlyWorksIfRegisteredStaff}
          </Text>
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t.orDivider}</Text>
            <View style={styles.dividerLine} />
          </View>
        </>
      )}

      <View style={styles.field}>
        <Text style={styles.label}>{t.email}</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor={fastQue.textSecondary}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t.passwordLabel}</Text>
        <TextInput
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor={fastQue.textSecondary}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <Pressable
          style={styles.recoveryLink}
          onPress={() => navigation.navigate('PasswordRecovery', { audience: role === 'OWNER' ? 'owner' : 'staff' })}
          accessibilityRole="button"
          accessibilityLabel={t.forgotPasswordQuestion}
        >
          <Text style={styles.recoveryLinkText}>{t.forgotPasswordQuestion}</Text>
        </Pressable>
      </View>

      <PremiumButton title={t.signInTitle} onPress={() => void handleSubmit()} loading={submitting} style={styles.submitButton} />

      {role === 'OWNER' && (
        <Pressable
          style={styles.registerShopLink}
          onPress={() => {
            stashPendingShopRegistrationIntent();
            navigation.navigate('CustomerLogin');
          }}
        >
          <Text style={styles.registerShopLinkText}>{t.newToFastQueRegisterShop}</Text>
        </Pressable>
      )}
    </PremiumScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  brandLockup: { alignSelf: 'center', marginBottom: space[5] },
  field: { marginBottom: space[4] },
  recoveryLink: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: space[1] },
  recoveryLinkText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.pink },
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
  submitButton: { marginTop: space[2] },
  registerShopLink: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: space[4] },
  registerShopLinkText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.pink },
  googleButton: {
    minHeight: 50,
    backgroundColor: fastQue.card,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[3],
  },
  googleButtonText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.text },
  googleNote: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textSecondary, marginTop: space[2], textAlign: 'center' },
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
});
