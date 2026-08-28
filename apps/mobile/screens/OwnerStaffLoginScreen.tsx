import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { staffLoginSchema } from '@barbercue/shared';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Button, InlineError } from '../components/ui';
import type { AuthStackParamList } from '../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'OwnerStaffLogin'>;

const COPY: Record<'OWNER' | 'STAFF', { eyebrow: string; title: string }> = {
  OWNER: { eyebrow: 'Shop Owner', title: 'Sign in to your shop' },
  STAFF: { eyebrow: 'Barber / Staff', title: 'Sign in to work today' },
};

// Same POST auth/staff/login web's own /owner/login and /staff/login pages call — the account's
// actual roles (not which button was tapped here) determine what the app shows after sign-in.
// This screen never invents a password-reset or 2FA step the backend doesn't have; forgot-password
// exists (auth/forgot-password) and could be wired in later the same way web's page does it.
export default function OwnerStaffLoginScreen({ route }: Props) {
  const { role } = route.params;
  const { staffLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    const parsed = staffLoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email and password.');
      return;
    }
    setSubmitting(true);
    try {
      await staffLogin(parsed.data);
      // No further navigation call needed — App.tsx re-routes to the Owner/Staff shell the
      // moment AuthProvider's status flips to 'authenticated', same pattern as customer login.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const copy = COPY[role];

  return (
    <Screen contentStyle={styles.screenContent}>
      <SectionHeader eyebrow={copy.eyebrow} title={copy.title} subtitle="Use the email and password from your BarberCue dashboard account." />

      {error && <InlineError message={error} />}

      <View style={styles.field}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor={color.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor={color.muted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
      </View>

      <Button title="Sign in" onPress={() => void handleSubmit()} loading={submitting} style={styles.submitButton} />
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
  submitButton: { marginTop: space[2] },
});
