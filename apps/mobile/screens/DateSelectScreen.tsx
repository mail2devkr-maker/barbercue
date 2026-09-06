import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  addZonedCalendarDays,
  formatZonedCalendarDate,
  zonedDateKey,
  zonedDateToDayOfWeek,
} from '@barbercue/shared';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader } from '../components/ui';
import { dateLocaleFor } from '../lib/date-locale';
import { useLanguage } from '../lib/language-context';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'DateSelect'>;

const DAYS_AHEAD = 30;

export default function DateSelectScreen({ route, navigation }: Props) {
  const { t, language } = useLanguage();
  const { operatingHours, salonTimezone, ...rest } = route.params;

  // Client-side convenience only (which days to grey out), same as apps/web's DateStep — the
  // server's availability endpoint is the sole authority on what's actually bookable. The date
  // STRING itself, though, is authoritative input to that endpoint (interpreted in the salon's own
  // zone server-side), so unlike the "cosmetic" closed flag, the salon-local calendar date here
  // isn't optional — this must never be the device's own "today"/day-of-week.
  const days = useMemo(() => {
    const result: { date: string; label: string; closed: boolean }[] = [];
    const locale = dateLocaleFor(language);
    const today = zonedDateKey(new Date().toISOString(), salonTimezone);
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const date = addZonedCalendarDays(today, i);
      const hours = operatingHours.find((h) => h.dayOfWeek === zonedDateToDayOfWeek(date));
      result.push({
        date,
        label: formatZonedCalendarDate(date, locale, { weekday: 'short', month: 'short', day: 'numeric' }),
        closed: !hours || hours.isClosed,
      });
    }
    return result;
  }, [operatingHours, salonTimezone, language]);

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader eyebrow={t.bookingTitle} title={t.chooseADateTitle} />
      <FlatList
        data={days}
        keyExtractor={(item) => item.date}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, item.closed && styles.cardDisabled]}
            disabled={item.closed}
            onPress={() => navigation.navigate('SlotSelect', { ...rest, salonTimezone, date: item.date })}
          >
            <Text style={styles.cardTitle}>{item.label}</Text>
            {item.closed && <Text style={styles.cardSubtitle}>{t.slotsClosedLabel}</Text>}
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  listContent: { paddingTop: space[2] },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space[4],
    marginBottom: space[3],
  },
  cardDisabled: { opacity: 0.45 },
  cardTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: color.ink },
  cardSubtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[1] },
});
