import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatMoney, InvoicePaymentKind, InvoicePaymentMethod, recordInvoicePaymentSchema, voidInvoiceSchema } from '@barbercue/shared';
import type { InvoiceDetailDto, InvoicePaymentKind as InvoicePaymentKindType, InvoicePaymentMethod as InvoicePaymentMethodType } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { ownerInvoiceDetailRequestPath, ownerInvoicePaymentsRequestPath, ownerInvoicePdfRequestPath, ownerInvoiceVoidRequestPath } from '../../lib/owner-invoices';
import { shareOwnerFile } from '../../lib/owner-file-share';
import { newIdempotencyKey } from '../../lib/idempotency';
import { dateLocaleFor } from '../../lib/date-locale';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { Button, Card, InlineError, Screen, SectionHeader, Skeleton } from '../../components/ui';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Props = NativeStackScreenProps<OwnerShopStackParamList, 'OwnerInvoiceDetail'>;

export default function OwnerInvoiceDetailScreen({ route }: Props) {
  const { invoiceId, salonId } = route.params;
  const { language } = useLanguage();
  const [invoice, setInvoice] = useState<InvoiceDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentKind, setPaymentKind] = useState<InvoicePaymentKindType | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voidMode, setVoidMode] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [voidIdempotencyKey] = useState(newIdempotencyKey);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<InvoiceDetailDto>(ownerInvoiceDetailRequestPath(salonId, invoiceId))
      .then((result) => { if (!cancelled) setInvoice(result); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load this invoice.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [invoiceId, salonId]);

  useFocusEffect(useCallback(() => load(), [load]));

  const saveVoid = async (reason: string) => {
    setVoidBusy(true);
    setError(null);
    try {
      const updated = await apiFetch<InvoiceDetailDto>(ownerInvoiceVoidRequestPath(salonId, invoiceId), {
        method: 'POST',
        headers: { 'Idempotency-Key': voidIdempotencyKey },
        body: JSON.stringify({ reason }),
      });
      setInvoice(updated);
      setVoidMode(false);
      setNotice(language === 'HI' ? 'इनवॉइस रद्द किया गया।' : 'Invoice voided. Its number and audit history remain on record.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (language === 'HI' ? 'इनवॉइस रद्द नहीं किया जा सका।' : 'Could not void this invoice. Any recorded payments must be refunded first.'));
    } finally {
      setVoidBusy(false);
    }
  };

  const submitVoid = () => {
    const parsed = voidInvoiceSchema.safeParse({ reason: voidReason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? (language === 'HI' ? 'कारण जाँचें।' : 'Enter a valid reason.'));
      return;
    }
    setError(null);
    const isHindi = language === 'HI';
    Alert.alert(
      isHindi ? 'इनवॉइस रद्द करने की पुष्टि करें' : 'Confirm invoice void',
      isHindi ? `यह इनवॉइस रद्द करेगा: ${parsed.data.reason}` : `This will void the invoice and keep its number on record: ${parsed.data.reason}`,
      [
        { text: isHindi ? 'अभी नहीं' : 'Not now', style: 'cancel' },
        { text: isHindi ? 'हाँ, रद्द करें' : 'Yes, void invoice', style: 'destructive', onPress: () => { void saveVoid(parsed.data.reason); } },
      ],
    );
  };

  const sharePdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      await shareOwnerFile({
        kind: 'pdf',
        path: ownerInvoicePdfRequestPath(salonId, invoiceId),
        fileName: `${invoice?.number ?? 'fastque-invoice'}.pdf`,
        contentType: 'application/pdf',
      });
    } catch {
      setPdfError(language === 'HI' ? 'इनवॉइस PDF साझा नहीं हो सका। फिर से प्रयास करें।' : 'Could not prepare the invoice PDF. Please try again.');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <Screen contentStyle={styles.screenContent}>
      {loading ? <Skeleton style={styles.skeleton} /> : error ? <InlineError message={error} /> : invoice ? (
        <>
          <SectionHeader eyebrow="Shop invoice" title={invoice.number} subtitle={`${invoice.salonName} · ${new Date(invoice.serviceDate).toLocaleDateString(dateLocaleFor(language))}`} />
          {Platform.OS === 'ios' ? <Button title={pdfBusy ? (language === 'HI' ? 'PDF तैयार हो रहा है…' : 'Preparing PDF…') : (language === 'HI' ? 'इनवॉइस PDF साझा करें' : 'Share invoice PDF')} variant="outline" onPress={() => { void sharePdf(); }} loading={pdfBusy} disabled={pdfBusy} /> : null}
          {pdfError ? <InlineError message={pdfError} /> : null}
          {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
          {invoice.status === 'VOID' ? <Text style={styles.muted}>{language === 'HI' ? 'रद्द किया गया' : 'Voided'}{invoice.voidReason ? `: ${invoice.voidReason}` : ''}. {language === 'HI' ? 'इनवॉइस नंबर रिकॉर्ड में सुरक्षित है।' : 'The invoice number remains on record.'}</Text> : null}
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>Services</Text>
            {invoice.lines.map((line) => (
              <View key={line.id} style={styles.row}>
                <View style={styles.lineInfo}>
                  <Text style={styles.label}>{line.description}</Text>
                  {line.quantity > 1 && <Text style={styles.muted}>Qty {line.quantity}</Text>}
                </View>
                <Text style={styles.value}>{formatMoney(line.lineTotal, invoice.currency)}</Text>
              </View>
            ))}
            <View style={[styles.row, styles.totalRow]}><Text style={styles.label}>Subtotal</Text><Text style={styles.value}>{formatMoney(invoice.subtotal, invoice.currency)}</Text></View>
            {invoice.discountTotal > 0 && <View style={styles.row}><Text style={styles.label}>Discount</Text><Text style={styles.value}>−{formatMoney(invoice.discountTotal, invoice.currency)}</Text></View>}
            {invoice.taxTotal > 0 && <View style={styles.row}><Text style={styles.label}>{invoice.taxLabel ?? 'Tax'}</Text><Text style={styles.value}>{formatMoney(invoice.taxTotal, invoice.currency)}</Text></View>}
            <View style={[styles.row, styles.grandTotal]}><Text style={styles.cardTitle}>Total</Text><Text style={styles.cardTitle}>{formatMoney(invoice.total, invoice.currency)}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Recorded payments</Text><Text style={styles.value}>{formatMoney(invoice.amountPaid, invoice.currency)}</Text></View>
            {invoice.amountRefunded > 0 && <View style={styles.row}><Text style={styles.label}>Recorded refunds</Text><Text style={styles.value}>{formatMoney(invoice.amountRefunded, invoice.currency)}</Text></View>}
            <View style={styles.row}><Text style={styles.label}>Balance due</Text><Text style={styles.value}>{formatMoney(invoice.balanceDue, invoice.currency)}</Text></View>
          </Card>
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>Payment records</Text>
            {invoice.payments.length === 0 ? <Text style={styles.muted}>No payment has been recorded on this invoice.</Text> : invoice.payments.map((payment) => (
              <View key={payment.id} style={styles.row}>
                <View style={styles.lineInfo}>
                  <Text style={styles.label}>{payment.kind === 'REFUND' ? 'Refund' : 'Payment'} · {payment.method}</Text>
                  <Text style={styles.muted}>{new Date(payment.recordedAt).toLocaleDateString(dateLocaleFor(language))}</Text>
                </View>
                <Text style={styles.value}>{formatMoney(payment.amount, invoice.currency)}</Text>
              </View>
            ))}
          </Card>
          {invoice.status === 'ISSUED' && !paymentKind ? (
            <View style={styles.actions}>
              {invoice.balanceDue > 0 ? <Button title={language === 'HI' ? 'प्राप्त भुगतान दर्ज करें' : 'Record received payment'} onPress={() => setPaymentKind(InvoicePaymentKind.PAYMENT)} /> : null}
              {invoice.amountPaid > invoice.amountRefunded ? <Button title={language === 'HI' ? 'वास्तविक रिफंड दर्ज करें' : 'Record paid-out refund'} variant="outline" onPress={() => setPaymentKind(InvoicePaymentKind.REFUND)} /> : null}
              {!voidMode ? <Button title={language === 'HI' ? 'इनवॉइस रद्द करें' : 'Void invoice'} variant="outline" onPress={() => { setError(null); setVoidMode(true); }} /> : null}
            </View>
          ) : null}
          {voidMode && invoice.status === 'ISSUED' ? (
            <Card style={styles.formCard}>
              <Text style={styles.cardTitle}>{language === 'HI' ? 'इनवॉइस रद्द करें' : 'Void invoice'}</Text>
              <Text style={styles.formHint}>{language === 'HI' ? 'कारण आवश्यक है। दर्ज भुगतान होने पर पहले वास्तविक रिफंड रिकॉर्ड करना होगा।' : 'A reason is required. Any recorded payment must be refunded first; voiding never deletes payment history.'}</Text>
              {error ? <InlineError message={error} /> : null}
              <Text style={styles.inputLabel}>{language === 'HI' ? 'कारण' : 'Reason'}</Text>
              <TextInput
                accessibilityLabel={language === 'HI' ? 'कारण' : 'Reason'}
                value={voidReason}
                onChangeText={setVoidReason}
                maxLength={300}
                multiline
                style={[styles.input, styles.reasonInput]}
              />
              <View style={styles.actions}>
                <Button title={language === 'HI' ? 'वापस' : 'Cancel'} variant="outline" onPress={() => setVoidMode(false)} disabled={voidBusy} />
                <Button title={voidBusy ? (language === 'HI' ? 'सहेज रहे हैं…' : 'Voiding…') : (language === 'HI' ? 'रद्द करने की समीक्षा' : 'Review void')} onPress={submitVoid} loading={voidBusy} />
              </View>
            </Card>
          ) : null}
          {paymentKind ? (
            <PaymentEntry
              invoice={invoice}
              kind={paymentKind}
              language={language}
              onCancel={() => setPaymentKind(null)}
              onSaved={(updated) => {
                setInvoice(updated);
                setPaymentKind(null);
                setNotice(paymentKind === InvoicePaymentKind.REFUND
                  ? (language === 'HI' ? 'रिफंड रिकॉर्ड सहेजा गया।' : 'Refund record saved.')
                  : (language === 'HI' ? 'भुगतान रिकॉर्ड सहेजा गया।' : 'Payment record saved.'));
              }}
            />
          ) : null}
          <Text style={styles.disclaimer}>Amounts reflect payment records entered by the shop. This screen does not collect payments or infer payment from a QR code.</Text>
        </>
      ) : null}
    </Screen>
  );
}

const PAYMENT_METHODS: readonly InvoicePaymentMethodType[] = [
  InvoicePaymentMethod.CASH,
  InvoicePaymentMethod.UPI,
  InvoicePaymentMethod.CARD,
  InvoicePaymentMethod.OTHER,
];

function PaymentEntry({
  invoice,
  kind,
  language,
  onCancel,
  onSaved,
}: {
  invoice: InvoiceDetailDto;
  kind: InvoicePaymentKindType;
  language: string;
  onCancel: () => void;
  onSaved: (invoice: InvoiceDetailDto) => void;
}) {
  const isRefund = kind === InvoicePaymentKind.REFUND;
  const [amount, setAmount] = useState(String(isRefund ? invoice.amountPaid - invoice.amountRefunded : invoice.balanceDue));
  const [method, setMethod] = useState<InvoicePaymentMethodType>(InvoicePaymentMethod.CASH);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const isHindi = language === 'HI';
  const labels = isHindi
    ? { paymentTitle: 'दुकान को वास्तव में मिली राशि दर्ज करें', refundTitle: 'दुकान द्वारा वास्तव में लौटाई गई राशि दर्ज करें', amount: 'राशि', method: 'माध्यम', reference: 'संदर्भ (वैकल्पिक)', note: 'नोट (वैकल्पिक)', cancel: 'रद्द करें', save: 'रिकॉर्ड सहेजें', saving: 'सहेज रहे हैं…', invalid: 'राशि और भुगतान विवरण जाँचें।', confirmPayment: 'क्या यह राशि दुकान को वास्तव में प्राप्त हुई?', confirmRefund: 'क्या यह राशि ग्राहक को वास्तव में लौटाई गई?', yes: 'हाँ, रिकॉर्ड करें', no: 'अभी नहीं' }
    : { paymentTitle: 'Record money the shop actually received', refundTitle: 'Record money the shop actually paid back', amount: 'Amount', method: 'Method', reference: 'Reference (optional)', note: 'Note (optional)', cancel: 'Cancel', save: 'Review record', saving: 'Saving…', invalid: 'Check the amount and payment details.', confirmPayment: 'Was this amount actually received by the shop?', confirmRefund: 'Was this amount actually returned to the customer?', yes: 'Yes, record it', no: 'Not now' };

  const submit = () => {
    const parsed = recordInvoicePaymentSchema.safeParse({
      kind,
      method,
      amount: Number(amount),
      reference: reference.trim() || undefined,
      note: note.trim() || undefined,
    });
    const ceiling = isRefund ? invoice.amountPaid - invoice.amountRefunded : invoice.balanceDue;
    if (!parsed.success || !Number.isFinite(Number(amount)) || Number(amount) > ceiling) {
      setError(parsed.success ? (isHindi ? 'राशि शेष देय/वापसी योग्य राशि से अधिक नहीं हो सकती।' : 'Amount cannot exceed the remaining balance.') : (parsed.error.issues[0]?.message ?? labels.invalid));
      return;
    }
    setError(null);
    Alert.alert(
      isRefund ? labels.refundTitle : labels.paymentTitle,
      isRefund
        ? `${labels.confirmRefund} ${formatMoney(Number(amount), invoice.currency)} · ${method}`
        : `${labels.confirmPayment} ${formatMoney(Number(amount), invoice.currency)} · ${method}`,
      [
        { text: labels.no, style: 'cancel' },
        { text: labels.yes, style: isRefund ? 'destructive' : 'default', onPress: () => { void save(parsed.data); } },
      ],
    );
  };

  const save = async (payload: ReturnType<typeof recordInvoicePaymentSchema.parse>) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await apiFetch<InvoiceDetailDto>(ownerInvoicePaymentsRequestPath(invoice.salonId, invoice.id), {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (isHindi ? 'रिकॉर्ड सहेजा नहीं जा सका।' : 'Could not save the payment record.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.formCard}>
      <Text style={styles.cardTitle}>{isRefund ? labels.refundTitle : labels.paymentTitle}</Text>
      <Text style={styles.formHint}>{isHindi ? 'यह भुगतान स्वीकार या भेजता नहीं है—यह केवल वास्तविक लेन-देन का रिकॉर्ड बनाता है।' : 'This does not collect or send money; it records an actual offline transaction only.'}</Text>
      {error ? <InlineError message={error} /> : null}
      <Text style={styles.inputLabel}>{labels.amount} · {invoice.currency}</Text>
      <TextInput accessibilityLabel={labels.amount} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoCorrect={false} style={styles.input} />
      <Text style={styles.inputLabel}>{labels.method}</Text>
      <View style={styles.methods}>
        {PAYMENT_METHODS.map((value) => (
          <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: method === value }} onPress={() => setMethod(value)} style={[styles.method, method === value && styles.methodSelected]}>
            <Text style={[styles.methodText, method === value && styles.methodTextSelected]}>{value}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.inputLabel}>{labels.reference}</Text>
      <TextInput accessibilityLabel={labels.reference} value={reference} onChangeText={setReference} maxLength={80} style={styles.input} />
      <Text style={styles.inputLabel}>{labels.note}</Text>
      <TextInput accessibilityLabel={labels.note} value={note} onChangeText={setNote} maxLength={200} style={styles.input} />
      <View style={styles.actions}>
        <Button title={labels.cancel} variant="outline" onPress={onCancel} disabled={busy} />
        <Button title={busy ? labels.saving : labels.save} onPress={submit} loading={busy} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeleton: { height: 260, borderRadius: radius.lg },
  card: { marginBottom: space[4] },
  cardTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space[3], paddingVertical: space[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  lineInfo: { flex: 1 },
  label: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink },
  value: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  muted: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  totalRow: { marginTop: space[2] },
  grandTotal: { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: color.border, marginTop: space[2], paddingTop: space[4] },
  disclaimer: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.muted, marginTop: space[2] },
  actions: { gap: space[2], marginBottom: space[4] },
  formCard: { marginBottom: space[4] },
  formHint: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.muted, marginTop: space[2], marginBottom: space[3] },
  inputLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink, marginTop: space[3], marginBottom: space[1] },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space[3], color: color.ink, fontFamily: font.bodyRegular, fontSize: fontSize.base },
  reasonInput: { minHeight: 84, textAlignVertical: 'top', paddingVertical: space[3] },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  method: { borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingVertical: space[2], paddingHorizontal: space[3] },
  methodSelected: { backgroundColor: color.ink, borderColor: color.ink },
  methodText: { color: color.ink, fontFamily: font.bodyMedium, fontSize: fontSize.sm },
  methodTextSelected: { color: color.surface },
  notice: { color: color.success, fontFamily: font.bodyMedium, fontSize: fontSize.sm, marginBottom: space[3] },
});
