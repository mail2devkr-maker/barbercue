import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text, View } from 'react-native';
import { SALON_QUEUE_PATHS, type QueueStatusDto } from '@barbercue/shared';
import { apiFetch } from '../lib/api';
import { font, fontSize, radius, space } from '../lib/theme';
import { useLanguage } from '../lib/language-context';
import { useThemedStyles, type ThemeTokens } from '../lib/theme-mode';

const REFRESH_MS = 30_000;

/** "No wait" / "~15 min" / "10–20 min" from the public queue status estimate. */
export function waitLabel(status: Pick<QueueStatusDto, 'estimatedWaitMinutes' | 'estimatedWaitRangeMinutes'>, hi: boolean): string {
  const min = status.estimatedWaitMinutes;
  if (min === null) return hi ? 'अनुमान उपलब्ध नहीं' : 'Not available';
  if (min <= 0) return hi ? 'कोई इंतज़ार नहीं' : 'No wait';
  const r = status.estimatedWaitRangeMinutes;
  if (r && r.max > r.min) return `${r.min}–${r.max} ${hi ? 'मिनट' : 'min'}`;
  return `~${min} ${hi ? 'मिनट' : 'min'}`;
}

/**
 * Live queue at the top of a salon page: who is in a chair now, how many are waiting and the wait
 * if you join now. Public, no customer details. Refreshes every 30 s while the screen is focused.
 */
export function LiveQueueCard({ salonId }: { salonId: string }) {
  const styles = useThemedStyles(makeStyles);
  const { language } = useLanguage();
  const hi = language === 'HI';
  const [status, setStatus] = useState<QueueStatusDto | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const load = () =>
        apiFetch<QueueStatusDto>(`salons/${salonId}/queue/${SALON_QUEUE_PATHS.status}`)
          .then((s) => {
            if (!alive) return;
            setStatus(s);
            setUpdatedAt(new Date());
          })
          .catch(() => undefined);
      void load();
      const id = setInterval(load, REFRESH_MS);
      return () => {
        alive = false;
        clearInterval(id);
      };
    }, [salonId]),
  );

  if (!status) return null;
  const serving = status.nowServingTokens ?? [];
  const time = updatedAt
    ? `${String(updatedAt.getHours()).padStart(2, '0')}:${String(updatedAt.getMinutes()).padStart(2, '0')}`
    : '';

  return (
    <View style={styles.card} accessibilityLabel={hi ? 'लाइव कतार' : 'Live queue'}>
      <View style={styles.eyebrowRow}>
        <View style={styles.liveDot} />
        <Text style={styles.eyebrow}>{hi ? 'लाइव कतार' : 'LIVE QUEUE'}</Text>
      </View>
      <View style={styles.row}>
        <View style={styles.cell}>
          <Text style={styles.label}>{hi ? 'अभी सेवा में' : 'Now serving'}</Text>
          <Text style={styles.big}>{serving.length > 0 ? serving.map((n) => `#${n}`).join(', ') : '—'}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.cell}>
          <Text style={styles.label}>{hi ? 'इंतज़ार में लोग' : 'People waiting'}</Text>
          <Text style={styles.big}>{status.waitingCount}</Text>
        </View>
      </View>
      <View style={styles.waitRow}>
        <Text style={styles.waitLabel}>{hi ? 'अभी जुड़ें तो अनुमानित इंतज़ार' : 'Estimated wait if you join now'}</Text>
        <Text style={styles.waitValue}>{waitLabel(status, hi)}</Text>
      </View>
      {time !== '' && (
        <Text style={styles.updated}>
          {hi ? `अपडेट ${time} · अपने आप रीफ़्रेश होता है` : `Updated ${time} · refreshes automatically`}
        </Text>
      )}
    </View>
  );
}

const makeStyles = ({ color }: ThemeTokens) =>
  StyleSheet.create({
    card: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space[4], marginBottom: space[4] },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[3] },
    liveDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.success },
    eyebrow: { fontFamily: font.bodyBold, fontSize: fontSize.xs, letterSpacing: 1.4, color: color.muted },
    row: { flexDirection: 'row', alignItems: 'stretch' },
    cell: { flex: 1 },
    divider: { width: 1, backgroundColor: color.border, marginHorizontal: space[3] },
    label: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginBottom: space[1] },
    big: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, color: color.ink },
    waitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], marginTop: space[4], backgroundColor: color.surfaceTint, borderRadius: radius.md, paddingVertical: space[3], paddingHorizontal: space[3] },
    waitLabel: { flex: 1, fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.ink },
    waitValue: { fontFamily: font.bodyBold, fontSize: fontSize.sm, color: color.accent },
    updated: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[3] },
  });
