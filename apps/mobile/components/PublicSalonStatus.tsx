import { StyleSheet, Text, View } from 'react-native';
import type { PublicSalonStatusDto } from '@barbercue/shared';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { useLanguage } from '../lib/language-context';

export function PublicSalonStatus({ status }: { status: PublicSalonStatusDto }) {
  const { t } = useLanguage();
  return (
    <View style={styles.card} accessibilityLabel={t.liveShopSnapshotLabel}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>{t.liveShopSnapshotEyebrow}</Text>
          <Text style={styles.title}>{t.aChairWhenReady}</Text>
        </View>
        <Text style={styles.chairCount}>{status.activeChairCount} {t.activeChairsSuffix}</Text>
      </View>
      {status.professionals.length > 0 ? status.professionals.map((professional) => (
        <View style={styles.professional} key={professional.displayName}>
          <View style={styles.dot} />
          <Text style={styles.name} numberOfLines={1}>{professional.displayName}</Text>
          <Text style={styles.queueCount}>{professional.activeQueueCount} {t.waitingCountSuffix}</Text>
        </View>
      )) : <Text style={styles.empty}>{t.professionalAvailabilityHint}</Text>}
      <Text style={styles.note}>{t.aggregateCountsNote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.surfaceTint, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space[4], marginBottom: space[4] },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3] },
  headingCopy: { flex: 1 },
  eyebrow: { fontFamily: font.bodyBold, fontSize: fontSize.xs, letterSpacing: 1.2, color: color.accent, marginBottom: space[1] },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, lineHeight: 25, color: color.ink },
  chairCount: { color: color.ink, borderWidth: 1, borderColor: color.gold, borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: space[1], fontFamily: font.bodySemiBold, fontSize: fontSize.xs },
  professional: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderBottomWidth: 1, borderBottomColor: color.border, paddingVertical: space[3], marginTop: space[2] },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.accent },
  name: { flex: 1, color: color.ink, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  queueCount: { color: color.muted, fontFamily: font.bodyRegular, fontSize: fontSize.xs },
  empty: { color: color.muted, fontFamily: font.bodyRegular, fontSize: fontSize.xs, marginTop: space[3] },
  note: { color: color.muted, fontFamily: font.bodyRegular, fontSize: fontSize.xs, marginTop: space[3] },
});
