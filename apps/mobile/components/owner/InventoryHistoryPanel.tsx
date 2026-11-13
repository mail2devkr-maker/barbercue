import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { INVENTORY_PATHS, type InventoryMovementDto } from '@barbercue/shared';
import { useCursorList } from '../../lib/use-cursor-list';
import { inventoryBase } from '../../lib/use-inventory-lookups';
import { kindLabel, moneyText, MOVEMENT_KINDS, signedQuantity, trimDecimal, type MovementKind } from '../../lib/inventory-shared';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * Website parity for apps/web/components/owner/inventory/StockViews.tsx → HistoryView: every stock
 * movement in the shop, newest first, filtered by type and (optionally) by product name. Entries are
 * shown as recorded and cannot be changed; a mistake is corrected with an adjustment.
 */
export function InventoryHistoryPanel({ salonId, currency }: { salonId: string; currency: string | null }) {
  const [kind, setKind] = useState<MovementKind | ''>('');
  const [productText, setProductText] = useState('');
  const list = useCursorList<InventoryMovementDto>(`${inventoryBase(salonId)}/${INVENTORY_PATHS.movements}`, { kind });
  const needle = productText.trim().toLowerCase();
  const rows = needle ? list.items.filter((m) => m.productName.toLowerCase().includes(needle) || (m.sku ?? '').toLowerCase().includes(needle)) : list.items;
  const filtering = Boolean(kind || needle);

  return (
    <Card>
      <Text style={styles.heading}>Stock history</Text>
      <Text style={styles.muted}>Every stock change, as recorded. Entries are never edited or deleted; a mistake is corrected with an adjustment.</Text>
      <Text style={styles.label}>Type</Text>
      <View style={styles.chips}>
        {(['', ...MOVEMENT_KINDS] as Array<MovementKind | ''>).map((k) => (
          <Pressable key={k || 'all'} accessibilityRole="radio" accessibilityState={{ checked: kind === k }} onPress={() => setKind(k)} style={[styles.chip, kind === k && styles.chipOn]}>
            <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{k ? kindLabel(k) : 'All types'}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel="Only this product (optional)"
        placeholder="Only this product (name or SKU)"
        placeholderTextColor={color.muted}
        value={productText}
        onChangeText={setProductText}
        autoCorrect={false}
        style={styles.input}
      />
      {list.error ? <InlineError message={list.error} /> : null}
      {list.loading ? <Text style={styles.muted}>…</Text> : rows.length === 0 ? (
        <Text style={styles.muted}>{filtering ? 'No entries match' : 'No stock movements yet'}</Text>
      ) : rows.map((m) => (
        <View key={m.id} style={styles.row} accessibilityLabel={`${kindLabel(m.kind)} ${m.productName}`}>
          <View style={styles.flex}>
            <Text style={styles.strong}>{m.productName}</Text>
            <Text style={styles.small}>{`${kindLabel(m.kind)} · ${new Date(m.recordedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}${m.supplier ? ` · ${m.supplier.name}` : ''}${m.reason ? ` · ${m.reason}` : ''}`}</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.strong}>{signedQuantity(m.quantityDelta)}</Text>
            <Text style={styles.small}>{`now ${trimDecimal(m.stockAfter)}${m.unitCost ? ` · ${moneyText(m.unitCost, currency)}` : ''}`}</Text>
          </View>
        </View>
      ))}
      {list.notice ? <Text style={styles.muted}>{list.notice}</Text> : null}
      {list.hasMore ? <Button title={list.loadingMore ? 'Loading…' : 'Load more'} variant="outline" onPress={list.loadMore} disabled={list.loadingMore} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base },
  label: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm, marginTop: space[2] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.sm, marginVertical: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginVertical: space[2] },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1, borderColor: color.border },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
  chipTextOn: { fontFamily: font.bodyBold },
  input: { minHeight: 44, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space[3], color: color.ink, fontFamily: font.bodyRegular, marginBottom: space[2] },
  row: { flexDirection: 'row', gap: space[2], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  flex: { flex: 1 },
  right: { alignItems: 'flex-end' },
  strong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  small: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs },
});
