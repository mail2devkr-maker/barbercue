import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  DASHBOARD_PATHS,
  Language,
  type CancellationAnalyticsDto,
  type InvoiceDetailDto,
  type InvoiceListDto,
  type InvoiceSummaryDto,
  type OfferDto,
  type OfferPreviewDto,
  type OwnerAnalyticsDto,
  type OwnerRevenueDto,
  type OwnerReviewsResponseDto,
  type RecordedPaymentListDto,
  type SalonCapabilitiesDto,
  type SalonServiceDto,
  type SalonTimezoneResultDto,
  type VerificationRequestDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { buildOfferBody, buildOfferPatch, type OfferErrors, type OfferForm } from '../../lib/offers';
import { OffersPanel } from '../../components/owner/OffersPanel';
import { useLanguage } from '../../lib/language-context';
import { useSalon } from '../../lib/salon-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, EmptyState, InlineError, Screen, SectionHeader } from '../../components/ui';

type Panel = 'analytics' | 'cancellations' | 'invoices' | 'payments' | 'reviews' | 'offers' | 'verification';
type OfferPage = { items: OfferDto[]; nextCursor: string | null };

const COPY = {
  en: {
    title: 'Business center', subtitle: 'Reports and shop workflows, scoped to your selected shop.',
    analytics: 'Analytics', cancellations: 'Cancellations', invoices: 'Invoices', payments: 'Payments', reviews: 'Reviews', offers: 'Offers', verification: 'Verification',
    retry: 'Try again', loading: 'Loading…', noShop: 'Select a shop to view its business data.',
    appointments: 'Appointments', completed: 'Completed', collected: 'Recorded collections', estimate: 'Estimated service value', noPayments: 'No payments have been recorded yet.',
    cancellationsInPeriod: 'Cancellations in period', cancellationRate: 'Cancellation rate', liveQueueSeparate: 'Live Queue (separate)', noCancellations: 'No cancellations in this period.',
    noInvoices: 'No invoices yet', invoiceDetail: 'Invoice details', amountPaid: 'Recorded paid', balanceDue: 'Balance due', backToInvoices: 'Back to invoices',
    noPaymentsRows: 'No recorded payments in this period.', received: 'Received', refunded: 'Refunded', net: 'Net recorded',
    noReviews: 'No reviews yet', replyPlaceholder: 'Write a response to this review', saveReply: 'Save response', responseSaved: 'Response saved',
    noOffers: 'No offers yet', offerPanelTitle: 'Offers, promotions and daily deals', offerTypeOption: 'Offer', promotionTypeOption: 'Promotion', dailyDealTypeOption: 'Daily deal', percentOption: 'Percent', flatOption: 'Fixed amount', allAudienceOption: 'All', newAudienceOption: 'New', repeatAudienceOption: 'Repeat', inactiveAudienceOption: 'Inactive', previewLimited: 'This preview covers the first 100 of {count} active services.', offersUnavailable: 'Offers are not enabled for this shop on the current backend.', createOffer: 'Create an offer', editOffer: 'Edit', previewPrices: 'Preview prices', saveDraft: 'Save as draft', saveChanges: 'Save changes', checkPrices: 'Check prices', offerTitle: 'Offer name', offerDescription: 'Description (optional)', offerKind: 'Offer type', discountType: 'Discount type', discountValueLabel: 'Discount value', audience: 'Who can use it', inactiveDays: 'Days since last visit', startsAt: 'Starts in shop timezone', endsAt: 'Ends in shop timezone', maxRedemptions: 'Total uses allowed (optional)', perCustomerLimit: 'Uses per customer', services: 'Services', allActiveServices: 'No service selection includes every active service.', offerTimezoneUnavailable: 'Set the shop timezone before creating or editing offers.', pauseBeforeEdit: 'Pause this offer before editing it.', offerSafetyNote: 'Saving only creates or updates a draft. FastQue checks prices; this does not collect payment or message customers.', noActiveServices: 'No active services are available.', publish: 'Publish', pause: 'Pause', publishingTitle: 'Publish this offer?', publishingMessage: 'The offer will become available according to its dates and eligibility rules.', confirm: 'Publish offer', cancel: 'Cancel',
    noVerification: 'No verification request has been submitted.', verificationPending: 'Under review', evidenceNotes: 'Evidence notes', evidenceUrl: 'Hosted HTTPS evidence URL (optional)', submitVerification: 'Submit for review',
    serviceBreakdown: 'Estimated service value by service', staffBreakdown: 'Completed work by staff', noEstimate: 'No completed service value in this range.', anonymous: 'Customer not named', outstanding: 'Outstanding', waived: 'Waived', settled: 'Settled', reason: 'Reason', cancelledBy: 'Cancelled by',
    sevenDays: '7 days', thirtyDays: '30 days', ninetyDays: '90 days', status: 'Status', offerDiscount: 'Discount', redemption: 'Redemptions', estimateNote: 'Estimated from completed services at listed prices; this is not recorded cash or audited revenue.',
    error: 'Could not load this section.', timezoneUnavailable: 'The shop timezone is not configured. Set it before filtering payments by date.', verificationSubmitted: 'Verification request submitted.',
  },
  hi: {
    title: 'व्यवसाय केंद्र', subtitle: 'चुनी गई दुकान की रिपोर्ट और कार्य।',
    analytics: 'विश्लेषण', cancellations: 'रद्दीकरण', invoices: 'इनवॉइस', payments: 'भुगतान', reviews: 'समीक्षाएँ', offers: 'ऑफ़र', verification: 'सत्यापन',
    retry: 'फिर कोशिश करें', loading: 'लोड हो रहा है…', noShop: 'दुकान का डेटा देखने के लिए दुकान चुनें।',
    appointments: 'अपॉइंटमेंट', completed: 'पूरे हुए', collected: 'दर्ज की गई प्राप्तियाँ', estimate: 'अनुमानित सेवा मूल्य', noPayments: 'अभी तक कोई भुगतान दर्ज नहीं है।',
    cancellationsInPeriod: 'इस अवधि के रद्दीकरण', cancellationRate: 'रद्दीकरण दर', liveQueueSeparate: 'लाइव कतार (अलग)', noCancellations: 'इस अवधि में कोई रद्दीकरण नहीं।',
    noInvoices: 'अभी कोई इनवॉइस नहीं', invoiceDetail: 'इनवॉइस विवरण', amountPaid: 'दर्ज भुगतान', balanceDue: 'बाकी राशि', backToInvoices: 'इनवॉइस पर वापस',
    noPaymentsRows: 'इस अवधि में कोई भुगतान दर्ज नहीं।', received: 'प्राप्त', refunded: 'वापस किया', net: 'कुल दर्ज राशि',
    noReviews: 'अभी कोई समीक्षा नहीं', replyPlaceholder: 'इस समीक्षा का उत्तर लिखें', saveReply: 'उत्तर सहेजें', responseSaved: 'उत्तर सहेजा गया',
    noOffers: 'अभी कोई ऑफ़र नहीं', offerPanelTitle: 'ऑफ़र, प्रमोशन और दैनिक डील', offerTypeOption: 'ऑफ़र', promotionTypeOption: 'प्रमोशन', dailyDealTypeOption: 'दैनिक डील', percentOption: 'प्रतिशत', flatOption: 'निश्चित राशि', allAudienceOption: 'सभी', newAudienceOption: 'नए', repeatAudienceOption: 'नियमित', inactiveAudienceOption: 'निष्क्रिय', previewLimited: 'यह पूर्वावलोकन {count} सक्रिय सेवाओं में से पहली 100 को शामिल करता है।', offersUnavailable: 'इस दुकान के लिए वर्तमान बैकएंड पर ऑफ़र उपलब्ध नहीं हैं।', createOffer: 'ऑफ़र बनाएँ', editOffer: 'संपादित करें', previewPrices: 'कीमत देखें', saveDraft: 'ड्राफ़्ट सहेजें', saveChanges: 'बदलाव सहेजें', checkPrices: 'कीमत जाँचें', offerTitle: 'ऑफ़र का नाम', offerDescription: 'विवरण (वैकल्पिक)', offerKind: 'ऑफ़र प्रकार', discountType: 'छूट का प्रकार', discountValueLabel: 'छूट का मूल्य', audience: 'कौन उपयोग कर सकता है', inactiveDays: 'आख़िरी विज़िट के बाद दिन', startsAt: 'दुकान के समय क्षेत्र में शुरू', endsAt: 'दुकान के समय क्षेत्र में समाप्त', maxRedemptions: 'कुल उपयोग सीमा (वैकल्पिक)', perCustomerLimit: 'प्रति ग्राहक उपयोग', services: 'सेवाएँ', allActiveServices: 'कुछ न चुनने पर सभी सक्रिय सेवाएँ शामिल होंगी।', offerTimezoneUnavailable: 'ऑफ़र बनाने या संपादित करने से पहले दुकान का समय क्षेत्र सेट करें।', pauseBeforeEdit: 'संपादन से पहले इस ऑफ़र को रोकें।', offerSafetyNote: 'सहेजने पर केवल ड्राफ़्ट बनेगा या बदलेगा। कीमत FastQue जाँचेगा; भुगतान या ग्राहक संदेश नहीं भेजा जाता।', noActiveServices: 'कोई सक्रिय सेवा उपलब्ध नहीं है।', publish: 'प्रकाशित करें', pause: 'रोकें', publishingTitle: 'यह ऑफ़र प्रकाशित करें?', publishingMessage: 'तारीख और पात्रता नियमों के अनुसार ऑफ़र उपलब्ध हो जाएगा।', confirm: 'ऑफ़र प्रकाशित करें', cancel: 'रद्द करें',
    noVerification: 'कोई सत्यापन अनुरोध जमा नहीं है।', verificationPending: 'समीक्षा जारी है', evidenceNotes: 'साक्ष्य विवरण', evidenceUrl: 'होस्ट किया HTTPS साक्ष्य URL (वैकल्पिक)', submitVerification: 'समीक्षा हेतु जमा करें',
    serviceBreakdown: 'सेवा के अनुसार अनुमानित मूल्य', staffBreakdown: 'कर्मचारी के पूरे किए कार्य', noEstimate: 'इस अवधि में कोई पूर्ण सेवा मूल्य नहीं।', anonymous: 'ग्राहक का नाम उपलब्ध नहीं', outstanding: 'बाकी', waived: 'माफ़', settled: 'निपटाया', reason: 'कारण', cancelledBy: 'रद्द करने वाला',
    sevenDays: '7 दिन', thirtyDays: '30 दिन', ninetyDays: '90 दिन', status: 'स्थिति', offerDiscount: 'छूट', redemption: 'रिडेम्पशन', estimateNote: 'पूरी सेवाओं की सूची कीमत से अनुमान; यह दर्ज नकद या ऑडिटेड आय नहीं है।',
    error: 'यह अनुभाग लोड नहीं हो सका।', timezoneUnavailable: 'दुकान का समय क्षेत्र सेट नहीं है। भुगतान की तारीख फ़िल्टर करने से पहले इसे सेट करें।', verificationSubmitted: 'सत्यापन अनुरोध जमा हुआ।',
  },
} as const;

function basePath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
}

function money(value: number, currency: string | null | undefined): string {
  if (!currency) return value.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function salonDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export default function OwnerBusinessScreen() {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { language } = useLanguage();
  const c: Copy = language === Language.HI ? COPY.hi : COPY.en;
  const [panel, setPanel] = useState<Panel>('analytics');
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [analytics, setAnalytics] = useState<OwnerAnalyticsDto | null>(null);
  const [revenue, setRevenue] = useState<OwnerRevenueDto | null>(null);
  const [cancellations, setCancellations] = useState<CancellationAnalyticsDto | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummaryDto[]>([]);
  const [invoice, setInvoice] = useState<InvoiceDetailDto | null>(null);
  const [payments, setPayments] = useState<RecordedPaymentListDto | null>(null);
  const [reviews, setReviews] = useState<OwnerReviewsResponseDto | null>(null);
  const [offers, setOffers] = useState<OfferDto[]>([]);
  const [offersEnabled, setOffersEnabled] = useState(false);
  const [offerTimeZone, setOfferTimeZone] = useState<string | null>(null);
  const [offerServices, setOfferServices] = useState<SalonServiceDto[]>([]);
  const [offerEditor, setOfferEditor] = useState<{ offer: OfferDto | null } | null>(null);
  const offerKeys = useRef(new Map<string, string>());
  const [verification, setVerification] = useState<VerificationRequestDto | null>(null);
  const [evidenceNotes, setEvidenceNotes] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!selectedSalonId) return;
    const requestId = ++requestSeq.current;
    const base = basePath(selectedSalonId);
    setLoading(true);
    setError(null);
    // A shop switch must never leave the previously selected shop's records visible while the
    // new request is pending or after it fails.
    if (panel === 'analytics') { setAnalytics(null); setRevenue(null); }
    else if (panel === 'cancellations') setCancellations(null);
    else if (panel === 'invoices') { setInvoices([]); setInvoice(null); }
    else if (panel === 'payments') setPayments(null);
    else if (panel === 'reviews') setReviews(null);
    else if (panel === 'offers') { setOffersEnabled(false); setOffers([]); setOfferTimeZone(null); setOfferServices([]); setOfferEditor(null); }
    else setVerification(null);
    try {
      if (panel === 'analytics') {
        const [a, r] = await Promise.all([
          apiFetch<OwnerAnalyticsDto>(`${base}/${DASHBOARD_PATHS.analytics}?range=${range === '7d' ? '7d' : '30d'}`),
          apiFetch<OwnerRevenueDto>(`${base}/revenue`),
        ]);
        if (requestId === requestSeq.current) { setAnalytics(a); setRevenue(r); }
      } else if (panel === 'cancellations') {
        const data = await apiFetch<CancellationAnalyticsDto>(`${base}/analytics/cancellations?range=${range}`);
        if (requestId === requestSeq.current) setCancellations(data);
      } else if (panel === 'invoices') {
        const page = await apiFetch<InvoiceListDto>(`${base}/invoices?payment=ALL&limit=30`);
        if (requestId === requestSeq.current) setInvoices(page.items);
      } else if (panel === 'payments') {
        const timezone = await apiFetch<SalonTimezoneResultDto>(`${base}/${DASHBOARD_PATHS.timezone}`);
        const timeZone = timezone.timezone ?? timezone.suggestion?.timezone ?? (timezone.countryCode === 'IN' ? 'Asia/Kolkata' : null);
        if (!timeZone) {
          if (requestId === requestSeq.current) setError(c.timezoneUnavailable);
          return;
        }
        const to = salonDate(new Date(), timeZone);
        const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
        const from = shiftDate(to, -(days - 1));
        const data = await apiFetch<RecordedPaymentListDto>(`${base}/payments?from=${from}&to=${to}&limit=50`);
        if (requestId === requestSeq.current) setPayments(data);
      } else if (panel === 'reviews') {
        const data = await apiFetch<OwnerReviewsResponseDto>(`${base}/${DASHBOARD_PATHS.reviews}?limit=25`);
        if (requestId === requestSeq.current) setReviews(data);
      } else if (panel === 'offers') {
        const caps = await apiFetch<SalonCapabilitiesDto>(`${base}/capabilities`);
        const enabled = caps.features.offers.status === 'ENABLED';
        if (requestId === requestSeq.current) setOffersEnabled(enabled);
        if (!enabled) { if (requestId === requestSeq.current) setOffers([]); return; }
        const page = await apiFetch<OfferPage>(`${base}/offers?limit=50`);
        if (requestId === requestSeq.current) setOffers(page.items);
        try {
          const [timezone, services] = await Promise.all([
            apiFetch<SalonTimezoneResultDto>(base + '/' + DASHBOARD_PATHS.timezone),
            apiFetch<SalonServiceDto[]>(base + '/' + DASHBOARD_PATHS.services),
          ]);
          if (requestId === requestSeq.current) {
            setOfferTimeZone(timezone.timezone ?? null);
            setOfferServices(Array.isArray(services) ? services.filter((service) => service.isActive !== false) : []);
          }
        } catch {
          if (requestId === requestSeq.current) { setOfferTimeZone(null); setOfferServices([]); }
        }
      } else {
        const data = await apiFetch<VerificationRequestDto | null>(`${base}/${DASHBOARD_PATHS.verification}`);
        if (requestId === requestSeq.current) setVerification(data);
      }
    } catch (err) {
      if (requestId === requestSeq.current) setError(err instanceof ApiError ? err.message : c.error);
    } finally {
      if (requestId === requestSeq.current) setLoading(false);
    }
  }, [selectedSalonId, panel, range, c.error]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestSeq.current += 1; };
  }, [load]));

  const openInvoice = async (invoiceId: string) => {
    if (!selectedSalonId) return;
    setBusyId(invoiceId);
    setError(null);
    try {
      setInvoice(await apiFetch<InvoiceDetailDto>(`${basePath(selectedSalonId)}/invoices/${invoiceId}`));
    } catch (err) { setError(err instanceof ApiError ? err.message : c.error); }
    finally { setBusyId(null); }
  };

  const respond = async (reviewId: string) => {
    if (!selectedSalonId) return;
    const ownerResponse = (replies[reviewId] ?? '').trim();
    if (!ownerResponse) return;
    setBusyId(reviewId);
    setError(null);
    try {
      await apiFetch(`${basePath(selectedSalonId)}/${DASHBOARD_PATHS.reviews}/${reviewId}/${DASHBOARD_PATHS.response}`, {
        method: 'PUT', body: JSON.stringify({ ownerResponse }),
      });
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : c.error); }
    finally { setBusyId(null); }
  };

  const changeOfferState = async (offer: OfferDto, action: 'publish' | 'pause') => {
    if (!selectedSalonId) return;
    const run = async () => {
      setBusyId(offer.id);
      setError(null);
      try {
        await apiFetch(`${basePath(selectedSalonId)}/offers/${offer.id}/${action}`, { method: 'POST' });
        await load();
      } catch (err) { setError(err instanceof ApiError ? err.message : c.error); }
      finally { setBusyId(null); }
    };
    if (action === 'publish') {
      Alert.alert(c.publishingTitle, c.publishingMessage, [
        { text: c.cancel, style: 'cancel' },
        { text: c.confirm, onPress: () => { void run(); } },
      ]);
    } else await run();
  };

  const openOfferEditor = (offer: OfferDto | null) => {
    if (!offerTimeZone) { setError(c.offerTimezoneUnavailable); return; }
    if (offer && offer.status !== 'DRAFT' && offer.status !== 'PAUSED') { setError(c.pauseBeforeEdit); return; }
    setError(null);
    setOfferEditor({ offer });
  };

  const saveOffer = async (offer: OfferDto | null, form: OfferForm, onErrors: (errors: OfferErrors) => void) => {
    if (!selectedSalonId || !offersEnabled || !offerTimeZone) return;
    const result = offer ? buildOfferPatch(offer, form, offerTimeZone) : buildOfferBody(form, offerTimeZone);
    onErrors(result.errors);
    if (Object.keys(result.errors).length) return;
    if (!result.body) { setOfferEditor(null); return; }
    const signature = offer ? 'patch:' + offer.id + ':' + JSON.stringify(result.body) : 'create:' + JSON.stringify(result.body);
    const idempotencyKey = offerKeys.current.get(signature) ?? newIdempotencyKey();
    offerKeys.current.set(signature, idempotencyKey);
    setBusyId('offer');
    setError(null);
    try {
      const path = basePath(selectedSalonId) + '/offers' + (offer ? '/' + offer.id : '');
      await apiFetch<OfferDto>(path, { method: offer ? 'PATCH' : 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(result.body) });
      offerKeys.current.delete(signature);
      setOfferEditor(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : c.error);
    } finally {
      setBusyId(null);
    }
  };

  const submitVerification = async () => {
    if (!selectedSalonId) return;
    const notes = evidenceNotes.trim();
    const url = evidenceUrl.trim();
    if (!notes && !url) { setError(c.evidenceNotes); return; }
    setBusyId('verification');
    setError(null);
    try {
      await apiFetch(`${basePath(selectedSalonId)}/${DASHBOARD_PATHS.verification}`, {
        method: 'POST', body: JSON.stringify({ ...(notes ? { evidenceNotes: notes } : {}), ...(url ? { evidenceUrls: [url] } : {}) }),
      });
      setEvidenceNotes(''); setEvidenceUrl('');
      await load();
      Alert.alert(c.verificationSubmitted);
    } catch (err) { setError(err instanceof ApiError ? err.message : c.error); }
    finally { setBusyId(null); }
  };

  if (!selectedSalonId) return <Screen><EmptyState title={c.noShop} /></Screen>;

  return (
    <Screen refreshing={loading} onRefresh={() => void load()} contentStyle={styles.screen}>
      <SectionHeader eyebrow={selectedSalon?.name ?? 'FastQue'} title={c.title} subtitle={c.subtitle} />
      <View style={styles.tabs}>
        {(['analytics', 'cancellations', 'invoices', 'payments', 'reviews', 'offers', 'verification'] as Panel[]).map((item) => (
          <Pressable key={item} onPress={() => { setPanel(item); setInvoice(null); if (item === 'analytics' && range === '90d') setRange('30d'); }} accessibilityRole="button" accessibilityState={{ selected: panel === item }} style={[styles.tab, panel === item && styles.tabSelected]}>
            <Text style={[styles.tabText, panel === item && styles.tabTextSelected]}>{c[item]}</Text>
          </Pressable>
        ))}
      </View>
      {(panel === 'analytics' || panel === 'cancellations' || panel === 'payments') && (
        <View style={styles.rangeRow}>
          {(panel === 'analytics' ? (['7d', '30d'] as const) : (['7d', '30d', '90d'] as const)).map((item) => (
            <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: range === item }} onPress={() => setRange(item)} style={[styles.range, range === item && styles.rangeSelected]}>
              <Text style={[styles.rangeText, range === item && styles.rangeTextSelected]}>{item === '7d' ? c.sevenDays : item === '30d' ? c.thirtyDays : c.ninetyDays}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!!error && <InlineError message={error} />}
      {loading ? <Text style={styles.muted}>{c.loading}</Text> : error ? <Button title={c.retry} variant="outline" onPress={() => void load()} style={styles.retry} /> : (
        <>
          {panel === 'analytics' && analytics && <AnalyticsPanel data={analytics} revenue={revenue} c={c} />}
          {panel === 'cancellations' && cancellations && <CancellationPanel data={cancellations} c={c} />}
          {panel === 'invoices' && <InvoicePanel items={invoices} invoice={invoice} onOpen={openInvoice} onBack={() => setInvoice(null)} busyId={busyId} c={c} />}
          {panel === 'payments' && payments && <PaymentsPanel data={payments} c={c} />}
          {panel === 'reviews' && <ReviewPanel data={reviews} replies={replies} setReplies={setReplies} onRespond={respond} busyId={busyId} c={c} />}
          {panel === 'offers' && <OffersPanel enabled={offersEnabled} items={offers} busyId={busyId} onAction={changeOfferState} timeZone={offerTimeZone} services={offerServices} editor={offerEditor} base={basePath(selectedSalonId)} onCreate={() => openOfferEditor(null)} onEdit={openOfferEditor} onCancelEdit={() => setOfferEditor(null)} onSave={saveOffer} c={c} />}
          {panel === 'verification' && <VerificationPanel request={verification} notes={evidenceNotes} url={evidenceUrl} setNotes={setEvidenceNotes} setUrl={setEvidenceUrl} onSubmit={submitVerification} busy={busyId === 'verification'} c={c} />}
        </>
      )}
    </Screen>
  );
}

type Copy = { [K in keyof typeof COPY.en]: string };

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <Card style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text>{note ? <Text style={styles.muted}>{note}</Text> : null}</Card>;
}

function AnalyticsPanel({ data, revenue, c }: { data: OwnerAnalyticsDto; revenue: OwnerRevenueDto | null; c: Copy }) {
  const unit = data.currency;
  return <>
    <View style={styles.metrics}>
      <Metric label={c.appointments} value={data.appointmentsBooked} />
      <Metric label={c.completed} value={data.completedCount} />
      <Metric label={c.collected} value={revenue?.hasRecordedPayments ? money(revenue.thisMonth.current, revenue.currency) : '—'} note={revenue?.hasRecordedPayments ? undefined : c.noPayments} />
      <Metric label={c.estimate} value={money(data.estimatedServiceValue, unit)} note={c.estimateNote} />
    </View>
    {revenue && <>
      <Card><Text style={styles.heading}>{c.collected}</Text><Text style={styles.line}>{`Today ${money(revenue.today.current, revenue.currency)} · Week ${money(revenue.thisWeek.current, revenue.currency)} · Month ${money(revenue.thisMonth.current, revenue.currency)}`}</Text><Text style={styles.muted}>{revenue.hasRecordedPayments ? `${c.outstanding}: ${money(revenue.unpaidInvoiceTotal, revenue.currency)} (${revenue.unpaidInvoiceCount})` : c.noPayments}</Text></Card>
      <RevenueSeries title="Recorded collections · daily" points={revenue.daily.slice(-7)} currency={revenue.currency} />
      <RevenueSeries title="Recorded collections · weekly" points={revenue.weekly.slice(-6)} currency={revenue.currency} />
      <RevenueSeries title="Recorded collections · monthly" points={revenue.monthly.slice(-6)} currency={revenue.currency} />
    </>}
    <Card><Text style={styles.heading}>{c.serviceBreakdown}</Text>{data.serviceValue.length ? data.serviceValue.map((s) => <DataLine key={s.serviceId} title={s.name} value={money(s.estimatedServiceValue, unit)} note={`${s.completedCount} · ${c.completed}`} />) : <Text style={styles.muted}>{c.noEstimate}</Text>}</Card>
    <Card><Text style={styles.heading}>{c.staffBreakdown}</Text>{data.barberValue.length ? data.barberValue.map((s) => <DataLine key={s.staffId} title={s.displayName} value={money(s.estimatedServiceValue, unit)} note={`${s.completedSessions} · ${c.completed}`} />) : <Text style={styles.muted}>{c.noEstimate}</Text>}</Card>
  </>;
}

function RevenueSeries({ title, points, currency }: { title: string; points: OwnerRevenueDto['daily']; currency: string | null }) {
  return <Card><Text style={styles.heading}>{title}</Text>{points.length ? points.map((point) => <DataLine key={point.date} title={point.date} value={money(point.amount, currency)} />) : <Text style={styles.muted}>—</Text>}</Card>;
}

function CancellationPanel({ data, c }: { data: CancellationAnalyticsDto; c: Copy }) {
  return <>
    <View style={styles.metrics}>
      <Metric label={c.cancellationsInPeriod} value={data.totalCancellations} />
      <Metric label={c.cancellationRate} value={data.cancellationRatePercent === null ? '—' : `${data.cancellationRatePercent}%`} note={`${data.totalBookings} bookings`} />
      <Metric label={c.liveQueueSeparate} value={`${data.liveQueue.cancelled} / ${data.liveQueue.expired} / ${data.liveQueue.noShow}`} />
    </View>
    {data.rows.length === 0 ? <EmptyState title={c.noCancellations} /> : <Card>{data.rows.map((row) => <DataLine key={row.bookingId} title={row.serviceNames.join(', ') || c.cancellations} value={dateLabel(row.cancelledAt)} note={`${c.cancelledBy}: ${row.actor} · ${c.reason}: ${row.reason ?? '—'}${row.chargeAmount == null ? '' : ` · ${money(row.chargeAmount, data.currency)}`}`} />)}</Card>}
    {data.unattributedCount > 0 && <Text style={styles.muted}>{`${data.unattributedCount} historical records have no cancellation actor recorded.`}</Text>}
  </>;
}

function InvoicePanel({ items, invoice, onOpen, onBack, busyId, c }: { items: InvoiceSummaryDto[]; invoice: InvoiceDetailDto | null; onOpen: (id: string) => void; onBack: () => void; busyId: string | null; c: Copy }) {
  if (invoice) return <>
    <Button title={c.backToInvoices} variant="outline" onPress={onBack} />
    <Card><Text style={styles.heading}>{invoice.number}</Text><Text style={styles.line}>{invoice.customerName ?? c.anonymous} · {dateLabel(invoice.issuedAt)}</Text><Text style={styles.line}>{invoice.status} / {invoice.paymentStatus}</Text><Text style={styles.line}>{`${c.completed}: ${money(invoice.total, invoice.currency)} · ${c.amountPaid}: ${money(invoice.amountPaid, invoice.currency)} · ${c.balanceDue}: ${money(invoice.balanceDue, invoice.currency)}`}</Text></Card>
    <Card>{invoice.lines.map((line) => <DataLine key={line.id} title={line.description} value={money(line.lineTotal, invoice.currency)} note={`${line.quantity} × ${money(line.unitPrice, invoice.currency)}`} />)}</Card>
    <Card><Text style={styles.heading}>{c.payments}</Text>{invoice.payments.length ? invoice.payments.map((p) => <DataLine key={p.id} title={`${p.kind} · ${p.method}`} value={money(p.amount, invoice.currency)} note={dateLabel(p.recordedAt)} />) : <Text style={styles.muted}>{c.noPaymentsRows}</Text>}</Card>
  </>;
  return items.length === 0 ? <EmptyState title={c.noInvoices} /> : <Card>{items.map((item) => <Pressable key={item.id} onPress={() => onOpen(item.id)} accessibilityRole="button" style={styles.invoiceRow}><View style={styles.flex}><Text style={styles.lineStrong}>{item.number} · {item.customerName ?? c.anonymous}</Text><Text style={styles.muted}>{dateLabel(item.issuedAt)} · {item.paymentStatus}</Text></View><Text style={styles.lineStrong}>{money(item.total, item.currency)}</Text>{busyId === item.id && <Text style={styles.muted}>{c.loading}</Text>}</Pressable>)}</Card>;
}

function PaymentsPanel({ data, c }: { data: RecordedPaymentListDto; c: Copy }) {
  return <>
    <View style={styles.metrics}><Metric label={c.received} value={money(data.totals.received, data.currency)} /><Metric label={c.refunded} value={money(data.totals.refunded, data.currency)} /><Metric label={c.net} value={money(data.totals.net, data.currency)} /></View>
    {data.items.length === 0 ? <EmptyState title={c.noPaymentsRows} /> : <Card>{data.items.map((p) => <DataLine key={p.id} title={`${p.invoiceNumber} · ${p.customerName ?? c.anonymous}`} value={`${p.kind === 'REFUND' ? '−' : ''}${money(p.amount, data.currency)}`} note={`${p.method} · ${dateLabel(p.recordedAt)} · ${p.recordedBy}`} />)}</Card>}
  </>;
}

function ReviewPanel({ data, replies, setReplies, onRespond, busyId, c }: { data: OwnerReviewsResponseDto | null; replies: Record<string, string>; setReplies: (value: (previous: Record<string, string>) => Record<string, string>) => void; onRespond: (id: string) => void; busyId: string | null; c: Copy }) {
  if (!data || data.items.length === 0) return <EmptyState title={c.noReviews} />;
  return <>{data.items.map((review) => <Card key={review.id}>
    <Text style={styles.heading}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)} · {review.serviceName}</Text>
    <Text style={styles.muted}>{dateLabel(review.createdAt)} · {review.customerPhone ?? review.customerEmail ?? c.anonymous}</Text>
    {review.comment ? <Text style={styles.line}>{review.comment}</Text> : null}
    {review.ownerResponse ? <Text style={styles.response}>{review.ownerResponse}</Text> : null}
    <TextInput accessibilityLabel={c.replyPlaceholder} placeholder={c.replyPlaceholder} value={replies[review.id] ?? review.ownerResponse ?? ''} onChangeText={(value) => setReplies((previous) => ({ ...previous, [review.id]: value }))} multiline maxLength={1000} style={styles.input} />
    <Button title={busyId === review.id ? c.loading : c.saveReply} disabled={busyId === review.id || !(replies[review.id] ?? review.ownerResponse ?? '').trim()} onPress={() => onRespond(review.id)} />
  </Card>)}</>;
}

function VerificationPanel({ request, notes, url, setNotes, setUrl, onSubmit, busy, c }: { request: VerificationRequestDto | null; notes: string; url: string; setNotes: (value: string) => void; setUrl: (value: string) => void; onSubmit: () => void; busy: boolean; c: Copy }) {
  return <>
    {request ? <Card><Text style={styles.heading}>{request.status === 'SUBMITTED' ? c.verificationPending : request.status}</Text><Text style={styles.muted}>{dateLabel(request.submittedAt)}</Text>{request.reviewNotes ? <Text style={styles.line}>{request.reviewNotes}</Text> : null}{request.evidenceNotes ? <Text style={styles.line}>{request.evidenceNotes}</Text> : null}{request.evidenceUrls.map((item) => <Text key={item} style={styles.muted}>{item}</Text>)}</Card> : <EmptyState title={c.noVerification} />}
    {(!request || request.status === 'REJECTED') && <Card>
      <Text style={styles.heading}>{c.submitVerification}</Text>
      <TextInput accessibilityLabel={c.evidenceNotes} placeholder={c.evidenceNotes} value={notes} onChangeText={setNotes} multiline maxLength={2000} style={styles.input} />
      <TextInput accessibilityLabel={c.evidenceUrl} placeholder={c.evidenceUrl} value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" style={styles.input} />
      <Text style={styles.muted}>Only use HTTPS links you are authorized to share with FastQue reviewers.</Text>
      <Button title={busy ? c.loading : c.submitVerification} onPress={onSubmit} disabled={busy || (!notes.trim() && !url.trim())} />
    </Card>}
  </>;
}

function DataLine({ title, value, note }: { title: string; value: string; note?: string }) {
  return <View style={styles.dataLine}><View style={styles.flex}><Text style={styles.lineStrong}>{title}</Text>{note ? <Text style={styles.muted}>{note}</Text> : null}</View><Text style={styles.lineStrong}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { gap: space[3] },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[2] },
  tab: { borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: color.surface },
  tabSelected: { backgroundColor: color.ink, borderColor: color.ink },
  tabText: { color: color.ink, fontFamily: font.bodySemiBold, fontSize: fontSize.xs },
  tabTextSelected: { color: color.surface },
  rangeRow: { flexDirection: 'row', gap: space[2] },
  range: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2] },
  rangeSelected: { borderColor: color.accent, backgroundColor: color.accentSoft },
  rangeText: { color: color.ink, fontFamily: font.bodyMedium, fontSize: fontSize.xs },
  rangeTextSelected: { color: color.accent, fontFamily: font.bodyBold },
  metrics: { gap: space[3] },
  metric: { padding: space[4] },
  metricLabel: { fontFamily: font.bodyMedium, color: color.muted, fontSize: fontSize.xs },
  metricValue: { fontFamily: font.displaySemiBold, color: color.ink, fontSize: fontSize.xl, marginTop: space[1] },
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[2] },
  line: { fontFamily: font.bodyRegular, color: color.ink, fontSize: fontSize.sm, marginVertical: space[1] },
  lineStrong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginTop: space[1] },
  response: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.accentSoft, padding: space[3], borderRadius: radius.sm, marginTop: space[2] },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginTop: space[2], marginBottom: space[2], textAlignVertical: 'top' },
  dataLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], paddingVertical: space[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  invoiceRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  flex: { flex: 1 }, action: { marginTop: space[3] }, retry: { marginTop: space[3] },
});
