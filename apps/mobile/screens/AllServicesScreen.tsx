import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import {
  CUSTOMER_SERVICE_CATEGORIES,
  filterCustomerServices,
  type CustomerServiceCategory,
  type CustomerServiceEntry,
} from '@barbercue/shared';
import { useLanguage } from '../lib/language-context';
import { editorialPhotoUrl } from '../lib/editorial';
import { fastQue, font, fontSize, radius, space } from '../lib/theme';
import { EmptyState, PremiumTextField, SafeImage } from '../components/ui';
import type { HomeStackParamList, TabParamList } from '../navigation/types';

type Props = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, 'AllServices'>,
  BottomTabScreenProps<TabParamList>
>;

type Row =
  | { kind: 'category'; key: string; category: CustomerServiceCategory }
  | { kind: 'cards'; key: string; items: CustomerServiceEntry[] };

const COLUMNS = 2;
const GAP = space[3];

/** Groups the visible categories into FlatList rows: a banner per category, then two cards per row. */
export function buildRows(categories: readonly CustomerServiceCategory[]): Row[] {
  const rows: Row[] = [];
  for (const category of categories) {
    rows.push({ kind: 'category', key: `category:${category.id}`, category });
    for (let i = 0; i < category.services.length; i += COLUMNS) {
      const items = category.services.slice(i, i + COLUMNS);
      rows.push({ kind: 'cards', key: `cards:${category.id}:${items[0].id}`, items });
    }
  }
  return rows;
}

/**
 * The customer-facing catalogue of every service FastQue supports, with photographs, grouped by
 * category. It is browsing, not availability: a card opens the normal shop search for that service
 * (keeping the customer's chosen city / current location), which is where real availability — and an
 * honest "no shops offer this here yet" — lives. No prices are shown: the catalogue has no reliable
 * customer-facing price.
 */
export default function AllServicesScreen({ navigation }: Props) {
  const { t } = useLanguage();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const cardWidth = Math.floor((width - space[5] * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  const visibleCategories = useMemo(() => {
    const base = categoryId ? CUSTOMER_SERVICE_CATEGORIES.filter((c) => c.id === categoryId) : CUSTOMER_SERVICE_CATEGORIES;
    return filterCustomerServices(base, filter);
  }, [categoryId, filter]);
  const rows = useMemo(() => buildRows(visibleCategories), [visibleCategories]);

  function openService(entry: CustomerServiceEntry) {
    // The chosen city / current location lives in the shared location context, so Search simply
    // picks it up; only the service keyword travels with the navigation.
    navigation.navigate('SearchTab', { screen: 'SalonSearch', params: { initialQuery: entry.query, searchNonce: Date.now() } });
  }

  const header = (
    <View>
      <Text style={styles.note}>{t.allServicesNote}</Text>
      <PremiumTextField
        testID="all-services-filter"
        placeholder={t.allServicesSearchPlaceholder}
        placeholderTextColor={fastQue.textMuted}
        value={filter}
        onChangeText={setFilter}
        autoCorrect={false}
        accessibilityLabel={t.allServicesSearchPlaceholder}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        <Chip testID="category-chip-all" label={t.allServicesAllCategories} selected={categoryId === null} onPress={() => setCategoryId(null)} />
        {CUSTOMER_SERVICE_CATEGORIES.map((category) => (
          <Chip
            key={category.id}
            testID={`category-chip-${category.id}`}
            label={category.label}
            selected={categoryId === category.id}
            onPress={() => setCategoryId(categoryId === category.id ? null : category.id)}
          />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        testID="all-services-list"
        data={rows}
        keyExtractor={(row) => row.key}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={6}
        windowSize={7}
        ListEmptyComponent={<EmptyState title={t.allServicesNoMatch} message="" />}
        renderItem={({ item }) =>
          item.kind === 'category' ? (
            <View style={styles.categoryBanner} accessibilityRole="header">
              <SafeImage url={editorialPhotoUrl(item.category.photoPath)} alt={item.category.label} style={styles.categoryImage} />
              <View style={styles.categoryScrim} />
              <Text style={styles.categoryLabel}>{item.category.label}</Text>
            </View>
          ) : (
            <View style={styles.cardRow}>
              {item.items.map((entry) => (
                <Pressable
                  key={entry.id}
                  testID={`service-card-${entry.id}`}
                  onPress={() => openService(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={t.allServicesFindShopsFor.replace('{service}', entry.name)}
                  style={({ pressed }) => [styles.card, { width: cardWidth }, pressed && styles.cardPressed]}
                >
                  <SafeImage url={editorialPhotoUrl(entry.photoPath)} alt={entry.name} style={[styles.cardImage, { width: cardWidth }]} />
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {entry.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )
        }
      />
    </View>
  );
}

function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: fastQue.background },
  content: { padding: space[5], paddingBottom: space[8] },
  note: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textSecondary, marginBottom: space[3] },
  chips: { gap: space[2], paddingVertical: space[3] },
  chip: {
    paddingHorizontal: space[4],
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: fastQue.border,
    backgroundColor: fastQue.card,
  },
  chipSelected: { borderColor: fastQue.pink, backgroundColor: 'rgba(242,10,131,0.14)' },
  chipText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.textSecondary },
  chipTextSelected: { color: fastQue.pink },
  categoryBanner: { height: 96, borderRadius: radius.lg, overflow: 'hidden', marginTop: space[5], marginBottom: space[3], justifyContent: 'flex-end' },
  categoryImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  categoryScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(9,9,12,0.45)' },
  categoryLabel: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, color: '#fff', padding: space[3] },
  cardRow: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
  card: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: fastQue.card, borderWidth: 1, borderColor: fastQue.border },
  cardPressed: { opacity: 0.8 },
  cardImage: { height: 104 },
  cardTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.text, paddingHorizontal: space[3], paddingVertical: space[2], minHeight: 44 },
});
