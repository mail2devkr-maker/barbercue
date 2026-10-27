import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '@barbercue/shared';
import type { InvoiceDetailDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { ownerInvoiceDetailRequestPath } from '../../lib/owner-invoices';
import { dateLocaleFor } from '../../lib/date-locale';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { Card, InlineError, Screen, SectionHeader, Skeleton } from '../../components/ui';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Props = NativeStackScreenProps<OwnerShopStackParamList, 'OwnerInvoiceDetail'>;

export default function OwnerInvoiceDetailScreen({ route }: Props) {
  const { invoiceId, salonId } = route.params;
  const { language } = useLanguage();
  const [invoice, setInvoice] = useState<InvoiceDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          <Text style={styles.disclaimer}>Amounts reflect payment records entered by the shop. This screen does not collect payments or infer payment from a QR code.</Text>
        </>
      ) : null}
    </Screen>
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
});
