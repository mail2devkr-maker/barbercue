import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { fastQue, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';

/** Small dark-theme form pieces shared by the owner-operations screens. */

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Hint({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'ok' }) {
  return <Text style={[styles.hint, tone === 'warn' && styles.hintWarn, tone === 'ok' && styles.hintOk]}>{children}</Text>;
}

export function Chip({
  label,
  selected,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ false: 'rgba(255,255,255,0.18)', true: fastQue.pink }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

export function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'info' | 'neutral' | 'danger' }) {
  return (
    <View style={[styles.pill, pillTone[tone]]}>
      <Text style={[styles.pillText, pillTextTone[tone]]}>{label}</Text>
    </View>
  );
}

const pillTone = StyleSheet.create({
  ok: { backgroundColor: 'rgba(114,213,154,0.14)', borderColor: 'rgba(114,213,154,0.4)' },
  warn: { backgroundColor: 'rgba(255,195,104,0.14)', borderColor: 'rgba(255,195,104,0.4)' },
  info: { backgroundColor: 'rgba(120,160,255,0.14)', borderColor: 'rgba(120,160,255,0.4)' },
  neutral: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: fastQue.border },
  danger: { backgroundColor: 'rgba(255,139,154,0.14)', borderColor: 'rgba(255,139,154,0.4)' },
});
const pillTextTone = StyleSheet.create({
  ok: { color: fastQue.success },
  warn: { color: fastQue.warning },
  info: { color: '#a9c1ff' },
  neutral: { color: fastQue.textSecondary },
  danger: { color: fastQue.error },
});

const styles = StyleSheet.create({
  label: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: fastQue.textSecondary, marginTop: space[3], marginBottom: space[1] },
  hint: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: fastQue.textMuted, marginTop: 2 },
  hintWarn: { color: fastQue.warning },
  hintOk: { color: fastQue.success },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1, borderColor: fastQue.border },
  chipSelected: { borderColor: fastQue.pink, backgroundColor: 'rgba(242,41,125,0.16)' },
  chipDisabled: { opacity: 0.4 },
  chipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: fastQue.textSecondary },
  chipTextSelected: { color: fastQue.text },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  toggleText: { flex: 1 },
  toggleLabel: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.text },
  pill: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: space[2], borderRadius: radius.pill, borderWidth: 1 },
  pillText: { fontFamily: font.bodySemiBold, fontSize: 11 },
});
