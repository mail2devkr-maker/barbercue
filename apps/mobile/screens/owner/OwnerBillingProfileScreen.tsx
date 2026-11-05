import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { billingProfileSchema } from '@barbercue/shared';
import type { BillingProfileDto, InvoiceTaxMode } from '@barbercue/shared';
import { Button, Card, InlineError, Screen, SectionHeader, Skeleton } from '../../components/ui';
import { apiFetch, ApiError } from '../../lib/api';
import { ownerBillingProfileRequestPath } from '../../lib/owner-invoices';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Props = NativeStackScreenProps<OwnerShopStackParamList, 'OwnerBillingProfile'>;

type ProfileForm = {
  legalName: string;
  billingAddress: string;
  contactPhone: string;
  contactEmail: string;
  gstin: string;
  taxEnabled: boolean;
  taxLabel: string;
  taxRatePercent: string;
  taxMode: InvoiceTaxMode;
  invoicePrefix: string;
};

const blankForm: ProfileForm = {
  legalName: '', billingAddress: '', contactPhone: '', contactEmail: '', gstin: '',
  taxEnabled: false, taxLabel: 'GST', taxRatePercent: '', taxMode: 'EXCLUSIVE', invoicePrefix: 'INV',
};

function toForm(profile: BillingProfileDto): ProfileForm {
  return {
    legalName: profile.legalName ?? '',
    billingAddress: profile.billingAddress ?? '',
    contactPhone: profile.contactPhone ?? '',
    contactEmail: profile.contactEmail ?? '',
    gstin: profile.gstin ?? '',
    taxEnabled: profile.taxEnabled,
    taxLabel: profile.taxLabel || 'GST',
    taxRatePercent: profile.taxRatePercent === null ? '' : String(profile.taxRatePercent),
    taxMode: profile.taxMode,
    invoicePrefix: profile.invoicePrefix || 'INV',
  };
}

export default function OwnerBillingProfileScreen({ route }: Props) {
  const { salonId } = route.params;
  const { language } = useLanguage();
  const isHindi = language === 'HI';
  const [form, setForm] = useState(blankForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch<BillingProfileDto>(ownerBillingProfileRequestPath(salonId))
      .then((profile) => { if (active) setForm(toForm(profile)); })
      .catch((err: unknown) => { if (active) setError(err instanceof ApiError ? err.message : (isHindi ? 'बिलिंग प्रोफ़ाइल लोड नहीं हुई।' : 'Could not load billing profile.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [salonId, isHindi]));

  const save = async () => {
    const parsed = billingProfileSchema.safeParse({
      legalName: form.legalName,
      billingAddress: form.billingAddress,
      contactPhone: form.contactPhone,
      contactEmail: form.contactEmail,
      gstin: form.gstin,
      taxEnabled: form.taxEnabled,
      taxLabel: form.taxLabel,
      taxRatePercent: form.taxRatePercent.trim() ? Number(form.taxRatePercent) : undefined,
      taxMode: form.taxMode,
      invoicePrefix: form.invoicePrefix,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? (isHindi ? 'बिलिंग विवरण जाँचें।' : 'Check the billing details.'));
      setNotice(null);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await apiFetch<BillingProfileDto>(ownerBillingProfileRequestPath(salonId), {
        method: 'PUT',
        body: JSON.stringify(parsed.data),
      });
      setForm(toForm(saved));
      setNotice(isHindi ? 'बिलिंग प्रोफ़ाइल सहेजी गई।' : 'Billing profile saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (isHindi ? 'बिलिंग प्रोफ़ाइल सहेजी नहीं जा सकी।' : 'Could not save billing profile.'));
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const labels = isHindi
    ? { title: 'बिलिंग प्रोफ़ाइल', subtitle: 'इनवॉइस पर दिखने वाले व्यवसाय और कर विवरण।', legal: 'कानूनी व्यवसाय नाम', address: 'बिलिंग पता', phone: 'संपर्क फ़ोन', email: 'संपर्क ईमेल', gstin: 'GSTIN (वैकल्पिक)', tax: 'इनवॉइस पर कर लागू करें', taxLabel: 'कर लेबल', taxRate: 'कर दर (%)', mode: 'कर मोड', exclusive: 'अलग से', inclusive: 'शामिल', prefix: 'इनवॉइस नंबर प्रीफ़िक्स', save: 'बिलिंग प्रोफ़ाइल सहेजें', saving: 'सहेज रहे हैं…', safety: 'इनवॉइस राशि सर्वर पर गणना होती है। यह स्क्रीन भुगतान नहीं लेती।' }
    : { title: 'Billing profile', subtitle: 'Business and tax details printed on invoices.', legal: 'Legal business name', address: 'Billing address', phone: 'Contact phone', email: 'Contact email', gstin: 'GSTIN (optional)', tax: 'Apply tax to invoices', taxLabel: 'Tax label', taxRate: 'Tax rate (%)', mode: 'Tax mode', exclusive: 'Exclusive', inclusive: 'Inclusive', prefix: 'Invoice number prefix', save: 'Save billing profile', saving: 'Saving…', safety: 'Invoice totals are calculated by the server. This screen does not collect payment.' };

  return (
    <Screen contentStyle={styles.screen}>
      <SectionHeader eyebrow="Billing" title={labels.title} subtitle={labels.subtitle} />
      {loading ? <Skeleton style={styles.skeleton} /> : (
        <Card style={styles.card}>
          {error ? <InlineError message={error} /> : null}
          {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
          <Field label={labels.legal} value={form.legalName} onChangeText={(v) => update('legalName', v)} />
          <Field label={labels.address} value={form.billingAddress} onChangeText={(v) => update('billingAddress', v)} multiline />
          <Field label={labels.phone} value={form.contactPhone} onChangeText={(v) => update('contactPhone', v)} keyboardType="phone-pad" />
          <Field label={labels.email} value={form.contactEmail} onChangeText={(v) => update('contactEmail', v)} keyboardType="email-address" />
          <Field label={labels.gstin} value={form.gstin} onChangeText={(v) => update('gstin', v.toUpperCase())} autoCapitalize="characters" />
          <Pressable accessibilityRole="switch" accessibilityLabel={labels.tax} accessibilityState={{ checked: form.taxEnabled }} onPress={() => update('taxEnabled', !form.taxEnabled)} style={styles.toggleRow}>
            <Text style={styles.label}>{labels.tax}</Text>
            <Text style={styles.toggleValue}>{form.taxEnabled ? 'ON' : 'OFF'}</Text>
          </Pressable>
          {form.taxEnabled ? <>
            <Field label={labels.taxLabel} value={form.taxLabel} onChangeText={(v) => update('taxLabel', v)} />
            <Field label={labels.taxRate} value={form.taxRatePercent} onChangeText={(v) => update('taxRatePercent', v)} keyboardType="decimal-pad" />
            <Text style={styles.label}>{labels.mode}</Text>
            <View style={styles.modeRow}>
              {(['EXCLUSIVE', 'INCLUSIVE'] as const).map((mode) => (
                <Pressable key={mode} accessibilityRole="button" accessibilityState={{ selected: form.taxMode === mode }} onPress={() => update('taxMode', mode)} style={[styles.modeButton, form.taxMode === mode && styles.modeSelected]}>
                  <Text style={[styles.modeText, form.taxMode === mode && styles.modeTextSelected]}>{mode === 'EXCLUSIVE' ? labels.exclusive : labels.inclusive}</Text>
                </Pressable>
              ))}
            </View>
          </> : null}
          <Field label={labels.prefix} value={form.invoicePrefix} onChangeText={(v) => update('invoicePrefix', v.toUpperCase())} autoCapitalize="characters" />
          <Text style={styles.hint}>{labels.safety}</Text>
          <Button title={saving ? labels.saving : labels.save} onPress={() => void save()} loading={saving} disabled={saving || loading} />
        </Card>
      )}
    </Screen>
  );
}

function Field({ label, value, onChangeText, multiline = false, keyboardType, autoCapitalize }: {
  label: string; value: string; onChangeText: (value: string) => void; multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'decimal-pad'; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} multiline={multiline} keyboardType={keyboardType} autoCapitalize={autoCapitalize} autoCorrect={false} maxLength={300} style={[styles.input, multiline && styles.multiline]} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { padding: space[5] },
  skeleton: { height: 420, borderRadius: radius.lg },
  card: { gap: space[3], marginBottom: space[5] },
  field: { gap: space[1] },
  label: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space[3], color: color.ink, fontFamily: font.bodyRegular, fontSize: fontSize.base },
  multiline: { minHeight: 80, paddingVertical: space[3], textAlignVertical: 'top' },
  toggleRow: { minHeight: 48, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space[3], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleValue: { color: color.accent, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  modeRow: { flexDirection: 'row', gap: space[2] },
  modeButton: { borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingVertical: space[2], paddingHorizontal: space[3] },
  modeSelected: { backgroundColor: color.ink, borderColor: color.ink },
  modeText: { color: color.ink, fontFamily: font.bodyMedium, fontSize: fontSize.sm },
  modeTextSelected: { color: color.surface },
  hint: { color: color.muted, fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: 18 },
  notice: { color: color.success, fontFamily: font.bodyMedium, fontSize: fontSize.sm },
});
