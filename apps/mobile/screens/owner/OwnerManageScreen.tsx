import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { SalonStatus } from '@barbercue/shared';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { OWNER_SECTIONS, type OwnerSection } from '../../lib/owner/owner-sections';
import { statusLabel } from '../../lib/owner/settings';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';
import { EmptyState, PremiumCard, PremiumScreen, PremiumSectionHeader } from '../../components/ui';
import { SalonSwitcher } from '../../components/owner/SalonSwitcher';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';
import type { OwnerTabParamList } from '../../navigation/OwnerNavigator';

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<OwnerShopStackParamList, 'OwnerShop'>,
  BottomTabNavigationProp<OwnerTabParamList>
>;

/**
 * The owner's management hub: every shop-management section the website offers, as large native
 * cards, for the currently selected shop. It owns no data of its own — each card opens the screen
 * (or the existing tab) that does — so there is nothing here that can disagree with those screens.
 */
export default function OwnerManageScreen() {
  const navigation = useNavigation<Nav>();
  const { workplaces, selectedSalon } = useSalon();
  const { t } = useLanguage();

  if (workplaces.length === 0) {
    return (
      <PremiumScreen scroll={false}>
        <EmptyState title={t.noShopsYetTitle} message={t.registerShopHint} />
      </PremiumScreen>
    );
  }

  function open(section: OwnerSection) {
    if (section.target.kind === 'tab') {
      navigation.navigate(section.target.tab);
    } else {
      // Every target screen is a parameterless route of this same stack (checked by the registry's
      // own type), so a single untyped-by-union call is safe here.
      navigation.navigate({ name: section.target.screen, params: undefined } as never);
    }
  }

  return (
    <PremiumScreen>
      <PremiumSectionHeader eyebrow={t.ownerEyebrow} title={t.ownerManageTitle} subtitle={t.ownerManageSubtitle} />
      <SalonSwitcher />
      {selectedSalon ? (
        <PremiumCard strong style={styles.shopCard} testID="manage-shop-card">
          <Text style={styles.shopName} numberOfLines={2}>
            {selectedSalon.name}
          </Text>
          <Text style={[styles.shopStatus, selectedSalon.status === SalonStatus.ACTIVE && !selectedSalon.isClosedForToday && styles.shopStatusOpen]}>
            {statusLabel(selectedSalon.status, Boolean(selectedSalon.isClosedForToday), t)}
          </Text>
        </PremiumCard>
      ) : null}

      <View style={styles.grid}>
        {OWNER_SECTIONS.map((section) => (
          <Pressable
            key={section.id}
            testID={`manage-section-${section.id}`}
            onPress={() => open(section)}
            accessibilityRole="button"
            accessibilityLabel={`${t[section.labelKey]}. ${t[section.hintKey]}`}
            style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
          >
            <Text style={styles.tileTitle}>{t[section.labelKey]}</Text>
            <Text style={styles.tileHint} numberOfLines={3}>
              {t[section.hintKey]}
            </Text>
          </Pressable>
        ))}
      </View>
    </PremiumScreen>
  );
}

const styles = StyleSheet.create({
  shopCard: { marginBottom: space[4], gap: space[1] },
  shopName: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, color: fastQue.text },
  shopStatus: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.orange },
  shopStatusOpen: { color: '#4CC38A' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  tile: {
    width: '47.5%',
    flexGrow: 1,
    minHeight: 104,
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: fastQue.border,
    backgroundColor: fastQue.card,
    justifyContent: 'space-between',
  },
  pressed: { opacity: 0.8 },
  tileTitle: { fontFamily: font.bodyBold, fontSize: fontSize.base, color: fastQue.text },
  tileHint: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, marginTop: space[1] },
});
