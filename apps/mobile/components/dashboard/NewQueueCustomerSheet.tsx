import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { createQueueCustomerSchema, type QueueEntryDetailDto, type ServiceOptionDto, type StaffStatusDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { ownerOpsPaths } from '../../lib/owner/ops';
import { color, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * "New Live Queue customer": adds someone who is physically at the shop to the Live Queue. This is a
 * real queue entry (it gets a token, a position and a wait estimate) - never an anonymous "local
 * customer" that only blocks a chair. No FastQue account is created, and a phone number is stored
 * only with the customer's consent.
 */
export function NewQueueCustomerSheet({
  salonId,
  services,
  staff,
  onCreated,
  onClose,
}: {
  salonId: string;
  services: ServiceOptionDto[];
  staff: StaffStatusDto[];
  onCreated: (entry: QueueEntryDetailDto) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attemptKey, setAttemptKey] = useState(() => newIdempotencyKey());

  async function submit() {
    setError(null);
    const parsed = createQueueCustomerSchema.safeParse({
      name,
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      contactConsent: consent,
      ...(serviceId ? { serviceId } : {}),
      ...(staffId ? { preferredStaffId: staffId } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the details and try again.');
      return;
    }
    setBusy(true);
    try {
      const entry = await apiFetch<QueueEntryDetailDto>(ownerOpsPaths.queueCustomers(salonId), {
        method: 'POST',
        headers: { 'Idempotency-Key': attemptKey },
        body: JSON.stringify(parsed.data),
      });
      onCreated(entry);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this customer to the queue.');
      setAttemptKey(newIdempotencyKey());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>New Live Queue customer</Text>
      <Text style={styles.hint}>For someone who is at the shop now and wants to wait their turn. They do not need a FastQue account.</Text>
      {error && <InlineError message={error} />}

      <Text style={styles.label}>Customer name</Text>
      <TextInput testID="queue-customer-name" style={styles.input} value={name} onChangeText={setName} maxLength={60} autoCapitalize="words" accessibilityLabel="Customer name" placeholderTextColor={color.muted} />

      <Text style={styles.label}>Mobile number (optional)</Text>
      <TextInput testID="queue-customer-phone" style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" accessibilityLabel="Mobile number" placeholder="98765 43210" placeholderTextColor={color.muted} />
      {phone.trim() ? (
        <View style={styles.consentRow}>
          <Switch testID="queue-customer-consent" value={consent} onValueChange={setConsent} accessibilityLabel="Customer agreed to be contacted" />
          <Text style={styles.consentText}>The customer agreed that the shop may save their number and contact them about this visit.</Text>
        </View>
      ) : null}

      {services.length > 0 && (
        <>
          <Text style={styles.label}>Service (optional)</Text>
          <View style={styles.chipRow}>
            {services.map((s) => (
              <Pressable key={s.id} testID={`queue-customer-service-${s.id}`} accessibilityRole="button" accessibilityState={{ selected: serviceId === s.id }} style={[styles.chip, serviceId === s.id && styles.chipActive]} onPress={() => setServiceId(serviceId === s.id ? null : s.id)}>
                <Text style={[styles.chipText, serviceId === s.id && styles.chipTextActive]}>{s.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {staff.length > 0 && (
        <>
          <Text style={styles.label}>Preferred barber (optional)</Text>
          <View style={styles.chipRow}>
            {staff.map((s) => (
              <Pressable key={s.id} testID={`queue-customer-barber-${s.id}`} accessibilityRole="button" accessibilityState={{ selected: staffId === s.id }} style={[styles.chip, staffId === s.id && styles.chipActive]} onPress={() => setStaffId(staffId === s.id ? null : s.id)}>
                <Text style={[styles.chipText, staffId === s.id && styles.chipTextActive]}>{s.displayName}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <View style={styles.actions}>
        <Button title="Add to Live Queue" onPress={() => void submit()} loading={busy} style={styles.action} />
        <Button title="Close" variant="outline" onPress={onClose} style={styles.action} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[3] },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, lineHeight: lineHeightFor(fontSize.lg), color: color.ink },
  hint: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.muted, marginTop: space[1] },
  label: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink, marginTop: space[3], marginBottom: space[1] },
  input: { minHeight: 46, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space[3], fontFamily: font.bodyRegular, fontSize: fontSize.base, color: color.ink },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[2] },
  consentText: { flex: 1, fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { minHeight: 40, justifyContent: 'center', paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1, borderColor: color.border },
  chipActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.muted },
  chipTextActive: { color: color.accent },
  actions: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
  action: { flex: 1 },
});
