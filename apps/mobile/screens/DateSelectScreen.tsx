import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'DateSelect'>;

const DAYS_AHEAD = 30;

export default function DateSelectScreen({ route, navigation }: Props) {
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
    <View style={styles.container}>
      <Text style={styles.title}>Choose a date</Text>
      <FlatList
        data={days}
        keyExtractor={(item) => item.date}
        contentContainerStyle={{ paddingTop: 16 }}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, item.closed && styles.cardDisabled]}
            disabled={item.closed}
            onPress={() => navigation.navigate('SlotSelect', { ...rest, date: item.date })}
          >
            <Text style={styles.cardTitle}>{item.label}</Text>
            {item.closed && <Text style={styles.cardSubtitle}>Closed</Text>}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', color: '#EDE6DA' },
  card: { backgroundColor: '#2A2723', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardDisabled: { opacity: 0.4 },
  cardTitle: { color: '#EDE6DA', fontSize: 16, fontWeight: '600' },
  cardSubtitle: { color: '#B8AFA0', fontSize: 13, marginTop: 4 },
});
