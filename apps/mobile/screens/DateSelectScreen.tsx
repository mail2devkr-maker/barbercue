import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader } from '../components/ui';
import { useLanguage } from '../lib/language-context';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'DateSelect'>;

const DAYS_AHEAD = 30;

export default function DateSelectScreen({ route, navigation }: Props) {
  const { t } = useLanguage();
  const { operatingHours, ...rest } = route.params;

  // Client-side convenience only, same as apps/web's DateStep — the server's availability
  // endpoint is the sole authority on what's actually bookable.
  const days = useMemo(() => {
    const result: { date: string; label: string; closed: boolean }[] = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const hours = operatingHours.find((h) => h.dayOfWeek === d.getDay());
      result.push({
        date: iso,
        label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
        closed: !hours || hours.isClosed,
      });
    }
    return result;
  }, [operatingHours]);

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
            onPress={() => navigation.navigate('SlotSelect', { ...rest, date: item.date })}
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
