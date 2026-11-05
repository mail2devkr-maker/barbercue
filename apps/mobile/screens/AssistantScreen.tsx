import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import {
  assistantConfirmationCanProceed,
  assistantConfirmationReadiness,
  assistantSurfaceForUser,
  pendingAssistantConfirmation,
  toAssistantDisplayTurn,
  type AssistantDisplayTurn,
  type PendingAssistantConfirmation,
} from '../lib/assistant-client';
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
  canConfirm?: boolean;
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
  const confirmationTokens = useRef(new Map<string, PendingAssistantConfirmation>());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmationDialogId, setConfirmationDialogId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const confirmationContext = useRef({ surface, salonId: selectedSalonId });
  confirmationContext.current = { surface, salonId: selectedSalonId };

  useEffect(() => () => confirmationTokens.current.clear(), []);

  useEffect(() => {
    confirmationTokens.current.clear();
    setConfirmationDialogId(null);
    setAcknowledged(false);
    setTurns((previous) => previous.some((turn) => turn.canConfirm)
      ? previous.map((turn) => turn.canConfirm ? { ...turn, canConfirm: false } : turn)
      : previous);
  }, [selectedSalonId, surface]);

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
      return () => {
        active = false;
        requestId.current += 1;
        confirmationTokens.current.clear();
      };
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
      const contextStillCurrent = confirmationContext.current.surface === surface
        && confirmationContext.current.salonId === selectedSalonId;
      const pendingConfirmation = contextStillCurrent
        ? pendingAssistantConfirmation(response, access.writes, surface, selectedSalonId)
        : null;
      if (pendingConfirmation) {
        // The bearer-like token remains in component memory only. It is never rendered or persisted.
        confirmationTokens.current.set(displayed.requestId, pendingConfirmation);
      }
      setTurns((previous) => [...previous, {
        id: displayed.requestId,
        text: '',
        assistant: displayed,
        destination,
        canConfirm: pendingConfirmation !== null,
      }]);
    } catch (cause) {
      setDraft(clean);
      setError(cause instanceof ApiError ? cause.message : 'Assistant could not connect. Try again.');
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [access?.enabled, access?.writes, isOwner, selectedSalonId, sending, surface]);

  const decide = useCallback(async (entryId: string, decision: 'confirm' | 'cancel') => {
    const pending = confirmationTokens.current.get(entryId);
    const context = confirmationContext.current;
    const activeSurface = context.surface;
    if (!pending || confirmingId || !activeSurface) return;
    if (decision === 'confirm' && !assistantConfirmationCanProceed(pending, acknowledged)) {
      setError('Please acknowledge the change before confirming it.');
      return;
    }
    const readiness = assistantConfirmationReadiness(pending, { surface: activeSurface, salonId: context.salonId });
    if (readiness === 'expired') {
      confirmationTokens.current.delete(entryId);
      setConfirmationDialogId(null);
      setTurns((previous) => previous.map((turn) => turn.id === entryId ? { ...turn, canConfirm: false } : turn));
      setError('That preview expired. Ask FastQue again to create a fresh preview.');
      return;
    }
    if (readiness === 'context-changed') {
      confirmationTokens.current.delete(entryId);
      setConfirmationDialogId(null);
      setTurns((previous) => previous.map((turn) => turn.id === entryId ? { ...turn, canConfirm: false } : turn));
      setError('Your selected account or shop changed. Ask FastQue again before confirming.');
      return;
    }

    // Consume locally before sending so a rapid second tap cannot replay the token.
    confirmationTokens.current.delete(entryId);
    setConfirmationDialogId(null);
    setAcknowledged(false);
    setConfirmingId(entryId);
    setError(null);
    setTurns((previous) => previous.map((turn) => turn.id === entryId ? { ...turn, canConfirm: false } : turn));
    try {
      const response = await apiFetch<AssistantTurnDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.confirmations}`, {
        method: 'POST',
        body: JSON.stringify({
          token: pending.token,
          decision,
          ...(decision === 'confirm' && pending.requiresAcknowledgement ? { acknowledged: true } : {}),
        }),
      });
      const displayed = toAssistantDisplayTurn(response, decision === 'confirm');
      setTurns((previous) => [...previous, { id: `decision-${response.requestId}-${Date.now()}`, text: '', assistant: displayed }]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'FastQue could not apply that decision. Refresh the preview before trying again.');
    } finally {
      setConfirmingId(null);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [acknowledged, confirmingId]);

  function requestDecision(turn: ConversationTurn) {
    const pending = confirmationTokens.current.get(turn.id);
    if (!turn.canConfirm || !turn.assistant || !pending || !surface) return;
    const readiness = assistantConfirmationReadiness(pending, { surface, salonId: selectedSalonId });
    if (readiness !== 'ready') {
      confirmationTokens.current.delete(turn.id);
      setTurns((previous) => previous.map((item) => item.id === turn.id ? { ...item, canConfirm: false } : item));
      setError(readiness === 'expired'
        ? 'That preview expired. Ask FastQue again to create a fresh preview.'
        : 'Your selected account or shop changed. Ask FastQue again before confirming.');
      return;
    }
    setAcknowledged(false);
    setConfirmationDialogId(turn.id);
  }

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
                      <>
                        <Text style={styles.notice}>Nothing changes until you review the preview and confirm. The confirmation expires at the time set by the server.</Text>
                        {turn.canConfirm ? <PremiumButton title={confirmingId === turn.id ? 'Sending decision…' : 'Review & confirm'} onPress={() => requestDecision(turn)} disabled={confirmingId !== null} style={styles.openButton} /> : null}
                      </>
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
            <Text style={styles.footnote}>{access.writes ? 'Changes are previewed first and require your explicit confirmation.' : 'Read and navigation access only. Changes are disabled.'}</Text>
          </>
        ) : null}
      </PremiumScreen>
  );
  const confirmationTurn = turns.find((turn) => turn.id === confirmationDialogId);
  const confirmation = confirmationTurn?.assistant;
  const pendingConfirmation = confirmationDialogId ? confirmationTokens.current.get(confirmationDialogId) : null;
  return (
    <>
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={styles.keyboard} behavior="padding" keyboardVerticalOffset={72}>{content}</KeyboardAvoidingView>
      ) : content}
      <Modal
        visible={confirmationDialogId !== null && confirmation !== undefined && pendingConfirmation !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { setConfirmationDialogId(null); setAcknowledged(false); }}
        statusBarTranslucent
      >
        <View style={styles.confirmOverlay}>
          <View accessibilityViewIsModal accessibilityRole="alert" style={styles.confirmDialog}>
            <Text style={styles.confirmTitle}>Review this change</Text>
            <ScrollView style={styles.confirmBody} contentContainerStyle={styles.confirmBodyContent}>
              <Text style={styles.body}>{confirmation?.message}</Text>
              {confirmation?.preview?.rows.map((row, index) => (
                <Text key={`confirm-${confirmationDialogId}-${index}`} style={styles.item}>
                  {row.label}: {row.before ?? '—'} → {row.after ?? '—'}
                </Text>
              ))}
              {confirmation?.preview?.warning ? <Text style={styles.warning}>{confirmation.preview.warning}</Text> : null}
            </ScrollView>
            {pendingConfirmation?.requiresAcknowledgement ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acknowledged }}
                onPress={() => setAcknowledged((current) => !current)}
                style={styles.acknowledgement}
              >
                <View style={[styles.checkbox, acknowledged && styles.checkboxChecked]}>
                  {acknowledged ? <Text style={styles.checkmark}>✓</Text> : null}
                </View>
                <Text style={styles.acknowledgementText}>
                  I understand the consequence of this change and want to continue.
                </Text>
              </Pressable>
            ) : null}
            <View style={styles.confirmActions}>
              <PremiumButton title="Not now" variant="secondary" onPress={() => { setConfirmationDialogId(null); setAcknowledged(false); }} style={styles.confirmActionButton} />
              <PremiumButton title="Cancel change" variant="secondary" onPress={() => void decide(confirmationDialogId!, 'cancel')} disabled={confirmingId !== null} style={styles.confirmActionButton} />
              <PremiumButton
                title={confirmingId === confirmationDialogId ? 'Sending…' : 'Confirm change'}
                onPress={() => void decide(confirmationDialogId!, 'confirm')}
                disabled={confirmingId !== null || Boolean(pendingConfirmation && !assistantConfirmationCanProceed(pendingConfirmation, acknowledged))}
                style={styles.confirmActionButton}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
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
  confirmOverlay: { flex: 1, justifyContent: 'center', padding: space[4], backgroundColor: 'rgba(10, 8, 12, 0.72)' },
  confirmDialog: { maxHeight: '82%', borderRadius: radius.lg, padding: space[4], backgroundColor: fastQue.backgroundRaised, borderWidth: 1, borderColor: fastQue.borderStrong },
  confirmTitle: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.lg, marginBottom: space[3] },
  confirmBody: { flexShrink: 1, marginBottom: space[3] },
  confirmBodyContent: { gap: space[2] },
  warning: { color: fastQue.warning, fontFamily: font.bodyMedium, fontSize: fontSize.xs, lineHeight: 20, marginTop: space[2] },
  acknowledgement: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingVertical: space[3], marginBottom: space[2] },
  checkbox: { width: 24, height: 24, borderRadius: 5, borderWidth: 2, borderColor: fastQue.textMuted, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: fastQue.pink, borderColor: fastQue.pink },
  checkmark: { color: fastQue.text, fontFamily: font.bodyBold, fontSize: 16, lineHeight: 18 },
  acknowledgementText: { flex: 1, color: fastQue.text, fontFamily: font.bodyMedium, fontSize: fontSize.xs, lineHeight: 20 },
  confirmActions: { gap: space[2] },
  confirmActionButton: { width: '100%' },
});
