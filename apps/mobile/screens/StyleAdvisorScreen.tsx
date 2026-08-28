import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
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
      <View style={styles.container}>
        <ActivityIndicator color="#EDE6DA" />
      </View>
    );
  }

  if (premiumStatus === 'locked') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>🔒 AI Style Advisor is a Premium feature</Text>
        <Text style={styles.subtitle}>
          Upgrade to Premium on the BarberCue web app to preview hairstyles on your photo.
        </Text>
      </View>
    );
  }

  if (premiumStatus === 'no-credits') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>You&apos;re out of AI Style Credits</Text>
        <Text style={styles.subtitle}>
          You&apos;ve used all your AI Style Credits for this subscription period.
        </Text>
      </View>
    );
  }

  if (status === 'results') {
    return (
      <View style={styles.container}>
        <Text style={styles.subtitle}>
          Here are a few looks to consider. Each shows an AI Style Match — not a guarantee of how
          it will turn out on you.
        </Text>
        <FlatList
          data={results}
          keyExtractor={(item) => item.styleId}
          contentContainerStyle={{ paddingTop: 16 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Image source={{ uri: item.previewUrl }} style={styles.previewImage} />
              <Text style={styles.cardTitle}>{item.styleName}</Text>
              <Text style={styles.cardSubtitle}>AI Style Match: {item.matchPercent}%</Text>
              <Pressable style={styles.button} onPress={() => handleTryThisLook(item.styleName)}>
                <Text style={styles.buttonText}>Try This Look</Text>
              </Pressable>
            </View>
          )}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>AI Style Advisor</Text>
      <Text style={styles.subtitle}>Upload a photo and preview a few hairstyles before you book.</Text>

      {asset && <Image source={{ uri: asset.uri }} style={styles.preview} />}

      <Pressable style={styles.secondaryButton} onPress={() => void pickImage()}>
        <Text style={styles.secondaryButtonText}>{asset ? 'Choose a different photo' : 'Choose a photo'}</Text>
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}

      {credits && <Text style={styles.note}>AI Credits remaining: {credits.available}</Text>}

      <Pressable
        style={[styles.button, (!asset || status === 'analyzing') && styles.buttonDisabled]}
        onPress={() => void handleAnalyze()}
        disabled={!asset || status === 'analyzing'}
      >
        {status === 'analyzing' ? (
          <ActivityIndicator color="#EDE6DA" />
        ) : (
          <Text style={styles.buttonText}>Analyze my photo</Text>
        )}
      </Pressable>

      <Text style={styles.note}>Your photo is used only to generate these previews and is not stored.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', color: '#EDE6DA' },
  subtitle: { fontSize: 14, color: '#B8AFA0', marginTop: 8, marginBottom: 16 },
  note: { fontSize: 12, color: '#8A8377', marginTop: 16 },
  error: { color: '#E24B4A', fontSize: 14, marginVertical: 12 },
  preview: { width: 180, height: 180, borderRadius: 12, marginBottom: 16, alignSelf: 'center' },
  previewImage: { width: '100%', height: 200, borderRadius: 12, marginBottom: 10 },
  button: { backgroundColor: '#B0413E', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#EDE6DA', fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    backgroundColor: '#2A2723',
    borderWidth: 1,
    borderColor: '#B8AFA0',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#EDE6DA', fontSize: 15, fontWeight: '600' },
  card: { backgroundColor: '#2A2723', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { color: '#EDE6DA', fontSize: 16, fontWeight: '600' },
  cardSubtitle: { color: '#B8AFA0', fontSize: 13, marginTop: 4, marginBottom: 12 },
});
