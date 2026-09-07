import { useState } from 'react';
import {
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../lib/language-context';
import { resolveHomeLocation } from '../lib/home-location';
import { stashPendingShopRegistrationIntent } from '../lib/shop-registration-intent';
import { color, font, lineHeightFor, radius, space } from '../lib/theme';
import { BrandLockup, GradientView, LanguageSwitcher, SafeImage } from '../components/ui';
import { TabIcon } from '../components/ui/TabIcon';
import { EDITORIAL_ASSET_URL } from '../lib/editorial';
import type { AuthStackParamList } from '../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'RoleSelect'>;

const GRADIENT_COLORS = [color.brandGradientStart, color.brandGradientEnd] as const;
const HERO_HEIGHT = 336;

const POPULAR_SERVICE_CATEGORIES = [
  { key: 'categoryHaircut', value: 'Haircut', imageUrl: EDITORIAL_ASSET_URL.categoryHaircut },
  { key: 'categoryBeardTrim', value: 'Beard Trim', imageUrl: EDITORIAL_ASSET_URL.categoryBeardTrim },
  { key: 'categoryFade', value: 'Fade', imageUrl: EDITORIAL_ASSET_URL.categoryFade },
  { key: 'categoryShave', value: 'Shave', imageUrl: EDITORIAL_ASSET_URL.categoryShave },
  { key: 'categoryNails', value: 'Nails', imageUrl: EDITORIAL_ASSET_URL.categoryNails },
  { key: 'categorySpa', value: 'Spa', imageUrl: EDITORIAL_ASSET_URL.categorySpa },
] as const;

/**
 * Signed-out FastQue landing page.
 *
 * The customer must see the same premium marketplace experience before authentication that they
 * see after authentication: discovery first, login only when an authenticated action is needed.
 * Owner/staff entry stays available from the hamburger menu rather than taking over the first
 * screen with a role chooser.
 */
export default function RoleSelectScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { t, language } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<'barber' | 'salon'>('barber');
  const [query, setQuery] = useState('');
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const savedLabel = language === 'HI' ? 'सहेजे गए' : 'Saved';
  const profileLabel = language === 'HI' ? 'प्रोफ़ाइल' : 'Profile';
  // Keep labels readable rather than clipping a long phrase inside half a segmented control on
  // very narrow Android handsets. The full approved labels resume as soon as they fit.
  const compactCopy = windowWidth < 420;
  const compactHeader = windowWidth < 365;
  const barberModeLabel = compactCopy ? (language === 'HI' ? 'बार्बर' : 'Find barber') : t.searchModeBarber;
  const salonModeLabel = compactCopy ? (language === 'HI' ? 'सैलून' : 'Salon & more') : t.searchModeSalon;
  const searchPlaceholder = compactCopy
    ? language === 'HI'
      ? 'हेयरकट, फेड, बियर्ड…'
      : 'Haircut, fade, beard…'
    : t.shopOrServiceExample;

  async function handleChooseLocation() {
    setLocating(true);
    try {
      const result = await resolveHomeLocation(true);
      if (result) {
        setLocationLabel(result.label);
        setLocationCoords(result.coords);
      }
    } finally {
      setLocating(false);
    }
  }

  function goSearch(initialQuery?: string) {
    navigation.navigate('GuestBrowse', {
      screen: 'SalonSearch',
      params: {
        ...(initialQuery ? { initialQuery } : {}),
        ...(locationCoords ? { initialLat: locationCoords.lat, initialLng: locationCoords.lng } : {}),
      },
    });
  }

  function handleFindPress() {
    goSearch(query.trim() || undefined);
  }

  function choose(role: 'CUSTOMER' | 'OWNER' | 'STAFF') {
    setMenuOpen(false);
    if (role === 'CUSTOMER') {
      navigation.navigate('CustomerLogin');
    } else {
      navigation.navigate('OwnerStaffLogin', { role });
    }
  }

  // Mobile Shop Owner Onboarding mission — there is no standalone "create an owner account"
  // endpoint (POST salons grants SALON_OWNER to an already-authenticated user; see
  // RegisterSalonResponseDto's doc comment), so this routes through the same customer sign-in
  // every other visitor uses and replays the registration intent once it completes (see
  // shop-registration-intent.ts / RootNavigator's ShopRegistrationHandoffBridge).
  function registerShop() {
    setMenuOpen(false);
    stashPendingShopRegistrationIntent();
    navigation.navigate('CustomerLogin');
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, compactHeader && styles.headerCompact, { paddingTop: insets.top + 8 }]}>
        <BrandLockup compact={compactHeader} markOnly={compactHeader} style={styles.brandLockup} />

        <View style={styles.headerActions}>
          <Pressable style={[styles.locationPill, compactHeader && styles.locationPillCompact]} onPress={handleChooseLocation} disabled={locating}>
            <View style={styles.locationPin} />
            <Text style={styles.locationText} numberOfLines={1}>
              {locating ? t.detectingLocationAction : locationLabel ?? t.chooseLocationAction}
            </Text>
          </Pressable>
          <Pressable
            style={styles.menuButton}
            onPress={() => setMenuOpen((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel="Menu"
          >
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
          </Pressable>
        </View>
      </View>

      {menuOpen && (
        <View style={[styles.menuPanel, { top: insets.top + 62 }]}>
          <View style={styles.menuLanguageRow}>
            <LanguageSwitcher compact />
          </View>
          <Pressable style={styles.menuItem} onPress={() => choose('CUSTOMER')}>
            <Text style={styles.menuItemTitle}>{t.roleCustomer}</Text>
            <Text style={styles.menuItemSubtitle}>{t.roleCustomerSubtitle}</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => choose('OWNER')}>
            <Text style={styles.menuItemTitle}>{t.roleOwner}</Text>
            <Text style={styles.menuItemSubtitle}>{t.roleOwnerSubtitle}</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => choose('STAFF')}>
            <Text style={styles.menuItemTitle}>{t.roleStaff}</Text>
            <Text style={styles.menuItemSubtitle}>{t.roleStaffSubtitle}</Text>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={registerShop}>
            <Text style={styles.menuItemTitle}>{t.registerShopCta}</Text>
            <Text style={styles.menuItemSubtitle}>{t.listYourShopCta}</Text>
          </Pressable>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 88 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        <ImageBackground
          source={{ uri: EDITORIAL_ASSET_URL.heroBand }}
          style={styles.hero}
          imageStyle={styles.heroImage}
        >
          <View style={[StyleSheet.absoluteFill, styles.heroBaseScrim]} />
          <GradientView
            colors={['transparent', 'rgba(8, 12, 40, 0.96)']}
            direction="vertical"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroContent}>
            <Text style={styles.heroEyebrow}>{t.homeHeroEyebrow}</Text>
            <Text style={styles.heroHeadline}>
              {t.homeHeroHeadlineLine1}
              {'\n'}
              <Text style={styles.heroHeadlineAccent}>{t.homeHeroHeadlineLine2}</Text>
            </Text>
            <Text style={styles.heroSubcopy}>{t.homeHeroSubcopy}</Text>
            <View style={styles.benefitRow}>
              <View style={styles.benefitItem}>
                <View style={[styles.benefitIconWrap, styles.benefitPurple]}>
                  <TabIcon name="bookings" color={color.surface} size={15} />
                </View>
                <Text style={styles.benefitLabel}>{t.bookAheadKicker}</Text>
              </View>
              <View style={styles.benefitItem}>
                <View style={[styles.benefitIconWrap, styles.benefitBlue]}>
                  <TabIcon name="queue" color={color.surface} size={15} />
                </View>
                <Text style={styles.benefitLabel}>{t.joinLiveKicker}</Text>
              </View>
              <View style={styles.benefitItem}>
                <View style={[styles.benefitIconWrap, styles.benefitGold]}>
                  <TabIcon name="offer" color={color.surface} size={15} />
                </View>
                <Text style={styles.benefitLabel}>{t.trustOffersLabel}</Text>
              </View>
            </View>
          </View>
        </ImageBackground>

        <View style={styles.searchCard}>
          <View style={styles.segmentRow}>
            <Pressable
              style={styles.segmentPressable}
              onPress={() => setSearchMode('barber')}
              accessibilityRole="button"
              accessibilityState={{ selected: searchMode === 'barber' }}
            >
              {searchMode === 'barber' ? (
                <GradientView colors={GRADIENT_COLORS} style={[styles.segment, compactCopy && styles.segmentCompact]}>
                  <TabIcon name="scissors" color={color.surface} size={compactCopy ? 14 : 16} />
                  <Text style={[styles.segmentText, styles.segmentTextActive]} numberOfLines={1}>
                    {barberModeLabel}
                  </Text>
                </GradientView>
              ) : (
                <View style={[styles.segment, compactCopy && styles.segmentCompact]}>
                  <TabIcon name="scissors" color={color.muted} size={compactCopy ? 14 : 16} />
                  <Text style={styles.segmentText} numberOfLines={1}>{barberModeLabel}</Text>
                </View>
              )}
            </Pressable>

            <Pressable
              style={styles.segmentPressable}
              onPress={() => setSearchMode('salon')}
              accessibilityRole="button"
              accessibilityState={{ selected: searchMode === 'salon' }}
            >
              {searchMode === 'salon' ? (
                <GradientView colors={GRADIENT_COLORS} style={[styles.segment, compactCopy && styles.segmentCompact]}>
                  <TabIcon name="salon" color={color.surface} size={compactCopy ? 14 : 16} />
                  <Text style={[styles.segmentText, styles.segmentTextActive]} numberOfLines={1}>
                    {salonModeLabel}
                  </Text>
                </GradientView>
              ) : (
                <View style={[styles.segment, compactCopy && styles.segmentCompact]}>
                  <TabIcon name="salon" color={color.muted} size={compactCopy ? 14 : 16} />
                  <Text style={styles.segmentText} numberOfLines={1}>{salonModeLabel}</Text>
                </View>
              )}
            </Pressable>
          </View>

          <View style={styles.inputRow}>
            <TabIcon name="search" color={color.ink} size={22} />
            <View style={styles.inputCopy}>
              <Text style={styles.fieldLabel}>{t.shopOrServiceLabel}</Text>
              <TextInput
                style={styles.searchInput}
                placeholder={searchPlaceholder}
                placeholderTextColor={color.muted}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={handleFindPress}
                returnKeyType="search"
              />
            </View>
          </View>

          <Pressable style={styles.inputRow} onPress={handleChooseLocation} disabled={locating}>
            <TabIcon name="shop" color={color.ink} size={22} />
            <View style={styles.inputCopy}>
              <Text style={styles.fieldLabel}>{t.cityLocationLabel}</Text>
              <Text style={locationLabel ? styles.cityValueText : styles.cityPlaceholderText} numberOfLines={1}>
                {locating ? t.detectingLocationAction : locationLabel ?? t.chooseLocationAction}
              </Text>
            </View>
            <Text style={styles.chevron}>⌄</Text>
          </Pressable>

          <Pressable onPress={handleFindPress} accessibilityRole="button">
            <GradientView colors={GRADIENT_COLORS} style={styles.ctaButton}>
              <Text style={styles.ctaButtonText}>
                {searchMode === 'barber' ? t.findABarberAction : t.findShopsAction} →
              </Text>
            </GradientView>
          </Pressable>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t.popularServicesTitle}</Text>
          <Pressable onPress={() => goSearch()}>
            <Text style={styles.viewAllText}>{t.viewAllAction} →</Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          {POPULAR_SERVICE_CATEGORIES.map((category) => (
            <Pressable key={category.key} style={styles.categoryChip} onPress={() => goSearch(category.value)}>
              <SafeImage url={category.imageUrl} alt={t[category.key]} style={styles.categoryThumb} />
              <Text style={styles.categoryLabel} numberOfLines={1}>{t[category.key]}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Pressable style={styles.queueBanner} onPress={() => goSearch()} accessibilityRole="button">
          <View style={styles.queueBannerText}>
            <Text style={styles.queueBannerHeadline}>{t.queuePromoHeadlineLine1}</Text>
            <Text style={[styles.queueBannerHeadline, styles.queueBannerHeadlineAccent]}>{t.queuePromoHeadlineLine2}</Text>
            <Text style={styles.queueBannerSubcopy}>{t.queuePromoSubcopy}</Text>
          </View>
          <View style={styles.queueClock}>
            <TabIcon name="queue" color={color.surface} size={28} />
          </View>
        </Pressable>

        <View style={styles.trustStrip}>
          <View style={styles.trustItem}>
            <TabIcon name="shop" color="#26C281" size={20} />
            <Text style={styles.trustLabel} numberOfLines={2}>{t.trustShopsLabel}</Text>
          </View>
          <View style={styles.trustItem}>
            <TabIcon name="account" color={color.brandCoral} size={20} />
            <Text style={styles.trustLabel} numberOfLines={2}>{t.trustExperienceLabel}</Text>
          </View>
          <View style={styles.trustItem}>
            <TabIcon name="today" color="#2D9CDB" size={20} />
            <Text style={styles.trustLabel} numberOfLines={2}>{t.trustRealTimeLabel}</Text>
          </View>
          <View style={styles.trustItem}>
            <TabIcon name="offer" color="#F2994A" size={20} />
            <Text style={styles.trustLabel} numberOfLines={2}>{t.trustOffersLabel}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <Pressable style={styles.bottomItem}>
          <TabIcon name="home" color={color.brandCoral} size={23} />
          <Text style={[styles.bottomLabel, styles.bottomLabelActive]}>{t.tabHome}</Text>
        </Pressable>
        <Pressable style={styles.bottomItem} onPress={() => goSearch()}>
          <TabIcon name="search" color={color.ink} size={23} />
          <Text style={styles.bottomLabel}>{t.tabSearch}</Text>
        </Pressable>
        <Pressable style={styles.bottomItem} onPress={() => choose('CUSTOMER')}>
          <TabIcon name="bookings" color={color.ink} size={23} />
          <Text style={styles.bottomLabel}>{t.tabBookings}</Text>
        </Pressable>
        <Pressable style={styles.bottomItem} onPress={() => choose('CUSTOMER')}>
          <TabIcon name="offer" color={color.ink} size={23} />
          <Text style={styles.bottomLabel}>{savedLabel}</Text>
        </Pressable>
        <Pressable style={styles.bottomItem} onPress={() => choose('CUSTOMER')}>
          <TabIcon name="account" color={color.ink} size={23} />
          <Text style={styles.bottomLabel}>{profileLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  scroll: { flex: 1 },

  header: {
    minHeight: 64,
    paddingHorizontal: space[4],
    paddingBottom: 9,
    backgroundColor: color.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
    zIndex: 20,
  },
  headerCompact: { paddingHorizontal: 12, paddingBottom: 7 },
  brandLockup: { flexShrink: 1, minWidth: 0 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 134,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    gap: 6,
  },
  locationPillCompact: { width: 116, minHeight: 34, paddingHorizontal: 8 },
  locationPin: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.brandCoral, flexShrink: 0 },
  locationText: { fontFamily: font.bodySemiBold, fontSize: 12, color: color.ink, flexShrink: 1 },
  menuButton: { width: 34, height: 36, alignItems: 'center', justifyContent: 'center', gap: 4 },
  menuLine: { width: 21, height: 2, borderRadius: 2, backgroundColor: color.ink },

  menuPanel: {
    position: 'absolute',
    right: space[4],
    width: 250,
    zIndex: 40,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: color.border,
    shadowColor: color.ink,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  menuLanguageRow: { alignItems: 'flex-end', paddingBottom: 8, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: color.border },
  menuItem: { paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10 },
  menuItemTitle: { fontFamily: font.bodyBold, fontSize: 14, color: color.ink },
  menuItemSubtitle: { fontFamily: font.bodyRegular, fontSize: 11, color: color.muted, marginTop: 2 },

  hero: { height: HERO_HEIGHT, justifyContent: 'flex-end', overflow: 'hidden' },
  heroImage: { resizeMode: 'cover' },
  heroBaseScrim: { backgroundColor: 'rgba(5, 8, 28, 0.52)' },
  heroContent: { paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: 62 },
  heroEyebrow: {
    fontFamily: font.bodyBold,
    fontSize: 10.5,
    lineHeight: lineHeightFor(10.5),
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.goldSoft,
    marginBottom: 8,
  },
  heroHeadline: { fontFamily: font.bodyBold, fontSize: 36, lineHeight: 39, color: color.surface, letterSpacing: -1.05 },
  heroHeadlineAccent: { color: color.brandGradientEnd },
  heroSubcopy: {
    fontFamily: font.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.88)',
    marginTop: 10,
    maxWidth: 310,
  },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 14 },
  benefitItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  benefitIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  benefitPurple: { backgroundColor: '#6C2BFF' },
  benefitBlue: { backgroundColor: '#2D9CDB' },
  benefitGold: { backgroundColor: '#D6A700' },
  benefitLabel: { fontFamily: font.bodyMedium, fontSize: 9.5, lineHeight: 12, color: color.surface, maxWidth: 52 },

  searchCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: space[4],
    marginTop: -44,
    borderRadius: 24,
    padding: 12,
    shadowColor: color.ink,
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  segmentRow: { flexDirection: 'row', backgroundColor: '#f5f5f8', borderRadius: radius.pill, padding: 3, marginBottom: 8, gap: 3 },
  segmentPressable: { flex: 1 },
  segment: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, borderRadius: radius.pill, paddingHorizontal: 7 },
  segmentCompact: { minHeight: 38, gap: 5, paddingHorizontal: 5 },
  segmentText: { fontFamily: font.bodySemiBold, fontSize: 12.5, color: color.ink },
  segmentTextActive: { color: color.surface },
  inputRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 13,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  inputCopy: { flex: 1, minWidth: 0 },
  fieldLabel: { fontFamily: font.bodyBold, fontSize: 11, color: color.ink, marginBottom: 1 },
  searchInput: { flex: 1, width: '100%', minWidth: 0, padding: 0, margin: 0, fontFamily: font.bodyRegular, fontSize: 13, color: color.ink },
  cityValueText: { fontFamily: font.bodyMedium, fontSize: 13.5, color: color.ink },
  cityPlaceholderText: { fontFamily: font.bodyRegular, fontSize: 13.5, color: color.muted },
  chevron: { fontFamily: font.bodyBold, fontSize: 22, color: color.ink, marginLeft: 4 },
  ctaButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, marginTop: 1 },
  ctaButtonText: { fontFamily: font.bodyBold, fontSize: 15, color: color.surface },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], marginTop: 26 },
  sectionTitle: { fontFamily: font.bodyBold, fontSize: 20, color: color.brandNavy },
  viewAllText: { fontFamily: font.bodySemiBold, fontSize: 12, color: color.brandCoral },
  categoryRow: { paddingHorizontal: space[5], gap: 12, marginTop: 12 },
  categoryChip: { width: 76, alignItems: 'center', gap: 6 },
  categoryThumb: { width: 64, height: 64, borderRadius: 15, backgroundColor: color.surfaceTint },
  categoryLabel: { fontFamily: font.bodyMedium, fontSize: 10.5, color: color.ink, textAlign: 'center' },

  queueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: space[5],
    marginTop: 24,
    backgroundColor: color.brandNavy,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  queueBannerText: { flexShrink: 1, gap: 1 },
  queueBannerHeadline: { fontFamily: font.bodyBold, fontSize: 18, lineHeight: 21, color: color.surface },
  queueBannerHeadlineAccent: { color: '#F2A93B' },
  queueBannerSubcopy: { fontFamily: font.bodyRegular, fontSize: 11.5, lineHeight: 16, color: 'rgba(255,255,255,0.74)', marginTop: 5, maxWidth: 220 },
  queueClock: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: color.brandCoral, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },

  trustStrip: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: space[5], marginTop: 22, gap: 10 },
  trustItem: { flex: 1, alignItems: 'center', gap: 6 },
  trustLabel: { fontFamily: font.bodyMedium, fontSize: 9.5, lineHeight: 12, color: color.ink, textAlign: 'center' },

  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 72,
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingTop: 7,
    shadowColor: color.ink,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -5 },
    elevation: 12,
  },
  bottomItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  bottomLabel: { fontFamily: font.bodyMedium, fontSize: 10, color: color.muted },
  bottomLabelActive: { color: color.brandCoral, fontFamily: font.bodyBold },
});
