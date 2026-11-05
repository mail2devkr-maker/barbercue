import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import {
  ASSISTANT_PATHS,
  Language,
  type AssistantAccessDto,
  type AssistantCapabilitiesDto,
  type AssistantSurface,
  type AssistantTurnDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { assistantSurfaceForUser, toAssistantDisplayTurn, type AssistantDisplayTurn } from '../lib/assistant-client';
import { resolveAssistantDestination, type AssistantDestination } from '../lib/assistant-navigation';
import { navigationRef } from '../navigation/navigation-ref';
import { useAuth } from '../lib/auth-context';
import { useOptionalSalon } from '../lib/salon-context';
import { fastQue, font, fontSize, radius, space } from '../lib/theme';
import { PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader, PremiumTextField } from '../components/ui';

export interface AssistantScreenParams {
  salonId?: string;
}

interface ConversationTurn {
  id: string;
  text: string;
  assistant?: AssistantDisplayTurn;
  destination?: AssistantDestination | null;
}

export default function AssistantScreen({ route }: { route?: { params?: AssistantScreenParams } } = {}) {
  const { user } = useAuth();
  const salonContext = useOptionalSalon();
  const routeSalonId = route?.params?.salonId;
  const selectedSalonId = salonContext?.selectedSalonId ?? routeSalonId ?? null;
  const isOwner = Boolean(user?.roles.includes('SALON_OWNER'));
  const surface = useMemo(() => user ? assistantSurfaceForUser(user) : null, [user]);
  const [access, setAccess] = useState<AssistantAccessDto | null>(null);
  const [capabilities, setCapabilities] = useState<AssistantCapabilitiesDto | null>(null);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const listRef = useRef<ScrollView>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const current = ++requestId.current;
      setLoading(true);
      setError(null);
      void (async () => {
        try {
          if (!surface) throw new Error('This account role cannot use the mobile Assistant.');
          const result = await apiFetch<AssistantAccessDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.access}`);
          if (!result.enabled) throw new Error('FastQue Assistant is not enabled for this account yet.');
          const supported = await apiFetch<AssistantCapabilitiesDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.capabilities}`);
          if (active && current === requestId.current) {
            setAccess(result);
            setCapabilities(supported);
          }
        } catch (cause) {
          if (active && current === requestId.current) {
            setAccess(null);
            setCapabilities(null);
            setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : 'Assistant is unavailable.');
          }
        } finally {
          if (active && current === requestId.current) setLoading(false);
        }
      })();
      return () => { active = false; requestId.current += 1; };
    }, [surface]),
  );

  const examples = useMemo(() => {
    const actions = capabilities?.actions ?? [];
    return actions
      .filter((action) => action.state === 'SUPPORTED' && action.kind === 'READ')
      .flatMap((action) => action.examples)
      .slice(0, 4);
  }, [capabilities]);

  const send = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || sending || !surface || !access?.enabled) return;
    if (surface === 'shop' && !selectedSalonId) {
      setError('Select an authorized shop in the Owner or Staff area before asking shop questions.');
      return;
    }
    setSending(true);
    setError(null);
    const userTurn: ConversationTurn = { id: `user-${Date.now()}`, text: clean };
    setTurns((previous) => [...previous, userTurn]);
    setDraft('');
    try {
      const response = await apiFetch<AssistantTurnDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.turns}`, {
        method: 'POST',
        body: JSON.stringify({
          text: clean,
          surface,
          inputMode: 'text',
          ...(surface === 'shop' && selectedSalonId ? { salonId: selectedSalonId } : {}),
        }),
      });
      const displayed = toAssistantDisplayTurn(response);
      const destination = response.navigateTo
        ? resolveAssistantDestination({
            navigateTo: response.navigateTo,
            surface,
            salonId: selectedSalonId,
            isOwner,
          })
        : null;
      setTurns((previous) => [...previous, {
        id: displayed.requestId,
        text: '',
        assistant: displayed,
        destination,
      }]);
    } catch (cause) {
      setDraft(clean);
      setError(cause instanceof ApiError ? cause.message : 'Assistant could not connect. Try again.');
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [access?.enabled, isOwner, selectedSalonId, sending, surface]);

  function openDestination(destination: AssistantDestination) {
    if (!navigationRef.isReady()) return;
    switch (destination) {
      case 'customer-search': navigationRef.navigate('SearchTab', { screen: 'SalonSearch' }); break;
      case 'customer-favorites': navigationRef.navigate('SearchTab', { screen: 'SalonSearch', params: { initialFavoritesOnly: true } }); break;
      case 'customer-bookings': navigationRef.navigate('BookingsTab', { screen: 'MyBookings' }); break;
      case 'customer-queue': navigationRef.navigate('QueueTab', { screen: 'QueueHome' }); break;
      case 'customer-account': navigationRef.navigate('AccountTab', { screen: 'Account' }); break;
      case 'owner-dashboard': navigationRef.navigate('OwnerDashboardTab'); break;
      case 'owner-queue': navigationRef.navigate('OwnerQueueTab'); break;
      case 'owner-bookings': navigationRef.navigate('OwnerBookingsTab'); break;
      case 'owner-shop': navigationRef.navigate('OwnerShopTab', { screen: 'OwnerShop' }); break;
      case 'owner-settings': navigationRef.navigate('OwnerShopTab', { screen: 'OwnerSettings' }); break;
      case 'owner-analytics': navigationRef.navigate('OwnerShopTab', { screen: 'OwnerBusiness', params: { initialPanel: 'analytics' } }); break;
      case 'owner-cancellations': navigationRef.navigate('OwnerShopTab', { screen: 'OwnerBusiness', params: { initialPanel: 'cancellations' } }); break;
      case 'owner-invoices': navigationRef.navigate('OwnerShopTab', { screen: 'OwnerBusiness', params: { initialPanel: 'invoices' } }); break;
      case 'owner-payments': navigationRef.navigate('OwnerShopTab', { screen: 'OwnerBusiness', params: { initialPanel: 'payments' } }); break;
      case 'owner-reviews': navigationRef.navigate('OwnerShopTab', { screen: 'OwnerBusiness', params: { initialPanel: 'reviews' } }); break;
      case 'owner-offers': navigationRef.navigate('OwnerShopTab', { screen: 'OwnerBusiness', params: { initialPanel: 'offers' } }); break;
      case 'owner-verification': navigationRef.navigate('OwnerShopTab', { screen: 'OwnerBusiness', params: { initialPanel: 'verification' } }); break;
      case 'owner-inventory': navigationRef.navigate('OwnerShopTab', { screen: 'OwnerInventory' }); break;
      case 'owner-customers': navigationRef.navigate('OwnerShopTab', { screen: 'OwnerCustomers' }); break;
      case 'owner-notifications': navigationRef.navigate('OwnerAccountTab', { screen: 'Notifications' }); break;
      case 'staff-today': navigationRef.navigate('StaffTodayTab'); break;
      case 'staff-notifications': navigationRef.navigate('StaffAccountTab', { screen: 'Notifications' }); break;
      case 'employee-dashboard': navigationRef.navigate('EmployeeDashboard'); break;
    }
  }

  const content = (
      <PremiumScreen scroll={false} contentStyle={styles.screen}>
        <PremiumSectionHeader eyebrow="FASTQUE ASSISTANT" title="How can I help?" subtitle="Ask in English, Hindi, or Hinglish. You can also use your keyboard’s dictation button." />
        {loading ? <Text style={styles.muted}>Checking Assistant availability…</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!loading && !access?.enabled ? (
          <PremiumCard><Text style={styles.body}>Assistant is unavailable for this account right now. It will appear when the authenticated service enables it.</Text></PremiumCard>
        ) : null}
        {access?.enabled ? (
          <>
            {examples.length > 0 ? (
              <View style={styles.examples}>
                {examples.map((example) => (
                  <Pressable key={example} accessibilityRole="button" onPress={() => void send(example)} style={styles.example}>
                    <Text style={styles.exampleText}>{example}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <ScrollView ref={listRef} style={styles.transcript} contentContainerStyle={styles.transcriptContent} keyboardShouldPersistTaps="handled" onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}>
              {turns.map((turn) => (
                <View key={turn.id}>
                  {turn.text ? <View style={[styles.bubble, styles.userBubble]}><Text style={styles.body}>{turn.text}</Text></View> : null}
                  {turn.assistant ? <PremiumCard style={styles.reply}>
                    <Text style={styles.body}>{turn.assistant.message}</Text>
                    {turn.assistant.result?.summary ? <Text style={styles.summary}>{turn.assistant.result.summary}</Text> : null}
                    {turn.assistant.result?.items?.map((item, index) => <Text key={item.id ?? `${turn.id}-${index}`} style={styles.item}>{item.title}{item.detail ? ` · ${item.detail}` : ''}</Text>)}
                    {turn.assistant.preview?.rows.map((row, index) => <Text key={`${turn.id}-preview-${index}`} style={styles.item}>{row.label}: {row.before ?? '—'} → {row.after ?? '—'}</Text>)}
                    {turn.assistant.status === 'NEEDS_CONFIRMATION' ? (
                      <Text style={styles.notice}>Nothing has changed. This mobile release cannot confirm changes yet; use the website for this action.</Text>
                    ) : null}
                    {turn.destination ? <PremiumButton title="Open this screen" variant="secondary" onPress={() => openDestination(turn.destination!)} style={styles.openButton} /> : null}
                    {turn.assistant.status === 'NEEDS_INPUT' ? turn.assistant.options?.map((option) => (
                      <PremiumButton key={option.text} title={option.label} variant="secondary" onPress={() => void send(option.text)} style={styles.option} />
                    )) : null}
                    <Pressable accessibilityRole="button" onPress={() => Speech.speak(turn.assistant!.message, { language: user?.preferredLanguage === Language.HI ? 'hi-IN' : 'en-US' })} style={styles.listen}>
                      <Text style={styles.listenText}>Read reply aloud</Text>
                    </Pressable>
                  </PremiumCard> : null}
                </View>
              ))}
              {sending ? <Text style={styles.muted}>Thinking…</Text> : null}
            </ScrollView>
            <View style={styles.composer}>
              <PremiumTextField
                accessibilityLabel="Message FastQue Assistant"
                value={draft}
                onChangeText={setDraft}
                placeholder="Ask FastQue…"
                multiline
                maxLength={500}
                returnKeyType="send"
                blurOnSubmit
                onSubmitEditing={() => void send(draft)}
                editable={!sending}
                style={styles.input}
              />
              <PremiumButton title={sending ? 'Sending…' : 'Send'} onPress={() => void send(draft)} disabled={!draft.trim() || sending} style={styles.send} />
            </View>
            <Text style={styles.footnote}>{access.writes ? 'Changes are previewed first; this screen does not execute confirmations.' : 'Read and navigation access only. Changes are disabled.'}</Text>
          </>
        ) : null}
      </PremiumScreen>
  );
  return Platform.OS === 'ios' ? (
    <KeyboardAvoidingView style={styles.keyboard} behavior="padding" keyboardVerticalOffset={72}>{content}</KeyboardAvoidingView>
  ) : content;
}

const styles = StyleSheet.create({
  keyboard: { flex: 1, backgroundColor: fastQue.background },
  screen: { flex: 1, paddingBottom: space[2] },
  transcript: { flex: 1, marginTop: space[3] },
  transcriptContent: { gap: space[3], paddingBottom: space[3] },
  examples: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  example: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, backgroundColor: fastQue.card, borderWidth: 1, borderColor: fastQue.border },
  exampleText: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.xs },
  bubble: { alignSelf: 'flex-end', maxWidth: '90%', padding: space[3], borderRadius: radius.md },
  userBubble: { backgroundColor: fastQue.cardStrong, borderColor: fastQue.borderStrong, borderWidth: 1 },
  reply: { marginRight: space[4] },
  body: { color: fastQue.text, fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: 22 },
  summary: { color: fastQue.orange, fontFamily: font.bodySemiBold, fontSize: fontSize.sm, marginTop: space[2] },
  item: { color: fastQue.textSecondary, fontFamily: font.bodyRegular, fontSize: fontSize.sm, marginTop: space[2] },
  notice: { color: fastQue.warning, fontFamily: font.bodyMedium, fontSize: fontSize.xs, lineHeight: 19, marginTop: space[3] },
  openButton: { marginTop: space[3] },
  option: { marginTop: space[2] },
  listen: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: space[2], marginTop: space[1] },
  listenText: { color: fastQue.pink, fontFamily: font.bodySemiBold, fontSize: fontSize.xs },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2], paddingTop: space[2], borderTopWidth: 1, borderTopColor: fastQue.border },
  input: { flex: 1, minHeight: 52, maxHeight: 120, paddingTop: space[3], textAlignVertical: 'top' },
  send: { width: 92 },
  muted: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: fontSize.sm, paddingVertical: space[2] },
  error: { color: fastQue.error, fontFamily: font.bodyMedium, fontSize: fontSize.sm, paddingBottom: space[2] },
  footnote: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: 11, marginTop: space[2] },
});
