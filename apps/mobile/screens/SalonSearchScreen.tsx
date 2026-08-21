import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DISCOVERY_PATHS } from '@barbercue/shared';
import type { PaginatedResult, SalonListItemDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SalonSearch'>;

// Public discovery endpoint — no auth required, mirrors apps/web's search page.
export default function SalonSearchScreen({ navigation, route }: Props) {
  const selectedStyleName = route.params?.selectedStyleName;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SalonListItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSearch() {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      const result = await apiFetch<PaginatedResult<SalonListItemDto>>(
        `${DISCOVERY_PATHS.salons}?${params.toString()}`,
      );
      setResults(result.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not search salons.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Find a salon</Text>
      {selectedStyleName && (
        <Text style={styles.subtitle}>
          Booking for the <Text style={{ fontWeight: '700' }}>{selectedStyleName}</Text> look — pick a shop to continue.
        </Text>
      )}
      <TextInput
        style={styles.input}
        placeholder="Search by name..."
        placeholderTextColor="#B8AFA0"
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() => void handleSearch()}
        returnKeyType="search"
      />
      <Pressable style={styles.button} onPress={() => void handleSearch()} disabled={loading}>
        {loading ? <ActivityIndicator color="#EDE6DA" /> : <Text style={styles.buttonText}>Search</Text>}
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}
      {searched && !loading && !error && results.length === 0 && (
        <Text style={styles.empty}>No salons found.</Text>
      )}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: 16 }}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() =>
              navigation.navigate('SalonProfile', { citySlug: item.citySlug, salonSlug: item.slug, selectedStyleName })
            }
          >
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.cardSubtitle}>{item.addressLine}</Text>
            {item.ratingCount > 0 && (
              <Text style={styles.cardMeta}>
                ★ {item.ratingAverage?.toFixed(1)} ({item.ratingCount})
              </Text>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', padding: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#EDE6DA', marginBottom: 16 },
  subtitle: { fontSize: 14, color: '#B8AFA0', marginTop: -8, marginBottom: 16 },
  input: {
    backgroundColor: '#2A2723',
    color: '#EDE6DA',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  button: { backgroundColor: '#B0413E', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#EDE6DA', fontSize: 15, fontWeight: '600' },
  error: { color: '#E24B4A', fontSize: 13, marginTop: 12 },
  empty: { color: '#B8AFA0', fontSize: 14, marginTop: 16 },
  card: { backgroundColor: '#2A2723', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { color: '#EDE6DA', fontSize: 16, fontWeight: '600' },
  cardSubtitle: { color: '#B8AFA0', fontSize: 13, marginTop: 4 },
  cardMeta: { color: '#B8AFA0', fontSize: 13, marginTop: 4 },
});
