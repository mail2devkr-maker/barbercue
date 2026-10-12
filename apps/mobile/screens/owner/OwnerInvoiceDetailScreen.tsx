import { useCallback, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import { recordInvoicePaymentSchema, voidInvoiceSchema, type InvoiceDetailDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { useSalon } from '../../lib/salon-context';
import { formatMoney, formatShopDate, formatShopTime, ownerOpsPaths } from '../../lib/owner/ops';
import { METHOD_LABEL, PAYMENT_METHODS, invoiceShareText, parseAmount, paymentStatusView } from '../../lib/owner/invoice-view';
import { fastQue, font, fontSize, lineHeightFor, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader, PremiumTextField, Skeleton } from '../../components/ui';
import { Chip, ChipRow, FieldLabel, Hint, StatusPill } from '../../components/owner/ops-ui';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Mode = 'payment' | 'refund' | 'void' | null;

export default function OwnerInvoiceDetailScreen() {
  const route = useRoute<RouteProp<OwnerShopStackParamList, 'OwnerInvoiceDetail'>>();
  const { selectedSalonId } = useSalon();
  const invoiceId = route.params.invoiceId;
  const [invoice, setInvoice] = useState<InvoiceDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);

  const load = useCallback(async () => {
    if (!selectedSalonId) return;
    try {
      setInvoice(await apiFetch<InvoiceDetailDto>(ownerOpsPaths.invoice(selectedSalonId, invoiceId)));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this invoice.');
    }
  }, [selectedSalonId, invoiceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!selectedSalonId) {
    return (
      <PremiumScreen scroll={false}>
        <EmptyState title="Choose a shop" message="Select a shop to see its invoices." />
      </PremiumScreen>
    );
  }
  if (!invoice) {
    return (
      <PremiumScreen>
        {error ? <InlineError message={error} /> : <Skeleton style={styles.skeleton} />}
      </PremiumScreen>
    );
  }

  const money = (n: number) => formatMoney(n, invoice.currency);
  const view = paymentStatusView(invoice);

  async function shareInvoice() {
    if (!invoice) return;
    try {
      await Share.share({ message: invoiceShareText(invoice), title: `Invoice ${invoice.number}` });
    } catch {
      setError('Could not open the share sheet.');
    }
  }

  return (
    <PremiumScreen>
      <PremiumSectionHeader eyebrow={invoice.salonName} title={`Invoice ${invoice.number}`} />
      {error && <InlineError message={error} />}
      {notice && <Text style={styles.notice} testID="invoice-notice">{notice}</Text>}

      <PremiumCard strong style={styles.card}>
        <View style={styles.rowBetween}>
          <StatusPill label={view.label} tone={view.tone} />
          <Text style={styles.sub}>{formatShopDate(invoice.serviceDate, null)}</Text>
        </View>
        <Text style={styles.big}>{money(invoice.total)}</Text>
        <Text style={styles.sub}>
          {invoice.customerName ?? 'Customer'}
          {invoice.staffName ? ` · ${invoice.staffName}` : ''}
          {invoice.customerPhone ? ` · ${invoice.customerPhone}` : ''}
        </Text>
        <Text style={styles.sub}>Issued by {invoice.seller.legalName}{invoice.seller.gstin ? ` · GSTIN ${invoice.seller.gstin}` : ''}</Text>
      </PremiumCard>

      <PremiumCard style={styles.card}>
        <Text style={styles.title}>Services</Text>
        {invoice.lines.map((line) => (
          <View key={line.id} style={styles.rowBetween}>
            <Text style={[styles.cell, styles.flex]}>
              {line.description}
              {line.quantity > 1 ? ` × ${line.quantity}` : ''}
            </Text>
            <Text style={styles.cell}>{money(line.lineTotal)}</Text>
          </View>
        ))}
        <View style={styles.divider} />
        <Row label="Subtotal" value={money(invoice.subtotal)} />
        {invoice.discountTotal > 0 && <Row label="Discount" value={`-${money(invoice.discountTotal)}`} />}
        {invoice.taxLabel && invoice.taxTotal > 0 && (
          <Row label={`${invoice.taxLabel} ${invoice.taxRatePercent ?? ''}%${invoice.taxMode === 'INCLUSIVE' ? ' (included)' : ''}`} value={money(invoice.taxTotal)} />
        )}
        <Row label="Total" value={money(invoice.total)} strong />
        <Row label="Received" value={money(invoice.amountPaid)} />
        {invoice.amountRefunded > 0 && <Row label="Refunded" value={`-${money(invoice.amountRefunded)}`} />}
        <Row label="Balance due" value={money(invoice.balanceDue)} strong />
      </PremiumCard>

      <PremiumCard style={styles.card}>
        <Text style={styles.title}>Payments recorded</Text>
        {invoice.payments.length === 0 ? (
          <Hint>No payment has been recorded yet.</Hint>
        ) : (
          invoice.payments.map((p) => (
            <View key={p.id} style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={styles.cell}>{`${p.kind === 'REFUND' ? 'Refund' : 'Payment'} · ${METHOD_LABEL[p.method] ?? p.method}${p.reference ? ` · ${p.reference}` : ''}`}</Text>
                <Text style={styles.sub}>
                  {formatShopDate(p.recordedAt, null)} {formatShopTime(p.recordedAt, null)}
                  {p.note ? ` · ${p.note}` : ''}
                </Text>
              </View>
              <Text style={styles.cell}>
                {p.kind === 'REFUND' ? '-' : ''}
                {money(p.amount)}
              </Text>
            </View>
          ))
        )}
      </PremiumCard>

      {invoice.status === 'VOID' && (
        <Text style={styles.warn}>{`Voided${invoice.voidReason ? `: ${invoice.voidReason}` : ''}. The number stays on record and is never reused.`}</Text>
      )}

      {mode === null && invoice.status === 'ISSUED' && (
        <View style={styles.actions}>
          {invoice.balanceDue > 0 && <PremiumButton testID="invoice-record-payment" title="Record payment" onPress={() => { setNotice(null); setMode('payment'); }} />}
          {invoice.amountPaid - invoice.amountRefunded > 0 && <PremiumButton testID="invoice-record-refund" title="Record refund" variant="secondary" onPress={() => { setNotice(null); setMode('refund'); }} />}
          <PremiumButton testID="invoice-void" title="Void invoice" variant="quiet" onPress={() => { setNotice(null); setMode('void'); }} />
        </View>
      )}
      {mode === 'payment' || mode === 'refund' ? (
        <PaymentForm
          salonId={selectedSalonId}
          invoice={invoice}
          kind={mode === 'refund' ? 'REFUND' : 'PAYMENT'}
          onCancel={() => setMode(null)}
          onDone={(message) => {
            setMode(null);
            setNotice(message);
            void load();
          }}
        />
      ) : null}
      {mode === 'void' && (
        <VoidForm
          salonId={selectedSalonId}
          invoiceId={invoice.id}
          onCancel={() => setMode(null)}
          onDone={() => {
            setMode(null);
            setNotice('Invoice voided.');
            void load();
          }}
        />
      )}

      <PremiumButton testID="invoice-share" title="Share invoice summary" variant="secondary" onPress={() => void shareInvoice()} style={styles.share} />
      <Hint>The PDF copy of this invoice is available on the FastQue website under Billing & invoices.</Hint>
    </PremiumScreen>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.rowBetween}>
      <Text style={[styles.cell, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.cell, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

function PaymentForm({
  salonId,
  invoice,
  kind,
  onCancel,
  onDone,
}: {
  salonId: string;
  invoice: InvoiceDetailDto;
  kind: 'PAYMENT' | 'REFUND';
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const defaultAmount = kind === 'REFUND' ? invoice.amountPaid - invoice.amountRefunded : invoice.balanceDue;
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('CASH');
  const [amount, setAmount] = useState(String(defaultAmount));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attemptKey, setAttemptKey] = useState(() => newIdempotencyKey());

  async function submit() {
    setError(null);
    const value = parseAmount(amount);
    if (value === null) {
      setError('Enter an amount greater than zero, with at most 2 decimal places.');
      return;
    }
    const parsed = recordInvoicePaymentSchema.safeParse({ kind, method, amount: value, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the details and try again.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(ownerOpsPaths.invoicePayments(salonId, invoice.id), { method: 'POST', headers: { 'Idempotency-Key': attemptKey }, body: JSON.stringify(parsed.data) });
      onDone(kind === 'REFUND' ? 'Refund recorded.' : 'Payment recorded.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record this. Nothing was saved.');
      setAttemptKey(newIdempotencyKey());
    } finally {
      setBusy(false);
    }
  }

  return (
    <PremiumCard style={styles.card} testID="payment-form">
      <Text style={styles.title}>{kind === 'REFUND' ? 'Record a refund the shop has paid out' : 'Record money the shop has received'}</Text>
      {error && <InlineError message={error} />}
      <FieldLabel>Method</FieldLabel>
      <ChipRow>
        {PAYMENT_METHODS.map((m) => (
          <Chip key={m} testID={`pay-method-${m}`} label={METHOD_LABEL[m]} selected={method === m} onPress={() => setMethod(m)} />
        ))}
      </ChipRow>
      <FieldLabel>Amount</FieldLabel>
      <PremiumTextField testID="pay-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" accessibilityLabel="Amount" />
      <FieldLabel>Reference (optional)</FieldLabel>
      <PremiumTextField testID="pay-reference" value={reference} onChangeText={setReference} maxLength={80} accessibilityLabel="Reference" />
      <FieldLabel>Note (optional)</FieldLabel>
      <PremiumTextField value={note} onChangeText={setNote} maxLength={200} accessibilityLabel="Note" />
      <View style={styles.actions}>
        <PremiumButton testID="pay-submit" title={kind === 'REFUND' ? 'Record refund' : 'Record payment'} onPress={() => void submit()} loading={busy} />
        <PremiumButton title="Cancel" variant="quiet" onPress={onCancel} />
      </View>
    </PremiumCard>
  );
}

function VoidForm({ salonId, invoiceId, onCancel, onDone }: { salonId: string; invoiceId: string; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const parsed = voidInvoiceSchema.safeParse({ reason });
    if (!parsed.success) {
      setError('Say why this invoice is being voided (3 to 300 characters).');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`${ownerOpsPaths.invoice(salonId, invoiceId)}/void`, { method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() }, body: JSON.stringify(parsed.data) });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not void the invoice.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PremiumCard style={styles.card} testID="void-form">
      <Text style={styles.title}>Void this invoice</Text>
      <Hint>The number stays on record and is never reused.</Hint>
      {error && <InlineError message={error} />}
      <FieldLabel>Reason</FieldLabel>
      <PremiumTextField testID="void-reason" value={reason} onChangeText={setReason} maxLength={300} accessibilityLabel="Reason" />
      <View style={styles.actions}>
        <PremiumButton testID="void-submit" title="Void invoice" onPress={() => void submit()} loading={busy} />
        <PremiumButton title="Cancel" variant="quiet" onPress={onCancel} />
      </View>
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 200, borderRadius: 20 },
  card: { marginBottom: space[3] },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: fastQue.text, marginBottom: space[1] },
  big: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, lineHeight: lineHeightFor(fontSize.xl), color: fastQue.text, marginTop: space[2] },
  sub: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: fastQue.textMuted, marginTop: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], paddingVertical: 3 },
  flex: { flex: 1 },
  cell: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: fastQue.textSecondary },
  strong: { fontFamily: font.bodyBold, color: fastQue.text },
  divider: { height: 1, backgroundColor: fastQue.border, marginVertical: space[2] },
  actions: { gap: space[2], marginTop: space[2] },
  share: { marginTop: space[2] },
  notice: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.success, marginBottom: space[2] },
  warn: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: fastQue.warning, marginBottom: space[3] },
});
