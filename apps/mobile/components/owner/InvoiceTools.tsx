import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import {
  billingProfileSchema,
  recordInvoicePaymentSchema,
  voidInvoiceSchema,
  Language,
  type BillingProfileDto,
  type InvoiceDetailDto,
} from '@barbercue/shared';
import { apiDownloadFile, apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * Website parity for Billing & invoices (apps/web/components/owner/InvoicesPanel.tsx and
 * InvoiceActions.tsx): download/share the invoice PDF, record a payment or a refund the SHOP
 * received or paid out, void an invoice, edit the billing profile, and create an invoice for a
 * completed visit. Every write goes to the same owner-scoped endpoints with the same shared zod
 * schemas, and money-affecting writes carry an Idempotency-Key that is reused on a retry of the same
 * submission, so a double tap or a flaky network can never record a payment twice.
 */

const METHODS = ['CASH', 'UPI', 'CARD', 'OTHER'] as const;
type Method = (typeof METHODS)[number];

const COPY = {
  en: {
    sharePdf: 'Download / share PDF', preparing: 'Preparing…', recordPayment: 'Record payment', recordRefund: 'Record refund',
    voidInvoice: 'Void invoice', paymentTitle: 'Record money the shop has received', refundTitle: 'Record a refund the shop has paid out',
    amount: 'Amount', method: 'Method', reference: 'Reference (optional, e.g. UPI transaction id)', note: 'Note (optional)',
    save: 'Save', saving: 'Saving…', cancel: 'Cancel', paymentSaved: 'Payment recorded.', refundSaved: 'Refund recorded.',
    voidTitle: 'Void this invoice', voidHelp: 'Use this if the invoice was made in error. If money was received, record a refund first. The number stays on record and is never reused.',
    reason: 'Reason', voidConfirmTitle: 'Void this invoice?', voidConfirm: 'Void invoice', voided: 'Invoice voided.',
    voidedBanner: 'Voided', shareUnavailable: 'Sharing is not available on this device.',
    METHOD: { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', OTHER: 'Other' } as Record<Method, string>,
    billingTitle: 'Billing profile', billingSub: 'Printed on every invoice. Invoices already issued are never changed.',
    legalName: 'Legal / business name', billingAddress: 'Billing address', contactPhone: 'Phone', contactEmail: 'Email',
    gstin: 'GSTIN (optional)', taxEnabled: 'Charge tax on invoices', taxLabel: 'Tax label', taxRate: 'Tax rate (%)',
    taxMode: 'Prices', exclusive: 'Tax added on top', inclusive: 'Tax included in price', prefix: 'Invoice number prefix',
    saveProfile: 'Save billing profile', profileSaved: 'Billing profile saved. New invoices use these details.',
    profileIncomplete: 'Add your business name to start issuing invoices. Tax stays off unless you turn it on.',
    createInvoice: 'Create invoice', creating: 'Creating…', viewInvoice: 'Invoice', needsProfile: 'Set up the billing profile (Invoices → Billing profile) first.',
    checkDetails: 'Check the details.', loadFailed: 'Could not load billing settings.',
  },
  hi: {
    sharePdf: 'PDF डाउनलोड / शेयर करें', preparing: 'तैयार हो रहा है…', recordPayment: 'भुगतान दर्ज करें', recordRefund: 'रिफ़ंड दर्ज करें',
    voidInvoice: 'इनवॉइस रद्द करें', paymentTitle: 'दुकान को मिली राशि दर्ज करें', refundTitle: 'दुकान द्वारा लौटाई गई राशि दर्ज करें',
    amount: 'राशि', method: 'तरीका', reference: 'संदर्भ (वैकल्पिक, जैसे UPI ट्रांज़ैक्शन ID)', note: 'नोट (वैकल्पिक)',
    save: 'सहेजें', saving: 'सहेजा जा रहा है…', cancel: 'रद्द करें', paymentSaved: 'भुगतान दर्ज हुआ।', refundSaved: 'रिफ़ंड दर्ज हुआ।',
    voidTitle: 'यह इनवॉइस रद्द करें', voidHelp: 'गलती से बना इनवॉइस हो तो इसका उपयोग करें। पैसा मिला हो तो पहले रिफ़ंड दर्ज करें। नंबर रिकॉर्ड में रहता है और दोबारा उपयोग नहीं होता।',
    reason: 'कारण', voidConfirmTitle: 'यह इनवॉइस रद्द करें?', voidConfirm: 'इनवॉइस रद्द करें', voided: 'इनवॉइस रद्द हुआ।',
    voidedBanner: 'रद्द', shareUnavailable: 'इस डिवाइस पर शेयर उपलब्ध नहीं है।',
    METHOD: { CASH: 'नकद', UPI: 'UPI', CARD: 'कार्ड', OTHER: 'अन्य' } as Record<Method, string>,
    billingTitle: 'बिलिंग प्रोफ़ाइल', billingSub: 'हर इनवॉइस पर छपता है। पहले जारी इनवॉइस कभी नहीं बदलते।',
    legalName: 'कानूनी / व्यवसाय का नाम', billingAddress: 'बिलिंग पता', contactPhone: 'फ़ोन', contactEmail: 'ईमेल',
    gstin: 'GSTIN (वैकल्पिक)', taxEnabled: 'इनवॉइस पर टैक्स लगाएँ', taxLabel: 'टैक्स का नाम', taxRate: 'टैक्स दर (%)',
    taxMode: 'कीमतें', exclusive: 'टैक्स ऊपर से जोड़ें', inclusive: 'टैक्स कीमत में शामिल', prefix: 'इनवॉइस नंबर प्रीफ़िक्स',
    saveProfile: 'बिलिंग प्रोफ़ाइल सहेजें', profileSaved: 'बिलिंग प्रोफ़ाइल सहेजी गई। नए इनवॉइस इन विवरणों का उपयोग करेंगे।',
    profileIncomplete: 'इनवॉइस जारी करने के लिए व्यवसाय का नाम जोड़ें। टैक्स तब तक बंद रहता है जब तक आप चालू न करें।',
    createInvoice: 'इनवॉइस बनाएँ', creating: 'बनाया जा रहा है…', viewInvoice: 'इनवॉइस', needsProfile: 'पहले बिलिंग प्रोफ़ाइल सेट करें (इनवॉइस → बिलिंग प्रोफ़ाइल)।',
    checkDetails: 'विवरण जाँचें।', loadFailed: 'बिलिंग सेटिंग लोड नहीं हो सकी।',
  },
} as const;
type Copy = (typeof COPY)['en'];
const copyFor = (language: Language): Copy => (language === Language.HI ? (COPY.hi as unknown as Copy) : COPY.en);

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

// ─── Invoice detail actions ────────────────────────────────────────────────────────────────────

export function InvoiceDetailActions({ base, invoice, language, onChanged }: {
  base: string;
  invoice: InvoiceDetailDto;
  language: Language;
  onChanged: (message: string) => void;
}) {
  const c = copyFor(language);
  const path = `${base}/invoices/${invoice.id}`;
  const [mode, setMode] = useState<'payment' | 'refund' | 'void' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refundable = Math.max(0, invoice.amountPaid - invoice.amountRefunded);

  const sharePdf = async () => {
    setBusy(true);
    setError(null);
    try {
      const uri = await apiDownloadFile(`${path}/pdf`, `${invoice.number}.pdf`);
      if (!(await Sharing.isAvailableAsync())) { setError(c.shareUnavailable); return; }
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: invoice.number, UTI: 'com.adobe.pdf' });
    } catch (err) {
      setError(errorText(err, c.checkDetails));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      {invoice.status === 'VOID' && (
        <Text style={styles.warn}>{c.voidedBanner}{invoice.voidReason ? `: ${invoice.voidReason}` : ''}</Text>
      )}
      <Button title={busy ? c.preparing : c.sharePdf} variant="outline" onPress={() => void sharePdf()} disabled={busy} />
      {invoice.status !== 'VOID' && mode === null && (
        <View style={styles.actions}>
          {invoice.balanceDue > 0 && <Button title={c.recordPayment} onPress={() => setMode('payment')} style={styles.action} />}
          {refundable > 0 && <Button title={c.recordRefund} variant="secondary" onPress={() => setMode('refund')} style={styles.action} />}
          <Button title={c.voidInvoice} variant="outline" onPress={() => setMode('void')} style={styles.action} />
        </View>
      )}
      {!!error && <InlineError message={error} />}
      {(mode === 'payment' || mode === 'refund') && (
        <PaymentForm
          path={path}
          kind={mode === 'refund' ? 'REFUND' : 'PAYMENT'}
          defaultAmount={mode === 'refund' ? refundable : invoice.balanceDue}
          currency={invoice.currency}
          c={c}
          onCancel={() => setMode(null)}
          onDone={(message) => { setMode(null); onChanged(message); }}
        />
      )}
      {mode === 'void' && (
        <VoidForm path={path} c={c} onCancel={() => setMode(null)} onDone={() => { setMode(null); onChanged(c.voided); }} />
      )}
    </Card>
  );
}

function PaymentForm({ path, kind, defaultAmount, currency, c, onCancel, onDone }: {
  path: string;
  kind: 'PAYMENT' | 'REFUND';
  defaultAmount: number;
  currency: string;
  c: Copy;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [amount, setAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : '');
  const [method, setMethod] = useState<Method>('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per distinct submission: a retry of the SAME values reuses it, so the server records once.
  const keys = useRef(new Map<string, string>());

  const submit = async () => {
    const parsed = recordInvoicePaymentSchema.safeParse({ kind, method, amount: Number(amount), reference, note });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? c.checkDetails); return; }
    const signature = JSON.stringify(parsed.data);
    const key = keys.current.get(signature) ?? newIdempotencyKey();
    keys.current.set(signature, key);
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${path}/payments`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(parsed.data) });
      onDone(kind === 'REFUND' ? c.refundSaved : c.paymentSaved);
    } catch (err) {
      setError(errorText(err, c.checkDetails));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.heading}>{kind === 'REFUND' ? c.refundTitle : c.paymentTitle}</Text>
      <Text style={styles.label}>{`${c.amount} (${currency})`}</Text>
      <TextInput accessibilityLabel={c.amount} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={styles.input} />
      <Text style={styles.label}>{c.method}</Text>
      <View style={styles.chips}>
        {METHODS.map((m) => (
          <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: method === m }} onPress={() => setMethod(m)} style={[styles.chip, method === m && styles.chipOn]}>
            <Text style={[styles.chipText, method === m && styles.chipTextOn]}>{c.METHOD[m]}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput accessibilityLabel={c.reference} placeholder={c.reference} value={reference} onChangeText={setReference} maxLength={80} autoCapitalize="none" style={styles.input} />
      <TextInput accessibilityLabel={c.note} placeholder={c.note} value={note} onChangeText={setNote} maxLength={200} style={styles.input} />
      {!!error && <InlineError message={error} />}
      <View style={styles.actions}>
        <Button title={busy ? c.saving : kind === 'REFUND' ? c.recordRefund : c.recordPayment} onPress={() => void submit()} disabled={busy} style={styles.action} />
        <Button title={c.cancel} variant="outline" onPress={onCancel} disabled={busy} style={styles.action} />
      </View>
    </View>
  );
}

function VoidForm({ path, c, onCancel, onDone }: { path: string; c: Copy; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());

  const run = async (data: { reason: string }) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${path}/void`, { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: JSON.stringify(data) });
      onDone();
    } catch (err) {
      setError(errorText(err, c.checkDetails));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const parsed = voidInvoiceSchema.safeParse({ reason });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? c.checkDetails); return; }
    // Voiding cannot be undone: a second, explicit confirmation like every other destructive owner action.
    Alert.alert(c.voidConfirmTitle, c.voidHelp, [
      { text: c.cancel, style: 'cancel' },
      { text: c.voidConfirm, style: 'destructive', onPress: () => void run(parsed.data) },
    ]);
  };

  return (
    <View style={styles.form}>
      <Text style={styles.heading}>{c.voidTitle}</Text>
      <Text style={styles.muted}>{c.voidHelp}</Text>
      <TextInput accessibilityLabel={c.reason} placeholder={c.reason} value={reason} onChangeText={setReason} maxLength={300} style={styles.input} />
      {!!error && <InlineError message={error} />}
      <View style={styles.actions}>
        <Button title={busy ? c.saving : c.voidInvoice} onPress={submit} disabled={busy} style={styles.action} />
        <Button title={c.cancel} variant="outline" onPress={onCancel} disabled={busy} style={styles.action} />
      </View>
    </View>
  );
}

// ─── Billing profile ───────────────────────────────────────────────────────────────────────────

type ProfileForm = {
  legalName: string; billingAddress: string; contactPhone: string; contactEmail: string; gstin: string;
  taxEnabled: boolean; taxLabel: string; taxRatePercent: string; taxMode: 'EXCLUSIVE' | 'INCLUSIVE'; invoicePrefix: string;
};

export function profileToForm(p: BillingProfileDto): ProfileForm {
  return {
    legalName: p.legalName ?? '', billingAddress: p.billingAddress ?? '', contactPhone: p.contactPhone ?? '',
    contactEmail: p.contactEmail ?? '', gstin: p.gstin ?? '', taxEnabled: p.taxEnabled, taxLabel: p.taxLabel,
    taxRatePercent: p.taxRatePercent === null ? '' : String(p.taxRatePercent), taxMode: p.taxMode, invoicePrefix: p.invoicePrefix,
  };
}

/** Same field mapping as the website's BillingProfile form, validated by the shared schema. */
export function parseProfileForm(form: ProfileForm) {
  return billingProfileSchema.safeParse({
    legalName: form.legalName,
    billingAddress: form.billingAddress,
    contactPhone: form.contactPhone,
    contactEmail: form.contactEmail,
    gstin: form.gstin.trim() ? form.gstin.trim() : undefined,
    taxEnabled: form.taxEnabled,
    taxLabel: form.taxLabel,
    taxRatePercent: form.taxRatePercent.trim() ? Number(form.taxRatePercent) : undefined,
    taxMode: form.taxMode,
    invoicePrefix: form.invoicePrefix,
  });
}

export function BillingProfileEditor({ base, language }: { base: string; language: Language }) {
  const c = copyFor(language);
  const [profile, setProfile] = useState<BillingProfileDto | null>(null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProfile(null); setForm(null); setError(null); setSaved(false);
    apiFetch<BillingProfileDto>(`${base}/billing-profile`)
      .then((p) => { if (!cancelled) { setProfile(p); setForm(profileToForm(p)); } })
      .catch((err) => { if (!cancelled) setError(errorText(err, c.loadFailed)); });
    return () => { cancelled = true; };
  }, [base, c.loadFailed]);

  if (!form) return error ? <InlineError message={error} /> : <Text style={styles.muted}>…</Text>;
  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => { setSaved(false); setForm((f) => (f ? { ...f, [key]: value } : f)); };

  const save = async () => {
    const parsed = parseProfileForm(form);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? c.checkDetails); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<BillingProfileDto>(`${base}/billing-profile`, { method: 'PUT', body: JSON.stringify(parsed.data) });
      setProfile(result);
      setForm(profileToForm(result));
      setSaved(true);
    } catch (err) {
      setError(errorText(err, c.checkDetails));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: 'legalName' | 'billingAddress' | 'contactPhone' | 'contactEmail' | 'gstin' | 'invoicePrefix', label: string, extra: object = {}) => (
    <View key={key}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={form[key]} onChangeText={(v) => set(key, v)} style={styles.input} {...extra} />
    </View>
  );

  return (
    <Card>
      <Text style={styles.heading}>{c.billingTitle}</Text>
      <Text style={styles.muted}>{c.billingSub}</Text>
      {profile && !profile.complete && <Text style={styles.info}>{c.profileIncomplete}</Text>}
      {field('legalName', c.legalName, { maxLength: 160 })}
      {field('billingAddress', c.billingAddress, { maxLength: 300, multiline: true })}
      {field('contactPhone', c.contactPhone, { maxLength: 32, keyboardType: 'phone-pad' })}
      {field('contactEmail', c.contactEmail, { maxLength: 160, keyboardType: 'email-address', autoCapitalize: 'none' })}
      {field('gstin', c.gstin, { maxLength: 15, autoCapitalize: 'characters' })}
      <View style={styles.switchRow}>
        <Text style={styles.lineStrong}>{c.taxEnabled}</Text>
        <Switch accessibilityLabel={c.taxEnabled} value={form.taxEnabled} onValueChange={(v) => set('taxEnabled', v)} />
      </View>
      {form.taxEnabled && (
        <>
          <Text style={styles.label}>{c.taxLabel}</Text>
          <TextInput accessibilityLabel={c.taxLabel} value={form.taxLabel} onChangeText={(v) => set('taxLabel', v)} maxLength={20} style={styles.input} />
          <Text style={styles.label}>{c.taxRate}</Text>
          <TextInput accessibilityLabel={c.taxRate} value={form.taxRatePercent} onChangeText={(v) => set('taxRatePercent', v)} keyboardType="decimal-pad" style={styles.input} />
          <Text style={styles.label}>{c.taxMode}</Text>
          <View style={styles.chips}>
            {(['EXCLUSIVE', 'INCLUSIVE'] as const).map((m) => (
              <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: form.taxMode === m }} onPress={() => set('taxMode', m)} style={[styles.chip, form.taxMode === m && styles.chipOn]}>
                <Text style={[styles.chipText, form.taxMode === m && styles.chipTextOn]}>{m === 'EXCLUSIVE' ? c.exclusive : c.inclusive}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      {field('invoicePrefix', c.prefix, { maxLength: 8, autoCapitalize: 'characters' })}
      {!!error && <InlineError message={error} />}
      {saved && <Text style={styles.ok}>{c.profileSaved}</Text>}
      <Button title={busy ? c.saving : c.saveProfile} onPress={() => void save()} disabled={busy} />
    </Card>
  );
}

// ─── Create invoice for a completed visit ──────────────────────────────────────────────────────

export function CreateInvoiceButton({ base, bookingId, queueEntryId, language, onOpen }: {
  base: string;
  bookingId?: string | null;
  queueEntryId?: string | null;
  language: Language;
  onOpen?: (invoice: InvoiceDetailDto) => void;
}) {
  const c = copyFor(language);
  const source = bookingId ? `bookingId=${encodeURIComponent(bookingId)}` : `queueEntryId=${encodeURIComponent(queueEntryId ?? '')}`;
  const [existing, setExisting] = useState<InvoiceDetailDto | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());

  useEffect(() => {
    let cancelled = false;
    apiFetch<InvoiceDetailDto | null>(`${base}/invoices/by-source?${source}`)
      .then((inv) => { if (!cancelled) setExisting(inv ?? null); })
      .catch(() => { if (!cancelled) setExisting(null); });
    return () => { cancelled = true; };
  }, [base, source]);

  if (existing === undefined || (!bookingId && !queueEntryId)) return null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const inv = await apiFetch<InvoiceDetailDto>(`${base}/invoices`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: JSON.stringify(bookingId ? { bookingId } : { queueEntryId }),
      });
      setExisting(inv);
      onOpen?.(inv);
    } catch (err) {
      const needsProfile = err instanceof ApiError && (err.code === 'BILLING_PROFILE_REQUIRED' || err.code === 'BILLING_TAX_NOT_CONFIGURED');
      setError(needsProfile ? `${errorText(err, c.checkDetails)} ${c.needsProfile}` : errorText(err, c.checkDetails));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      {existing ? (
        <Button title={`${c.viewInvoice} ${existing.number}`} variant="outline" onPress={() => onOpen?.(existing)} />
      ) : (
        <Button title={busy ? c.creating : c.createInvoice} variant="outline" onPress={() => void create()} disabled={busy} />
      )}
      {!!error && <InlineError message={error} />}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3] },
  action: { flexGrow: 1 },
  form: { marginTop: space[3], gap: space[1] },
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  label: { fontFamily: font.bodyMedium, color: color.muted, fontSize: fontSize.xs, marginTop: space[2] },
  lineStrong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm, flex: 1 },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  info: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.accentSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  ok: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, marginVertical: space[2] },
  warn: { fontFamily: font.bodyBold, color: color.warn, fontSize: fontSize.sm, marginBottom: space[2] },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginTop: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[1] },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: color.surface },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
  chipTextOn: { color: color.accent, fontFamily: font.bodyBold },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[3] },
});
