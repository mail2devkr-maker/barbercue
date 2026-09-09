import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { DASHBOARD_PATHS, setSalonUpiSchema, type SalonPaymentQrDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { color, radius, space } from '../../lib/theme';
import { Button, InlineError } from '../ui';

/** Separate from the proven QR upload transport; PATCH changes routing fields only. */
export function UpiRoutingForm({ salonId, current, onSaved }: {
  salonId: string; current: SalonPaymentQrDto | null; onSaved: () => void;
}) {
  const [vpa, setVpa] = useState(current?.upiVpa ?? '');
  const [payee, setPayee] = useState(current?.upiPayeeName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function save() {
    const parsed = setSalonUpiSchema.safeParse({ upiVpa: vpa, upiPayeeName: payee });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError(null); setSaved(false); setSaving(true);
    try {
      await apiFetch(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.paymentQr}`, {
        method: 'PATCH', body: JSON.stringify(parsed.data),
      });
      setSaved(true); onSaved();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save UPI details.'); }
    finally { setSaving(false); }
  }
  const inputStyle = { borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, padding: space[3], color: color.ink };
  return <View style={{ gap: 8, marginVertical: 16 }}>
    <Text>Optional direct UPI payment</Text>
    <Text>Enter the UPI ID belonging to the same account as your QR, and its business/payee name. Verify both carefully. Leave UPI ID blank for QR-only payment.</Text>
    <Text>UPI ID / VPA</Text>
    <TextInput accessibilityLabel="UPI ID / VPA" value={vpa} onChangeText={(v) => { setVpa(v); setSaved(false); }}
      autoCapitalize="none" autoCorrect={false} maxLength={255} placeholder="merchant@bank" style={inputStyle} />
    <Text>UPI payee / business name</Text>
    <TextInput accessibilityLabel="UPI payee / business name" value={payee} onChangeText={(v) => { setPayee(v); setSaved(false); }} maxLength={100} style={inputStyle} />
    {error && <InlineError message={error} />}
    <Button title="Save UPI details" onPress={() => void save()} loading={saving} />
    {saved && <Text accessibilityLiveRegion="polite">UPI details saved.</Text>}
  </View>;
}
