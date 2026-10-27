import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatMoney, InvoicePaymentKind, InvoicePaymentMethod, recordInvoicePaymentSchema } from '@barbercue/shared';
import type { InvoiceDetailDto, InvoicePaymentKind as InvoicePaymentKindType, InvoicePaymentMethod as InvoicePaymentMethodType } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { ownerInvoiceDetailRequestPath, ownerInvoicePaymentsRequestPath } from '../../lib/owner-invoices';
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

  return (
    <Screen contentStyle={styles.screenContent}>
      {loading ? <Skeleton style={styles.skeleton} /> : error ? <InlineError message={error} /> : invoice ? (
        <>
          <SectionHeader eyebrow="Shop invoice" title={invoice.number} subtitle={`${invoice.salonName} · ${new Date(invoice.serviceDate).toLocaleDateString(dateLocaleFor(language))}`} />
          {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
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
            </View>
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
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  method: { borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingVertical: space[2], paddingHorizontal: space[3] },
  methodSelected: { backgroundColor: color.ink, borderColor: color.ink },
  methodText: { color: color.ink, fontFamily: font.bodyMedium, fontSize: fontSize.sm },
  methodTextSelected: { color: color.surface },
  notice: { color: color.success, fontFamily: font.bodyMedium, fontSize: fontSize.sm, marginBottom: space[3] },
});
