import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AUTH_PATHS, otpRequestSchema, otpVerifySchema } from '@barbercue/shared';
import { ApiError, apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth-context';

type Step = 'phone' | 'otp';

// Customer-only per ARCHITECTURE.md §2 — staff/owner/admin use the web dashboard, not this app.
export default function PhoneOtpLoginScreen() {
  const { verifyCustomerOtp } = useAuth();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function requestOtp() {
    setError(null);
    const parsed = otpRequestSchema.safeParse({ phone });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid phone number.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`auth/${AUTH_PATHS.otpRequest}`, { method: 'POST', body: JSON.stringify(parsed.data) });
      setStep('otp');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send OTP. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyOtp() {
    setError(null);
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
        {step === 'phone' ? 'Enter your phone number to get a one-time code.' : `Enter the code sent to ${phone}.`}
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {step === 'phone' ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="+919876543210"
            placeholderTextColor="#B8AFA0"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            autoFocus
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
});
