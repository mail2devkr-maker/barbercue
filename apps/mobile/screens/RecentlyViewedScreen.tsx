import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Language, RECENTLY_VIEWED_PATHS, formatMoney, type RecentSalonDto } from '@barbercue/shared';
import { apiFetch } from '../lib/api';
import { useLanguage } from '../lib/language-context';
import { lastViewedLabel, salonProfileParams } from '../lib/customer-dashboard';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Button, EmptyState, InlineError, SafeImage, Screen, SectionHeader, Skeleton } from '../components/ui';
import type { AccountStackParamList, TabParamList } from '../navigation/types';

type Nav = CompositeNavigationProp<NativeStackNavigationProp<AccountStackParamList, 'RecentlyViewed'>, BottomTabNavigationProp<TabParamList>>;

/** Recently viewed salons (website parity: /account/discover?tab=recent). Remove one or clear all. */
export default function RecentlyViewedScreen() {
  const navigation = useNavigation<Nav>();
  const { language } = useLanguage();
  const hi = language === Language.HI;
  const [items, setItems] = useState<RecentSalonDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await apiFetch<RecentSalonDto[]>(RECENTLY_VIEWED_PATHS.recentlyViewed));
      setError(null);
    } catch {
      setError(hi ? 'हाल में देखे गए सैलून अभी लोड नहीं हो सके।' : "Couldn't load your recently viewed salons.");
    } finally {
      setRefreshing(false);
    }
  }, [hi]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function remove(salon: RecentSalonDto) {
    const before = items;
    setItems((cur) => (cur ? cur.filter((s) => s.id !== salon.id) : cur));
    try {
      await apiFetch(`${RECENTLY_VIEWED_PATHS.recentlyViewed}/${salon.id}`, { method: 'DELETE' });
    } catch {
      setItems(before);
      setError(hi ? 'वह सैलून हटाया नहीं जा सका। दोबारा कोशिश करें।' : "Couldn't remove that salon. Try again.");
    }
  }

  function clearAll() {
    Alert.alert(
      hi ? 'सारा इतिहास हटाएँ?' : 'Clear all?',
      hi ? 'आपके हाल में देखे सैलून की सूची खाली हो जाएगी।' : 'Your recently viewed list will be emptied.',
      [
        { text: hi ? 'रद्द करें' : 'Cancel', style: 'cancel' },
        {
          text: hi ? 'हटाएँ' : 'Clear',
          style: 'destructive',
          onPress: () => {
            const before = items;
            setItems([]);
            apiFetch(RECENTLY_VIEWED_PATHS.recentlyViewed, { method: 'DELETE' }).catch(() => {
              setItems(before);
              setError(hi ? 'इतिहास हटाया नहीं जा सका।' : "Couldn't clear your history.");
            });
          },
        },
      ],
    );
  }

  function open(salon: RecentSalonDto) {
    navigation.navigate('SearchTab', { screen: 'SalonProfile', params: salonProfileParams(salon), initial: false });
  }

  return (
    <Screen scroll={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={color.accent} colors={[color.accent]} />}
      >
        <SectionHeader eyebrow={hi ? 'डैशबोर्ड' : 'DASHBOARD'} title={hi ? 'हाल में देखे गए' : 'Recently viewed'} />
        {error && <InlineError message={error} />}
        {items === null && !error && (<><Skeleton style={styles.skeleton} /><Skeleton style={styles.skeleton} /></>)}
        {items && items.length === 0 && (
          <EmptyState
            title={hi ? 'अभी कुछ नहीं' : 'Nothing here yet'}
            message={hi ? 'जो सैलून आप देखेंगे वे यहाँ दिखेंगे।' : 'Salons you look at will show up here.'}
          />
        )}
        {items && items.length > 0 && (
          <>
            {items.map((salon) => (
              <View key={salon.id} style={styles.row}>
                <Pressable style={styles.main} onPress={() => open(salon)} accessibilityRole="button" accessibilityLabel={salon.name}>
                  <SafeImage url={salon.coverPhotoUrl} alt={salon.name} style={styles.thumb} />
                  <View style={styles.body}>
                    <Text style={styles.name} numberOfLines={1}>{salon.name}</Text>
                    <Text style={styles.meta} numberOfLines={1}>{salon.addressLine}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {[
                        salon.ratingAverage !== null ? `★ ${salon.ratingAverage.toFixed(1)}` : null,
                        salon.priceMin !== null ? `${hi ? 'से' : 'From'} ${formatMoney(salon.priceMin, salon.currency, salon.countryCode)}` : null,
                        lastViewedLabel(salon.viewedAt, language),
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => void remove(salon)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${hi ? 'हटाएँ' : 'Remove'} ${salon.name}`} style={styles.remove}>
                  <Text style={styles.removeText}>✕</Text>
                </Pressable>
              </View>
            ))}
            <Button title={hi ? 'सब हटाएँ' : 'Clear all'} variant="outline" onPress={clearAll} style={styles.clear} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 84, borderRadius: radius.md, marginBottom: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, marginBottom: space[3], paddingRight: space[2] },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: space[3], gap: space[3] },
  thumb: { width: 64, height: 64, borderRadius: radius.sm },
  body: { flex: 1 },
  name: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: color.ink },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginTop: 2 },
  remove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontFamily: font.bodyBold, fontSize: fontSize.base, color: color.muted },
  clear: { marginTop: space[2], marginBottom: space[6] },
});
