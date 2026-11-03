import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { InvoiceDetailDto, InvoiceListDto, InvoiceSummaryDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { formatMoney, formatShopDate, ownerOpsPaths } from '../lib/owner/ops';
import { paymentStatusView } from '../lib/owner/invoice-view';
import { color, font, fontSize, lineHeightFor, radius, space } from '../lib/theme';
import { Button, Card, EmptyState, InlineError, Screen, SectionHeader, Skeleton } from '../components/ui';

/**
 * A customer's own invoices. The server only ever returns invoices issued to this account, and the
 * status shown is what the shop recorded - an invoice is "Paid" only after the shop says it received
 * the payment.
 */
export default function MyInvoicesScreen() {
  const [items, setItems] = useState<InvoiceSummaryDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceDetailDto | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (cursor: string | null = null) => {
    try {
      const page = await apiFetch<InvoiceListDto>(ownerOpsPaths.myInvoices(cursor));
      setItems((current) => (cursor && current ? [...current, ...page.items] : page.items));
      setNext(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your invoices.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function toggle(id: string) {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    try {
      setDetail(await apiFetch<InvoiceDetailDto>(ownerOpsPaths.myInvoice(id)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this invoice.');
    }
  }

  return (
    <Screen>
      <SectionHeader eyebrow="Account" title="My invoices" />
      {error && <InlineError message={error} />}
      {items === null && !error ? <Skeleton style={styles.skeleton} /> : null}
      {items && items.length === 0 ? <EmptyState title="No invoices yet" message="When a shop issues an invoice for one of your visits it appears here." /> : null}
      {items?.map((inv) => {
        const view = paymentStatusView(inv);
        const open = openId === inv.id;
        const money = (n: number) => formatMoney(n, inv.currency);
        return (
          <Pressable key={inv.id} testID={`my-invoice-${inv.number}`} accessibilityRole="button" accessibilityLabel={`Invoice ${inv.number}, ${view.label}`} onPress={() => void toggle(inv.id)}>
            <Card style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.number}>{inv.number}</Text>
                <Text style={styles.status}>{view.label}</Text>
              </View>
              <Text style={styles.meta}>
                {formatShopDate(inv.issuedAt, null)} · {money(inv.total)}
                {inv.balanceDue > 0 && inv.status === 'ISSUED' ? ` · ${money(inv.balanceDue)} due` : ''}
              </Text>
              {open && (
                <View style={styles.detail}>
                  {!detail ? (
                    <Text style={styles.meta}>Loading…</Text>
                  ) : (
                    <>
                      <Text style={styles.meta}>{detail.seller.legalName}{detail.seller.gstin ? ` · GSTIN ${detail.seller.gstin}` : ''}</Text>
                      {detail.lines.map((line) => (
                        <View key={line.id} style={styles.rowBetween}>
                          <Text style={styles.line}>{line.description}{line.quantity > 1 ? ` × ${line.quantity}` : ''}</Text>
                          <Text style={styles.line}>{money(line.lineTotal)}</Text>
                        </View>
                      ))}
                      {detail.taxLabel && detail.taxTotal > 0 && (
                        <View style={styles.rowBetween}>
                          <Text style={styles.line}>{detail.taxLabel}</Text>
                          <Text style={styles.line}>{money(detail.taxTotal)}</Text>
                        </View>
                      )}
                      <View style={styles.rowBetween}>
                        <Text style={styles.total}>Total</Text>
                        <Text style={styles.total}>{money(detail.total)}</Text>
                      </View>
                      <View style={styles.rowBetween}>
                        <Text style={styles.line}>Paid to the shop</Text>
                        <Text style={styles.line}>{money(detail.amountPaid)}</Text>
                      </View>
                    </>
                  )}
                </View>
              )}
            </Card>
          </Pressable>
        );
      })}
      {next && (
        <Button
          title="Load more"
          variant="outline"
          loading={loadingMore}
          onPress={() => {
            setLoadingMore(true);
            void load(next).finally(() => setLoadingMore(false));
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 90, borderRadius: radius.lg },
  card: { marginBottom: space[3] },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[2], paddingVertical: 2 },
  number: { fontFamily: font.bodyBold, fontSize: fontSize.base, color: color.ink },
  status: { fontFamily: font.bodyBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: color.gold },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.muted, marginTop: space[1] },
  detail: { marginTop: space[2], paddingTop: space[2], borderTopWidth: 1, borderTopColor: color.border },
  line: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.ink, flexShrink: 1 },
  total: { fontFamily: font.bodyBold, fontSize: fontSize.sm, color: color.ink },
});
