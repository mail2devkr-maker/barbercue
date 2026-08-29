import { useEffect, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import * as ImagePicker from 'expo-image-picker';
import { PREMIUM_PATHS, STYLE_ADVISOR_PATHS } from '@barbercue/shared';
import type {
  AiCreditBalanceDto,
  HairstylePreviewDto,
  PremiumEntitlementDto,
  StyleAdvisorResultDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Card, Button, InlineError, Skeleton, SafeImage } from '../components/ui';
import type { HomeStackParamList, TabParamList } from '../navigation/types';

// Registered in both HomeStack and AccountStack with the identical `StyleAdvisor: undefined`
// route shape — HomeStackParamList used here as the stack half is arbitrary (AccountStackParamList
// would type-check identically); TabParamList lets it navigate cross-tab into Search regardless
// of which stack it was actually reached from.
type Props = CompositeScreenProps<NativeStackScreenProps<HomeStackParamList, 'StyleAdvisor'>, BottomTabScreenProps<TabParamList>>;
type Status = 'idle' | 'analyzing' | 'results' | 'error';
// Same meaning as apps/web's StyleAdvisorFlow. No native Premium-purchase screen exists yet
// (out of scope — "do not redesign mobile"), so a locked/no-credits state here is informational
// only; the web app's /account/premium page is the actual place to manage a subscription today.
type PremiumStatus = 'checking' | 'locked' | 'no-credits' | 'ready';

// Same upload -> analyze -> results -> "Try This Look" flow as apps/web's StyleAdvisorFlow; see
// that component's own doc comment for why every real attempt fails today (Gemini requires paid
// billing we haven't enabled, no verified free alternative found) — disclosed via the
// AI_PROVIDER_NOT_CONFIGURED branch below, never faked.
export default function StyleAdvisorScreen({ navigation }: Props) {
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<HairstylePreviewDto[]>([]);
  const [premiumStatus, setPremiumStatus] = useState<PremiumStatus>('checking');
  const [credits, setCredits] = useState<AiCreditBalanceDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<PremiumEntitlementDto>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.me}`),
      apiFetch<AiCreditBalanceDto>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.credits}`),
    ])
      .then(([entitlement, balance]) => {
        if (cancelled) return;
        setCredits(balance);
        if (!entitlement.isPremium) setPremiumStatus('locked');
        else setPremiumStatus(balance.available > 0 ? 'ready' : 'no-credits');
      })
      .catch(() => {
        if (!cancelled) setPremiumStatus('locked');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library access is needed to try the AI Style Advisor.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    setAsset(result.assets[0]);
    setError(null);
    setStatus('idle');
  }

  async function handleAnalyze() {
    if (!asset) return;
    setStatus('analyzing');
    setError(null);
    try {
      const form = new FormData();
      // React Native's FormData accepts this {uri, name, type} shape for a file part — it is not
      // a real Blob/File, which don't exist as uploadable objects on native.
      form.append('image', {
        uri: asset.uri,
        name: asset.fileName ?? 'selfie.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      } as unknown as Blob);

      const result = await apiFetch<StyleAdvisorResultDto>(
        `${STYLE_ADVISOR_PATHS.styleAdvisor}/${STYLE_ADVISOR_PATHS.generate}`,
        { method: 'POST', body: form },
      );
      setResults(result.results);
      setStatus('results');
      apiFetch<AiCreditBalanceDto>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.credits}`)
        .then((balance) => setCredits(balance))
        .catch(() => {});
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PREMIUM_REQUIRED') {
        setPremiumStatus('locked');
        return;
      }
      if (err instanceof ApiError && err.code === 'AI_CREDITS_EXHAUSTED') {
        setPremiumStatus('no-credits');
        return;
      }
      if (err instanceof ApiError && err.code === 'AI_PROVIDER_NOT_CONFIGURED') {
        setError('AI Style Preview is temporarily unavailable while we prepare the image-generation service. Your photo was not stored.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
      setStatus('error');
    }
  }

  function handleTryThisLook(styleName: string) {
    navigation.navigate('SearchTab', { screen: 'SalonSearch', params: { selectedStyleName: styleName } });
  }

  if (premiumStatus === 'checking') {
    return (
      <Screen contentStyle={styles.checkingContent}>
        <Skeleton style={styles.checkingSkeleton} />
      </Screen>
    );
  }

  if (premiumStatus === 'locked') {
    return (
      <Screen scroll={false} contentStyle={styles.screenContent}>
        <SectionHeader eyebrow="Premium" title="AI Style Advisor is a Premium feature" subtitle="Upgrade to Premium on the BarberCue web app to preview hairstyles on your photo." />
      </Screen>
    );
  }

  if (premiumStatus === 'no-credits') {
    return (
      <Screen scroll={false} contentStyle={styles.screenContent}>
        <SectionHeader
          eyebrow="AI Style Advisor"
          title="You're out of AI Style Credits"
          subtitle="You've used all your AI Style Credits for this subscription period."
        />
      </Screen>
    );
  }

  if (status === 'results') {
    return (
      <Screen scroll={false} contentStyle={styles.screenContent}>
        <SectionHeader eyebrow="AI Style Advisor" title="Your looks" subtitle="Each shows an AI Style Match — not a guarantee of how it will turn out on you." />
        <FlatList
          data={results}
          keyExtractor={(item) => item.styleId}
          contentContainerStyle={styles.resultsList}
          renderItem={({ item }) => (
            <Card style={styles.resultCard}>
              <SafeImage url={item.previewUrl} alt={item.styleName} style={styles.previewImage} />
              <Text style={styles.cardTitle}>{item.styleName}</Text>
              <Text style={styles.cardSubtitle}>AI Style Match: {item.matchPercent}%</Text>
              <Button title="Try This Look" onPress={() => handleTryThisLook(item.styleName)} />
            </Card>
          )}
        />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.screenContent}>
      <SectionHeader eyebrow="AI Style Advisor" title="Preview your next look" subtitle="Upload a photo and preview a few hairstyles before you book." />

      {asset && <Image source={{ uri: asset.uri }} style={styles.preview} />}

      <Button title={asset ? 'Choose a different photo' : 'Choose a photo'} variant="secondary" onPress={() => void pickImage()} style={styles.pickButton} />

      {error && <InlineError message={error} />}

      {credits && <Text style={styles.note}>AI Credits remaining: {credits.available}</Text>}

      <Button
        title="Analyze my photo"
        onPress={() => void handleAnalyze()}
        loading={status === 'analyzing'}
        disabled={!asset}
        style={styles.analyzeButton}
      />

      <Text style={styles.note}>Your photo is used only to generate these previews and is not stored.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  checkingContent: { justifyContent: 'center', alignItems: 'center' },
  checkingSkeleton: { width: 200, height: 20, borderRadius: 6 },
  note: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[4] },
  preview: { width: 180, height: 180, borderRadius: radius.lg, marginBottom: space[4], alignSelf: 'center' },
  previewImage: { width: '100%', height: 200, borderRadius: radius.md, marginBottom: space[3] },
  pickButton: { marginTop: space[2] },
  analyzeButton: { marginTop: space[3] },
  resultsList: { paddingTop: space[2] },
  resultCard: { marginBottom: space[3] },
  cardTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink },
  cardSubtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[1], marginBottom: space[3] },
});
