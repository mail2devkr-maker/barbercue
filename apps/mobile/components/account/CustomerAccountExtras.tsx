import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import {
  AUTH_PATHS,
  Language,
  NOTIFICATION_PATHS,
  OTP_RESEND_COOLDOWN_SECONDS,
  PREMIUM_PATHS,
  SessionAudience,
  otpRequestSchema,
  otpVerifySchema,
  type AiCreditBalanceDto,
  type AuthMethodsDto,
  type AuthTokens,
  type CustomerPremiumPlanDto,
  type InvoiceListDto,
  type InvoiceSummaryDto,
  type MeResponse,
  type NotificationPreferencesDto,
  type PremiumEntitlementDto,
} from '@barbercue/shared';
import { apiDownloadFile, apiFetch, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * Website parity for the customer account pages: My invoices with PDF (account/invoices),
 * notification preferences and the verified sign-in phone (account/profile + CustomerPhoneLinkPanel),
 * and Premium plans (account/premium). Same endpoints and shared schemas; the phone link only ever
 * updates the signed-in account and never links or merges another account by phone number.
 */
const hiOf = (language: Language) => language === Language.HI;
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

const CATEGORY_LABEL: Record<string, { en: [string, string]; hi: [string, string] }> = {
  BOOKING_UPDATES: { en: ['Booking updates', 'Confirmations and cancellations.'], hi: ['बुकिंग अपडेट', 'पुष्टि और रद्दीकरण।'] },
  QUEUE_UPDATES: { en: ['Queue updates', 'Turn-approaching and wait-time alerts.'], hi: ['कतार अपडेट', 'बारी नज़दीक और प्रतीक्षा समय की सूचना।'] },
  REMINDERS: { en: ['Appointment reminders', 'A heads-up before your appointment.'], hi: ['अपॉइंटमेंट रिमाइंडर', 'अपॉइंटमेंट से पहले सूचना।'] },
  PROMOTIONAL: { en: ['Offers & promotions', "Deals from shops you've visited."], hi: ['ऑफ़र और प्रमोशन', 'जिन दुकानों पर आप गए उनकी डील।'] },
};

function money(value: number, currency: string): string {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value); } catch { return `${currency} ${value}`; }
}

export function CustomerInvoicesCard({ language }: { language: Language }) {
  const hi = hiOf(language);
  const [items, setItems] = useState<InvoiceSummaryDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = (cursor?: string) => apiFetch<InvoiceListDto>(`invoices/mine${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
    .then((page) => { setItems((cur) => (cursor && cur ? [...cur, ...page.items] : page.items)); setNext(page.nextCursor); })
    .catch((err) => setError(errorText(err, hi ? 'आपके इनवॉइस लोड नहीं हो सके।' : 'Could not load your invoices.')));

  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);

  const download = async (invoice: InvoiceSummaryDto) => {
    setBusyId(invoice.id);
    setError(null);
    try {
      const uri = await apiDownloadFile(`invoices/mine/${invoice.id}/pdf`, `${invoice.number}.pdf`);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: invoice.number, UTI: 'com.adobe.pdf' });
    } catch (err) {
      setError(errorText(err, hi ? 'यह इनवॉइस डाउनलोड नहीं हो सका।' : 'Could not download this invoice.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>{hi ? 'मेरे इनवॉइस' : 'My invoices'}</Text>
      <Text style={styles.muted}>{hi ? 'पूरी सेवाओं के लिए दुकानों द्वारा जारी इनवॉइस।' : 'Invoices shops have issued to you for completed services.'}</Text>
      {!!error && <InlineError message={error} />}
      {items === null && !error ? <Text style={styles.muted}>…</Text> : items?.length === 0 ? <Text style={styles.muted}>{hi ? 'अभी कोई इनवॉइस नहीं।' : 'No invoices yet. A shop issues one after your service is complete.'}</Text> : items?.map((inv) => (
        <View key={inv.id} style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.strong}>{inv.number}</Text>
            <Text style={styles.muted}>{`${new Date(inv.issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${inv.paymentStatus}`}</Text>
          </View>
          <Text style={styles.strong}>{money(inv.total, inv.currency)}</Text>
          <Button title={busyId === inv.id ? '…' : 'PDF'} variant="outline" onPress={() => void download(inv)} disabled={busyId !== null} />
        </View>
      ))}
      {next && <Button title={hi ? 'और दिखाएँ' : 'Load more'} variant="outline" onPress={() => void load(next)} />}
    </Card>
  );
}

export function NotificationPreferencesCard({ language }: { language: Language }) {
  const hi = hiOf(language);
  const path = `${NOTIFICATION_PATHS.notifications}/${NOTIFICATION_PATHS.preferences}`;
  const [preferences, setPreferences] = useState<NotificationPreferencesDto | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<NotificationPreferencesDto>(path).then((r) => { if (!cancelled) setPreferences(r); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [path]);

  const toggle = async (category: string, enabled: boolean) => {
    setSavingKey(category);
    try {
      setPreferences(await apiFetch<NotificationPreferencesDto>(path, { method: 'PUT', body: JSON.stringify({ category, channel: 'IN_APP', enabled }) }));
    } catch {
      // Leave the previous state in place, as the website does.
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>{hi ? 'सूचना पसंद' : 'Notification preferences'}</Text>
      <Text style={styles.muted}>{hi ? 'चुनें कि FastQue से क्या सुनना है। अभी केवल इन-ऐप सूचना उपलब्ध है।' : 'Choose what you hear from FastQue. In-app is the only channel available today — SMS, email and WhatsApp aren’t connected yet.'}</Text>
      {preferences === null ? <Text style={styles.muted}>…</Text> : (preferences.categories ?? []).map((cat) => {
        const inApp = cat.channels.find((c) => c.channel === 'IN_APP');
        if (!inApp) return null;
        const [title, description] = (CATEGORY_LABEL[cat.category]?.[hi ? 'hi' : 'en']) ?? [cat.category, ''];
        return (
          <View key={cat.category} style={styles.row}>
            <View style={styles.flex}><Text style={styles.strong}>{title}</Text>{description ? <Text style={styles.muted}>{description}</Text> : null}</View>
            <Switch accessibilityLabel={title} value={inApp.enabled} disabled={savingKey === cat.category} onValueChange={(v) => void toggle(cat.category, v)} />
          </View>
        );
      })}
    </Card>
  );
}

export function PhoneLinkCard({ language }: { language: Language }) {
  const hi = hiOf(language);
  const { user, applySession } = useAuth();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AuthMethodsDto>(`auth/${AUTH_PATHS.methods}`).then((m) => { if (!cancelled) setAvailable(m.phoneOtp === true); }).catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => setCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (!user || user.audience !== SessionAudience.CUSTOMER || !available) return null;

  const sendCode = async () => {
    setError(null); setSuccess(null);
    const parsed = otpRequestSchema.safeParse({ phone: phone.trim() });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Enter a valid international phone number.'); return; }
    setBusy(true);
    try {
      await apiFetch(`auth/${AUTH_PATHS.customerPhoneLinkRequest}`, { method: 'POST', body: JSON.stringify(parsed.data) });
      setPhone(parsed.data.phone); setCode(''); setStep('code'); setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(errorText(err, 'Could not send a verification code.'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null); setSuccess(null);
    const parsed = otpVerifySchema.safeParse({ phone, code: code.replace(/\D/g, '') });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Enter the 6-digit code.'); return; }
    setBusy(true);
    try {
      const result = await apiFetch<{ user: MeResponse; tokens: AuthTokens }>(`auth/${AUTH_PATHS.customerPhoneLinkVerify}`, { method: 'POST', body: JSON.stringify(parsed.data) });
      await applySession(result);
      setPhone(result.user.phone ?? parsed.data.phone); setCode(''); setStep('phone');
      setSuccess(hi ? 'आपका सत्यापित साइन-इन नंबर सहेजा गया। अन्य सत्र साइन आउट हुए।' : 'Your verified sign-in number is saved. Other refresh sessions were signed out.');
    } catch (err) {
      setError(errorText(err, 'Could not verify this number. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>{hi ? 'सत्यापित साइन-इन फ़ोन' : 'Verified sign-in phone'}</Text>
      <Text style={styles.muted}>{hi ? 'भविष्य में साइन-इन के लिए अपना नंबर सत्यापित करें। यह केवल आपका खाता बदलता है; किसी दूसरे खाते को नहीं जोड़ता।' : 'Verify a number you control for future customer sign-ins. This updates only your account; it never links or merges another account based on a phone number.'}</Text>
      {step === 'phone' ? (
        <>
          <TextInput accessibilityLabel="Phone number" placeholder="+91XXXXXXXXXX" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" style={styles.input} />
          <Button title={busy ? '…' : hi ? 'कोड भेजें' : 'Send code'} onPress={() => void sendCode()} disabled={busy} />
        </>
      ) : (
        <>
          <Text style={styles.muted}>{hi ? `${phone} पर भेजा गया 6 अंकों का कोड लिखें।` : `Enter the 6-digit code sent to ${phone}.`}</Text>
          <TextInput accessibilityLabel="Verification code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} style={styles.input} />
          <Button title={busy ? '…' : hi ? 'सत्यापित करें' : 'Verify'} onPress={() => void verify()} disabled={busy} />
          <Button title={cooldown > 0 ? (hi ? `${cooldown} सेकंड में फिर भेजें` : `Resend in ${cooldown}s`) : (hi ? 'कोड फिर भेजें' : 'Resend code')} variant="outline" onPress={() => void sendCode()} disabled={busy || cooldown > 0} />
          <Button title={hi ? 'नंबर बदलें' : 'Change number'} variant="outline" onPress={() => { setStep('phone'); setCode(''); }} disabled={busy} />
        </>
      )}
      {!!error && <InlineError message={error} />}
      {!!success && <Text style={styles.ok}>{success}</Text>}
    </Card>
  );
}

export function PremiumPlansCard({ language }: { language: Language }) {
  const hi = hiOf(language);
  const [plans, setPlans] = useState<CustomerPremiumPlanDto[] | null>(null);
  const [entitlement, setEntitlement] = useState<PremiumEntitlementDto | null>(null);
  const [credits, setCredits] = useState<AiCreditBalanceDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<CustomerPremiumPlanDto[]>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.plans}`),
      apiFetch<PremiumEntitlementDto>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.me}`),
      apiFetch<AiCreditBalanceDto>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.credits}`),
    ]).then(([p, e, c]) => { if (!cancelled) { setPlans(p); setEntitlement(e); setCredits(c); } })
      .catch((err) => { if (!cancelled) setError(errorText(err, 'Could not load Premium plans.')); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>FastQue Premium</Text>
      <Text style={styles.muted}>{hi ? 'प्रीमियम योजनाओं में AI स्टाइल एडवाइज़र क्रेडिट शामिल हैं।' : 'Premium plans include AI Style Advisor credits. Preview generation remains subject to the current image-service availability.'}</Text>
      {!!error && <InlineError message={error} />}
      {entitlement?.isPremium && (
        <View style={styles.current}>
          <Text style={styles.strong}>{`${hi ? 'वर्तमान योजना' : 'Current plan'}: ${entitlement.planName ?? ''}`}</Text>
          {entitlement.periodEnd ? <Text style={styles.muted}>{`${hi ? 'नवीनीकरण' : 'Renews'} ${new Date(entitlement.periodEnd).toLocaleDateString('en-IN')}`}</Text> : null}
          {credits ? <Text style={styles.muted}>{`${credits.available} ${hi ? 'में से' : 'of'} ${credits.allocated} ${hi ? 'AI क्रेडिट बाकी' : 'AI credits remaining'}`}</Text> : null}
        </View>
      )}
      {plans?.length === 0 && <Text style={styles.muted}>{hi ? 'अभी कोई प्रीमियम योजना उपलब्ध नहीं।' : 'No Premium plans are available right now.'}</Text>}
      {plans?.map((plan) => (
        <View key={plan.id} style={[styles.plan, plan.isPopular && styles.popular]}>
          {plan.isPopular && <Text style={styles.badge}>{hi ? 'सबसे लोकप्रिय' : 'MOST POPULAR'}</Text>}
          <Text style={styles.strong}>{`${plan.name} · ₹${plan.priceInr}/${hi ? 'वर्ष' : 'year'}`}</Text>
          <Text style={styles.muted}>{`${plan.aiCreditsPerYear} ${hi ? 'AI स्टाइल क्रेडिट/वर्ष' : 'AI Style Credits/year'} · AI Style Advisor`}</Text>
          <Text style={styles.muted}>{entitlement?.planId === plan.id ? (hi ? 'आपकी वर्तमान योजना' : 'Your current plan') : (hi ? 'ऑनलाइन भुगतान जल्द आ रहा है' : 'Online payment is coming soon')}</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space[4] },
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  strong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  ok: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.successSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginVertical: space[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  flex: { flex: 1 },
  current: { padding: space[3], borderRadius: radius.sm, backgroundColor: color.accentSoft, marginVertical: space[2] },
  plan: { padding: space[3], borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, marginTop: space[2] },
  popular: { borderColor: color.accent },
  badge: { fontFamily: font.bodyBold, color: color.accent, fontSize: 11 },
});
