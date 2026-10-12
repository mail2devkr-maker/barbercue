import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { billingProfileSchema, type BillingProfileDto, type OwnerOverviewDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { ownerOpsPaths } from '../../lib/owner/ops';
import { fastQue, font, fontSize, space } from '../../lib/theme';
import { InlineError, PremiumButton, PremiumCard, PremiumTextField } from '../ui';
import { Chip, ChipRow, FieldLabel, Hint, ToggleRow } from './ops-ui';

/**
 * Whether customers see the shop's phone number ("Call shop" on their booking). Off means the number
 * is never sent to a customer's app; the owner decides.
 */
export function ShopContactVisibilityCard({ salonId }: { salonId: string }) {
  const [value, setValue] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setValue(null);
    apiFetch<OwnerOverviewDto>(ownerOpsPaths.overview(salonId))
      .then((overview) => !cancelled && setValue(overview.settings.showPhoneToCustomers))
      .catch(() => !cancelled && setError('Could not load this setting.'));
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  async function change(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(ownerOpsPaths.contactVisibility(salonId), { method: 'PATCH', body: JSON.stringify({ showPhoneToCustomers: next }) });
      setValue(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this setting.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PremiumCard style={styles.card} testID="settings-contact-visibility">
      <Text style={styles.title}>Customer contact</Text>
      {error && <InlineError message={error} />}
      {value === null && !error ? (
        <Hint>Loading…</Hint>
      ) : value !== null ? (
        <ToggleRow
          testID="show-phone-switch"
          label="Show my shop phone number to customers"
          hint="When on, customers see a “Call shop” button on their booking, for example to ask about rescheduling or a cancellation charge. When off, your number is never sent to a customer’s app."
          value={value}
          onChange={(next) => void change(next)}
          disabled={busy}
        />
      ) : null}
    </PremiumCard>
  );
}

/**
 * The seller details printed on every invoice. Invoices cannot be issued until the legal name is set;
 * tax is added only if the owner turns it on and gives a rate - nothing is assumed and no GSTIN is
 * ever invented.
 */
export function BillingProfileCard({ salonId, onSaved }: { salonId: string; onSaved?: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gstin, setGstin] = useState('');
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxLabel, setTaxLabel] = useState('GST');
  const [taxRate, setTaxRate] = useState('');
  const [taxMode, setTaxMode] = useState<'EXCLUSIVE' | 'INCLUSIVE'>('EXCLUSIVE');
  const [prefix, setPrefix] = useState('INV');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((p: BillingProfileDto) => {
    setLegalName(p.legalName ?? '');
    setAddress(p.billingAddress ?? '');
    setPhone(p.contactPhone ?? '');
    setEmail(p.contactEmail ?? '');
    setGstin(p.gstin ?? '');
    setTaxEnabled(p.taxEnabled);
    setTaxLabel(p.taxLabel);
    setTaxRate(p.taxRatePercent === null ? '' : String(p.taxRatePercent));
    setTaxMode(p.taxMode);
    setPrefix(p.invoicePrefix);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    apiFetch<BillingProfileDto>(ownerOpsPaths.billingProfile(salonId))
      .then((p) => {
        if (cancelled) return;
        apply(p);
        setLoaded(true);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load your billing details.'));
    return () => {
      cancelled = true;
    };
  }, [salonId, apply]);

  async function save() {
    setError(null);
    setNotice(null);
    const rate = taxRate.trim() === '' ? undefined : Number(taxRate);
    if (rate !== undefined && !Number.isFinite(rate)) {
      setError('Enter the tax rate as a number, for example 18.');
      return;
    }
    const parsed = billingProfileSchema.safeParse({
      legalName,
      ...(address.trim() ? { billingAddress: address } : {}),
      ...(phone.trim() ? { contactPhone: phone } : {}),
      ...(email.trim() ? { contactEmail: email } : {}),
      ...(gstin.trim() ? { gstin } : {}),
      taxEnabled,
      taxLabel,
      ...(rate !== undefined ? { taxRatePercent: rate } : {}),
      taxMode,
      invoicePrefix: prefix,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the details and try again.');
      return;
    }
    setBusy(true);
    try {
      const saved = await apiFetch<BillingProfileDto>(ownerOpsPaths.billingProfile(salonId), { method: 'PUT', body: JSON.stringify(parsed.data) });
      apply(saved);
      setNotice('Billing details saved.');
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your billing details.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PremiumCard style={styles.card} testID="settings-billing-profile">
      <Text style={styles.title}>Billing details</Text>
      <Hint>Printed on every invoice. Add your GSTIN only if you have one - FastQue never fills one in for you.</Hint>
      {error && <InlineError message={error} />}
      {notice && <Text style={styles.ok}>{notice}</Text>}
      {!loaded && !error ? (
        <Hint>Loading…</Hint>
      ) : (
        <View>
          <FieldLabel>Business name on invoices</FieldLabel>
          <PremiumTextField testID="billing-legal-name" value={legalName} onChangeText={setLegalName} maxLength={160} accessibilityLabel="Business name on invoices" />
          <FieldLabel>Address (optional)</FieldLabel>
          <PremiumTextField value={address} onChangeText={setAddress} maxLength={300} accessibilityLabel="Billing address" />
          <FieldLabel>Phone (optional)</FieldLabel>
          <PremiumTextField value={phone} onChangeText={setPhone} keyboardType="phone-pad" accessibilityLabel="Billing phone" />
          <FieldLabel>Email (optional)</FieldLabel>
          <PremiumTextField value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" accessibilityLabel="Billing email" />
          <FieldLabel>GSTIN (optional)</FieldLabel>
          <PremiumTextField testID="billing-gstin" value={gstin} onChangeText={setGstin} autoCapitalize="characters" maxLength={15} accessibilityLabel="GSTIN" />
          <ToggleRow testID="billing-tax-switch" label="Add tax to invoices" hint="Off means no tax line is printed." value={taxEnabled} onChange={setTaxEnabled} />
          {taxEnabled && (
            <>
              <FieldLabel>Tax name</FieldLabel>
              <PremiumTextField value={taxLabel} onChangeText={setTaxLabel} maxLength={20} accessibilityLabel="Tax name" />
              <FieldLabel>Tax rate (%)</FieldLabel>
              <PremiumTextField testID="billing-tax-rate" value={taxRate} onChangeText={setTaxRate} keyboardType="decimal-pad" accessibilityLabel="Tax rate" />
              <FieldLabel>Your listed prices</FieldLabel>
              <ChipRow>
                <Chip label="Do not include tax" selected={taxMode === 'EXCLUSIVE'} onPress={() => setTaxMode('EXCLUSIVE')} />
                <Chip label="Already include tax" selected={taxMode === 'INCLUSIVE'} onPress={() => setTaxMode('INCLUSIVE')} />
              </ChipRow>
            </>
          )}
          <FieldLabel>Invoice number prefix</FieldLabel>
          <PremiumTextField testID="billing-prefix" value={prefix} onChangeText={setPrefix} autoCapitalize="characters" maxLength={8} accessibilityLabel="Invoice number prefix" />
          <PremiumButton testID="billing-save" title="Save billing details" onPress={() => void save()} loading={busy} style={styles.save} />
        </View>
      )}
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[4] },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: fastQue.text, marginBottom: space[1] },
  ok: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.success, marginTop: space[2] },
  save: { marginTop: space[4] },
});
