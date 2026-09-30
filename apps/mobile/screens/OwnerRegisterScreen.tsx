import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ownerSignupSchema } from '@barbercue/shared';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { stashPendingShopRegistrationIntent } from '../lib/shop-registration-intent';
import { fastQue, font, fontSize, radius, space } from '../lib/theme';
import { BrandLockup, InlineError, PremiumButton, PremiumScreen, PremiumSectionHeader } from '../components/ui';
import type { AuthStackParamList } from '../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'OwnerRegister'>;

export default function OwnerRegisterScreen({ navigation }: Props) {
  const { ownerSignup } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    const parsed = ownerSignupSchema.safeParse({ email, password, confirmPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your account details.');
      return;
    }

    setSubmitting(true);
    try {
      // App.tsx swaps AuthStack out as soon as ownerSignup authenticates this new onboarding
      // account. Preserve the destination so the authenticated customer shell immediately opens
      // the existing RegisterShop -> owner-onboarding flow.
      stashPendingShopRegistrationIntent();
      await ownerSignup(parsed.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PremiumScreen contentStyle={styles.screenContent}>
      <BrandLockup variant="auth" style={styles.brandLockup} />
      <PremiumSectionHeader
        eyebrow="SHOP OWNER"
        title="Create your account"
        subtitle="Create your FastQue account first. Shop onboarding starts immediately after this step."
      />

      {error && <InlineError message={error} />}

      <View style={styles.field}>
        <Text style={styles.label}>Email ID</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor={fastQue.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Minimum 8 characters"
          placeholderTextColor={fastQue.textSecondary}
          secureTextEntry={!showPasswords}
          textContentType="newPassword"
          value={password}
          onChangeText={setPassword}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Re-enter password</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter the same password again"
          placeholderTextColor={fastQue.textSecondary}
          secureTextEntry={!showPasswords}
          textContentType="newPassword"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
        />
      </View>

      <Pressable
        style={styles.showPasswordRow}
        onPress={() => setShowPasswords((current) => !current)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: showPasswords }}
      >
        <View style={[styles.checkbox, showPasswords && styles.checkboxChecked]} />
        <Text style={styles.showPasswordText}>Show passwords</Text>
      </Pressable>

      <PremiumButton
        title="Create account & continue"
        onPress={() => void submit()}
        loading={submitting}
        style={styles.submitButton}
      />

      <Pressable
        style={styles.signInLink}
        onPress={() => navigation.replace('OwnerStaffLogin', { role: 'OWNER' })}
      >
        <Text style={styles.signInLinkText}>Already have an owner account? Sign in</Text>
      </Pressable>
    </PremiumScreen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  brandLockup: { alignSelf: 'center', marginBottom: space[5] },
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
  showPasswordRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: -space[2] },
  checkbox: { width: 18, height: 18, borderWidth: 1, borderColor: fastQue.border, borderRadius: 4, backgroundColor: fastQue.card },
  checkboxChecked: { backgroundColor: fastQue.pink, borderColor: fastQue.pink },
  showPasswordText: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: fastQue.textSecondary },
  submitButton: { marginTop: space[2] },
  signInLink: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: space[4] },
  signInLinkText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.pink },
});
