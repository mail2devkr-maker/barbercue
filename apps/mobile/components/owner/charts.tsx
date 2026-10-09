import { StyleSheet, Text, View } from 'react-native';
import type { DailyServiceValueDto } from '@barbercue/shared';
import { columnChart, heatIntensity, rankedWidths, splitPercent } from '../../lib/owner/analytics';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';

/**
 * Small native charts drawn with plain Views — no chart or SVG dependency, so no new native module
 * and no bundle growth. They only visualise numbers the backend already computed.
 */

const CHART_HEIGHT = 140;

export function ColumnChart({
  rows,
  formatValue,
  emptyText,
  accessibilityLabel,
}: {
  rows: readonly DailyServiceValueDto[];
  formatValue: (value: number) => string;
  emptyText: string;
  accessibilityLabel: string;
}) {
  if (rows.length === 0) return <Text style={styles.empty}>{emptyText}</Text>;
  const bars = columnChart(rows);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} testID="column-chart">
      <View style={styles.columns}>
        {bars.map((bar) => (
          <View key={bar.key} style={styles.columnSlot} testID={`column-${bar.key}`} accessibilityLabel={`${bar.label}: ${formatValue(bar.value)}`}>
            <View style={styles.columnTrack}>
              <View style={[styles.columnFill, { height: `${bar.heightPercent}%` }]} />
            </View>
          </View>
        ))}
      </View>
      <View style={styles.columnLabels}>
        {bars.map((bar) => (
          <View key={bar.key} style={styles.columnSlot}>
            {bar.showLabel ? (
              <Text style={styles.columnLabel} numberOfLines={1}>
                {bar.label}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export interface RankedRow {
  key: string;
  name: string;
  value: number;
  meta: string;
}

export function RankedBars({ rows, emptyText }: { rows: readonly RankedRow[]; emptyText: string }) {
  if (rows.length === 0) return <Text style={styles.empty}>{emptyText}</Text>;
  const widths = rankedWidths(rows.map((row) => row.value));
  return (
    <View style={styles.rankedList}>
      {rows.map((row, index) => (
        <View key={row.key} testID={`ranked-${row.key}`}>
          <View style={styles.rankedHeader}>
            <Text style={styles.rankedName} numberOfLines={1}>
              {row.name}
            </Text>
            <Text style={styles.rankedMeta}>{row.meta}</Text>
          </View>
          <View style={styles.rankedTrack}>
            <View style={[styles.rankedFill, { width: `${widths[index]}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function SplitBar({
  leftLabel,
  leftValue,
  leftText,
  rightLabel,
  rightValue,
  rightText,
}: {
  leftLabel: string;
  leftValue: number;
  leftText: string;
  rightLabel: string;
  rightValue: number;
  rightText: string;
}) {
  return (
    <View testID="split-bar">
      <View style={styles.splitTrack}>
        <View style={[styles.splitLeft, { width: `${splitPercent(leftValue, rightValue)}%` }]} />
      </View>
      <View style={styles.splitLegend}>
        <View>
          <Text style={styles.splitLabel}>{leftLabel}</Text>
          <Text style={styles.splitValue}>{leftText}</Text>
        </View>
        <View style={styles.splitRight}>
          <Text style={styles.splitLabel}>{rightLabel}</Text>
          <Text style={styles.splitValue}>{rightText}</Text>
        </View>
      </View>
    </View>
  );
}

export interface HeatCell {
  hour: number;
  title: string;
  value: string;
  caption: string;
  intensity: number;
}

export function HeatGrid({ cells }: { cells: readonly HeatCell[] }) {
  return (
    <View style={styles.heatGrid} testID="heat-grid">
      {cells.map((cell) => (
        <View
          key={cell.hour}
          testID={`heat-${cell.hour}`}
          accessible
          accessibilityLabel={`${cell.title}, ${cell.value}, ${cell.caption}`}
          style={[styles.heatCell, { backgroundColor: `rgba(242,10,131,${0.06 + cell.intensity * 0.5})` }]}
        >
          <Text style={styles.heatTitle}>{cell.title}</Text>
          <Text style={styles.heatValue} numberOfLines={1}>
            {cell.value}
          </Text>
          <Text style={styles.heatCaption}>{cell.caption}</Text>
        </View>
      ))}
    </View>
  );
}

export function buildHeatCells(
  rows: ReadonlyArray<{ hour: number; completedCount: number; estimatedServiceValue: number }>,
  format: { hour: (h: number) => string; money: (v: number) => string; done: (count: number) => string },
): HeatCell[] {
  const max = Math.max(0, ...rows.map((row) => row.estimatedServiceValue));
  return rows.map((row) => ({
    hour: row.hour,
    title: format.hour(row.hour),
    value: format.money(row.estimatedServiceValue),
    caption: format.done(row.completedCount),
    intensity: heatIntensity(row.estimatedServiceValue, max),
  }));
}

const styles = StyleSheet.create({
  empty: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textMuted },
  columns: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 2 },
  columnSlot: { flex: 1, minWidth: 0 },
  columnTrack: { height: CHART_HEIGHT, justifyContent: 'flex-end' },
  columnFill: { width: '100%', backgroundColor: fastQue.pink, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  columnLabels: { flexDirection: 'row', gap: 2, marginTop: space[1] },
  columnLabel: { fontFamily: font.bodyRegular, fontSize: 9, color: fastQue.textMuted, width: 44, marginLeft: -10 },
  rankedList: { gap: space[3] },
  rankedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[3], marginBottom: space[1] },
  rankedName: { flex: 1, fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.text },
  rankedMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted },
  rankedTrack: { height: 8, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  rankedFill: { height: '100%', borderRadius: radius.pill, backgroundColor: fastQue.pink },
  splitTrack: { height: 16, borderRadius: radius.pill, backgroundColor: 'rgba(242,10,131,0.28)', overflow: 'hidden' },
  splitLeft: { height: '100%', backgroundColor: fastQue.pink },
  splitLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] },
  splitRight: { alignItems: 'flex-end' },
  splitLabel: { fontFamily: font.bodyBold, fontSize: fontSize.sm, color: fastQue.text },
  splitValue: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted },
  heatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  heatCell: { width: '23%', borderRadius: radius.sm, borderWidth: 1, borderColor: fastQue.border, padding: space[2] },
  heatTitle: { fontFamily: font.bodyBold, fontSize: fontSize.xs, color: fastQue.text },
  heatValue: { fontFamily: font.bodySemiBold, fontSize: 10, color: fastQue.text, marginTop: 2 },
  heatCaption: { fontFamily: font.bodyRegular, fontSize: 9, color: fastQue.textMuted },
});
