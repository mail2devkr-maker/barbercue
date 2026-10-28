import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  OFFER_AUDIENCES,
  OFFER_DISCOUNT_TYPES,
  OFFER_KINDS,
  formatMoney,
  type CreateOfferInput,
  type OfferDto,
  type OfferPreviewDto,
  type OfferRedemptionStatsDto,
  type SalonServiceDto,
  type SalonTimezoneResultDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { useLanguage } from '../../lib/language-context';
import { useSalon } from '../../lib/salon-context';
import {
  buildOwnerOfferBody,
  canPreviewOwnerOffer,
  effectiveOwnerOfferStatus,
  EMPTY_OWNER_OFFER_FORM,
  ownerOfferFormFromDto,
  ownerOfferIsoToLocal,
  ownerOfferTimeText,
  ownerOffersListPath,
  ownerOffersRootPath,
  type OwnerOfferForm,
  type OwnerOfferPage,
} from '../../lib/owner-offers';
import { InlineError, PremiumCard, PremiumScreen, PremiumSectionHeader } from '../../components/ui';
import { fastQue, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Props = NativeStackScreenProps<OwnerShopStackParamList, 'OwnerOffers'>;

const COPY = {
  EN: {
    title: 'Offers & promotions', subtitle: 'Manage offers, promotions and daily deals for online bookings.',
    noShop: 'Choose a shop to manage offers.', loading: 'Loading offers…', retry: 'Could not load offers. Please try again.',
    create: 'Create draft', yourOffers: 'Your offers', kind: 'Type', status: 'Status', allTypes: 'All types', anyStatus: 'Any status',
    noOffers: 'No offers yet. Create a draft, preview its prices, then publish when ready.', noMatches: 'No offers match these filters.',
    clearFilters: 'Clear filters', loadMore: 'Load more', loadingMore: 'Loading…', edit: 'Edit', preview: 'Price preview', stats: 'Redemption stats',
    publish: 'Publish', pause: 'Pause', draft: 'Draft', active: 'Active', paused: 'Paused', expired: 'Expired',
    offer: 'Offer', promotion: 'Promotion', dailyDeal: 'Daily deal', name: 'Name', description: 'Description (optional)',
    percent: 'Percent off', flat: 'Fixed amount off', discount: 'Discount value', audience: 'Who can use it', all: 'All customers',
    new: 'New customers', repeat: 'Returning customers', inactive: 'Inactive customers', inactiveDays: 'Days since last visit',
    starts: 'Starts (shop time)', ends: 'Ends (shop time)', dateHint: 'Use YYYY-MM-DDTHH:mm in the shop timezone.',
    maxRedemptions: 'Total redemption limit (optional)', perCustomerLimit: 'Per-customer limit', services: 'Services', allServices: 'All active services',
    saveDraft: 'Save draft', updateDraft: 'Save changes', cancel: 'Cancel', checking: 'Checking…', saving: 'Saving…',
    allRequired: 'Set the shop timezone and add at least one active service before creating offers.',
    previewNote: 'Arithmetic preview only. The server decides eligibility when a customer books; this does not charge or message anyone.',
    publishTitle: 'Publish this offer?', pauseTitle: 'Pause this offer?', publishConfirm: 'Eligible customers can see and use this offer while its dates are valid. No payment is collected and no message is sent.',
    pauseConfirm: 'Customers can no longer use this offer until it is published again. Existing booking prices are unchanged.',
    yesPublish: 'Publish', yesPause: 'Pause', nothingChanged: 'Cancel',
    noActiveServices: 'No active services are available for a price preview.', tooManyServices: 'Price preview supports up to 100 services. Offers can still apply to all active services in larger catalogs.',
    successCreate: 'Draft saved. Customers cannot see it until it is published.', successUpdate: 'Draft updated.',
    successPublish: 'Offer published.', successPause: 'Offer paused.',
    count: 'redemptions', customers: 'customers', completed: 'completed', cancelled: 'cancelled', recordedDiscount: 'recorded discount',
    allCustomersHint: 'Any signed-in customer may use it if the booking meets the rules.', newHint: 'For accounts with no completed visit at this shop.',
    repeatHint: 'For accounts with at least one completed visit at this shop.', inactiveHint: 'Based on the last completed visit at this shop.',
    unlimited: 'No total limit',
  },
  HI: {
    title: 'ऑफ़र और प्रचार', subtitle: 'ऑनलाइन बुकिंग के लिए ऑफ़र, प्रचार और दैनिक डील प्रबंधित करें।',
    noShop: 'ऑफ़र प्रबंधित करने के लिए दुकान चुनें।', loading: 'ऑफ़र लोड हो रहे हैं…', retry: 'ऑफ़र लोड नहीं हो सके। फिर से प्रयास करें।',
    create: 'ड्राफ़्ट बनाएँ', yourOffers: 'आपके ऑफ़र', kind: 'प्रकार', status: 'स्थिति', allTypes: 'सभी प्रकार', anyStatus: 'कोई भी स्थिति',
    noOffers: 'अभी कोई ऑफ़र नहीं है। ड्राफ़्ट बनाएँ, कीमतें देखें और तैयार होने पर प्रकाशित करें।', noMatches: 'इन फ़िल्टर से कोई ऑफ़र नहीं मिला।',
    clearFilters: 'फ़िल्टर हटाएँ', loadMore: 'और देखें', loadingMore: 'लोड हो रहा है…', edit: 'संपादित करें', preview: 'कीमत देखें', stats: 'रिडेम्पशन आँकड़े',
    publish: 'प्रकाशित करें', pause: 'रोकें', draft: 'ड्राफ़्ट', active: 'सक्रिय', paused: 'रोका गया', expired: 'समाप्त',
    offer: 'ऑफ़र', promotion: 'प्रचार', dailyDeal: 'दैनिक डील', name: 'नाम', description: 'विवरण (वैकल्पिक)',
    percent: 'प्रतिशत छूट', flat: 'निश्चित राशि की छूट', discount: 'छूट का मान', audience: 'कौन उपयोग कर सकता है', all: 'सभी ग्राहक',
    new: 'नए ग्राहक', repeat: 'वापस आने वाले ग्राहक', inactive: 'निष्क्रिय ग्राहक', inactiveDays: 'अंतिम विज़िट से दिन',
    starts: 'शुरू (दुकान का समय)', ends: 'समाप्त (दुकान का समय)', dateHint: 'दुकान के समय में YYYY-MM-DDTHH:mm लिखें।',
    maxRedemptions: 'कुल उपयोग सीमा (वैकल्पिक)', perCustomerLimit: 'प्रति ग्राहक सीमा', services: 'सेवाएँ', allServices: 'सभी सक्रिय सेवाएँ',
    saveDraft: 'ड्राफ़्ट सहेजें', updateDraft: 'बदलाव सहेजें', cancel: 'रद्द करें', checking: 'जाँच हो रही है…', saving: 'सहेज रहे हैं…',
    allRequired: 'ऑफ़र बनाने से पहले दुकान का समय क्षेत्र सेट करें और कम से कम एक सक्रिय सेवा जोड़ें।',
    previewNote: 'यह केवल गणना का पूर्वावलोकन है। बुकिंग के समय सर्वर पात्रता तय करता है; इससे कोई भुगतान या संदेश नहीं होता।',
    publishTitle: 'यह ऑफ़र प्रकाशित करें?', pauseTitle: 'यह ऑफ़र रोकें?', publishConfirm: 'पात्र ग्राहक मान्य तारीख़ों में इसे देख और उपयोग कर सकते हैं। भुगतान या संदेश नहीं होगा।',
    pauseConfirm: 'दोबारा प्रकाशित होने तक ग्राहक इसका उपयोग नहीं कर पाएँगे। मौजूदा बुकिंग की कीमत नहीं बदलेगी।',
    yesPublish: 'प्रकाशित करें', yesPause: 'रोकें', nothingChanged: 'रद्द करें',
    noActiveServices: 'कीमत देखने के लिए कोई सक्रिय सेवा नहीं है।', tooManyServices: 'कीमत पूर्वावलोकन 100 सेवाओं तक समर्थित है। बड़े कैटलॉग में ऑफ़र फिर भी सभी सक्रिय सेवाओं पर लागू हो सकते हैं।',
    successCreate: 'ड्राफ़्ट सहेजा गया। प्रकाशित होने तक ग्राहक इसे नहीं देखेंगे।', successUpdate: 'ड्राफ़्ट अपडेट हुआ।',
    successPublish: 'ऑफ़र प्रकाशित हुआ।', successPause: 'ऑफ़र रोक दिया गया।',
    count: 'उपयोग', customers: 'ग्राहक', completed: 'पूरी हुई', cancelled: 'रद्द', recordedDiscount: 'दर्ज छूट',
    allCustomersHint: 'बुकिंग नियम पूरे होने पर कोई भी साइन-इन ग्राहक उपयोग कर सकता है।', newHint: 'जिन खातों की इस दुकान में पूरी हुई विज़िट नहीं है।',
    repeatHint: 'जिन खातों की इस दुकान में कम से कम एक पूरी हुई विज़िट है।', inactiveHint: 'इस दुकान की आख़िरी पूरी हुई विज़िट पर आधारित।',
    unlimited: 'कोई कुल सीमा नहीं',
  },
} as const;

export default function OwnerOffersScreen(_props: Props) {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { language } = useLanguage();
  const text = language === 'HI' ? COPY.HI : COPY.EN;
  const [items, setItems] = useState<OfferDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [services, setServices] = useState<SalonServiceDto[]>([]);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OfferDto | null>(null);
  const [form, setForm] = useState<OwnerOfferForm>(EMPTY_OWNER_OFFER_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OfferPreviewDto | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [stats, setStats] = useState<Record<string, OfferRedemptionStatsDto | null>>({});
  const [savedPreviews, setSavedPreviews] = useState<Record<string, OfferPreviewDto | null>>({});
  const [statsLoading, setStatsLoading] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const previewRequestSequence = useRef(0);
  const idempotencyKeys = useRef(new Map<string, string>());

  useEffect(() => {
    previewRequestSequence.current += 1;
    setFormOpen(false);
    setEditing(null);
    setForm(EMPTY_OWNER_OFFER_FORM);
    setPreview(null);
    setPreviewBusy(false);
    setStats({});
    setSavedPreviews({});
  }, [selectedSalonId]);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (!selectedSalonId) {
      setItems([]);
      setServices([]);
      setTimeZone(null);
      setNextCursor(null);
      setError(null);
      setLoading(false);
      setContextLoading(false);
      return;
    }
    setLoading(true);
    setContextLoading(true);
    setLoadingMore(false);
    setError(null);
    setNotice(null);
    const base = ownerOffersRootPath(selectedSalonId);
    const [pageResult, contextResult] = await Promise.allSettled([
      apiFetch<OwnerOfferPage>(ownerOffersListPath(selectedSalonId, { kind, status })),
      Promise.all([
        apiFetch<SalonTimezoneResultDto>(`${base.replace(/\/offers$/, '')}/timezone`),
        apiFetch<SalonServiceDto[]>(`${base.replace(/\/offers$/, '')}/services`),
      ]),
    ]);
    if (sequence !== requestSequence.current) return;
    if (pageResult.status === 'fulfilled') {
      setItems(pageResult.value.items);
      setNextCursor(pageResult.value.nextCursor);
    } else {
      setItems([]);
      setNextCursor(null);
      setError(pageResult.reason instanceof ApiError ? pageResult.reason.message : text.retry);
    }
    if (contextResult.status === 'fulfilled') {
      setTimeZone(contextResult.value[0].timezone);
      setServices(contextResult.value[1].filter((service) => service.isActive));
    } else {
      setTimeZone(null);
      setServices([]);
      if (pageResult.status === 'fulfilled') setError(contextResult.reason instanceof ApiError ? contextResult.reason.message : text.retry);
    }
    setLoading(false);
    setContextLoading(false);
  }, [kind, selectedSalonId, status, text.retry]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]));

  const openCreate = () => {
    if (!timeZone) return;
    previewRequestSequence.current += 1;
    const now = Date.now();
    setEditing(null);
    setForm({
      ...EMPTY_OWNER_OFFER_FORM,
      validFrom: ownerOfferIsoToLocal(new Date(now + 15 * 60_000).toISOString(), timeZone),
      validTo: ownerOfferIsoToLocal(new Date(now + 7 * 24 * 60 * 60_000).toISOString(), timeZone),
    });
    setPreview(null);
    setPreviewBusy(false);
    setFormError(null);
    setFormOpen(true);
    setNotice(null);
  };

  const openEdit = (offer: OfferDto) => {
    if (!timeZone) return;
    previewRequestSequence.current += 1;
    setEditing(offer);
    setForm(ownerOfferFormFromDto(offer, timeZone));
    setPreview(null);
    setPreviewBusy(false);
    setFormError(null);
    setFormOpen(true);
    setNotice(null);
  };

  const changeForm = (patch: Partial<OwnerOfferForm>) => {
    previewRequestSequence.current += 1;
    setForm((current) => ({ ...current, ...patch }));
    setFormError(null);
    setPreview(null);
    setPreviewBusy(false);
  };

  const loadMore = async () => {
    if (!selectedSalonId || !nextCursor || loadingMore) return;
    const sequence = requestSequence.current;
    setLoadingMore(true);
    try {
      const page = await apiFetch<OwnerOfferPage>(ownerOffersListPath(selectedSalonId, { kind, status, cursor: nextCursor }));
      if (sequence !== requestSequence.current) return;
      setItems((current) => {
        const known = new Set(current.map((offer) => offer.id));
        return [...current, ...page.items.filter((offer) => !known.has(offer.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (sequence === requestSequence.current) setError(err instanceof ApiError ? err.message : text.retry);
    } finally {
      if (sequence === requestSequence.current) setLoadingMore(false);
    }
  };

  const idempotencyKey = (signature: string) => {
    const existing = idempotencyKeys.current.get(signature);
    if (existing) return existing;
    const fresh = newIdempotencyKey();
    idempotencyKeys.current.set(signature, fresh);
    return fresh;
  };

  const runMutation = async (signature: string, path: string, method: 'POST' | 'PATCH', body: unknown, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch<OfferDto>(path, {
        method,
        headers: { 'Idempotency-Key': idempotencyKey(signature) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      idempotencyKeys.current.delete(signature);
      setFormOpen(false);
      setEditing(null);
      await load();
      setNotice(success);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The request did not complete. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!selectedSalonId || !timeZone) return;
    const result = buildOwnerOfferBody(form, timeZone);
    if (!result.body) {
      setFormError(result.error ?? 'Check the offer details.');
      return;
    }
    const body: CreateOfferInput = result.body;
    const signature = `${editing ? `update:${editing.id}` : 'create'}:${JSON.stringify(body)}`;
    const path = editing ? `${ownerOffersRootPath(selectedSalonId)}/${editing.id}` : ownerOffersRootPath(selectedSalonId);
    await runMutation(signature, path, editing ? 'PATCH' : 'POST', body, editing ? text.successUpdate : text.successCreate);
  };

  const checkDraftPrices = async () => {
    if (!selectedSalonId || !timeZone) return;
    if (!canPreviewOwnerOffer(form.serviceIds, services.length)) {
      setFormError(services.length ? text.tooManyServices : text.noActiveServices);
      return;
    }
    const result = buildOwnerOfferBody(form, timeZone);
    if (!result.body) {
      setFormError(result.error ?? 'Check the offer details.');
      return;
    }
    setFormError(null);
    const sequence = ++previewRequestSequence.current;
    const salonId = selectedSalonId;
    setPreviewBusy(true);
    setPreview(null);
    try {
      const resultPreview = await apiFetch<OfferPreviewDto>(`${ownerOffersRootPath(salonId)}/preview`, {
        method: 'POST', body: JSON.stringify(result.body),
      });
      if (sequence === previewRequestSequence.current) setPreview(resultPreview);
    } catch (err) {
      if (sequence === previewRequestSequence.current) setFormError(err instanceof ApiError ? err.message : 'Could not preview these prices.');
    } finally {
      if (sequence === previewRequestSequence.current) setPreviewBusy(false);
    }
  };

  const showSavedPreview = async (offer: OfferDto) => {
    if (!selectedSalonId) return;
    if (!canPreviewOwnerOffer(offer.serviceIds, services.length)) {
      setError(services.length ? text.tooManyServices : text.noActiveServices);
      return;
    }
    const sequence = requestSequence.current;
    const ids = offer.serviceIds.length ? offer.serviceIds : services.slice(0, 100).map((service) => service.id);
    if (!ids.length) {
      setError(text.noActiveServices);
      return;
    }
    setSavedPreviews((current) => ({ ...current, [offer.id]: null }));
    setStatsLoading(`preview:${offer.id}`);
    setError(null);
    try {
      const result = await apiFetch<OfferPreviewDto>(`${ownerOffersRootPath(selectedSalonId)}/${offer.id}/preview`, {
        method: 'POST', body: JSON.stringify({ serviceIds: ids }),
      });
      if (sequence === requestSequence.current) setSavedPreviews((current) => ({ ...current, [offer.id]: result }));
    } catch (err) {
      if (sequence === requestSequence.current) setError(err instanceof ApiError ? err.message : 'Could not preview these prices.');
    } finally {
      if (sequence === requestSequence.current) setStatsLoading(null);
    }
  };

  const showStats = async (offer: OfferDto) => {
    if (!selectedSalonId) return;
    const sequence = requestSequence.current;
    setStatsLoading(offer.id);
    setError(null);
    try {
      const result = await apiFetch<OfferRedemptionStatsDto>(`${ownerOffersRootPath(selectedSalonId)}/${offer.id}/stats`);
      if (sequence === requestSequence.current) setStats((current) => ({ ...current, [offer.id]: result }));
    } catch (err) {
      if (sequence === requestSequence.current) setError(err instanceof ApiError ? err.message : 'Could not load redemption statistics.');
    } finally {
      if (sequence === requestSequence.current) setStatsLoading(null);
    }
  };

  const askStatusChange = (offer: OfferDto, action: 'publish' | 'pause') => {
    if (!selectedSalonId) return;
    const publish = action === 'publish';
    Alert.alert(
      publish ? text.publishTitle : text.pauseTitle,
      publish ? text.publishConfirm : text.pauseConfirm,
      [
        { text: text.nothingChanged, style: 'cancel' },
        {
          text: publish ? text.yesPublish : text.yesPause,
          style: publish ? 'default' : 'destructive',
          onPress: () => {
            const signature = `${action}:${offer.id}`;
            void runMutation(signature, `${ownerOffersRootPath(selectedSalonId)}/${offer.id}/${action}`, 'POST', undefined, publish ? text.successPublish : text.successPause);
          },
        },
      ],
    );
  };

  const noSalon = !selectedSalonId;

  return (
    <PremiumScreen refreshing={loading} onRefresh={() => void load()}>
      <PremiumSectionHeader eyebrow={selectedSalon?.name} title={text.title} subtitle={text.subtitle} />
      {noSalon ? <Text style={styles.muted}>{text.noShop}</Text> : (
        <>
          {error ? <InlineError message={error} /> : null}
          {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
          <PremiumCard strong style={styles.explainer}>
            <Text style={styles.cardTitle}>{text.yourOffers}</Text>
            <Text style={styles.muted}>{text.previewNote}</Text>
            <View style={styles.filterGroup}>
              <Text style={styles.fieldLabel}>{text.kind}</Text>
              <Choice label={text.allTypes} selected={!kind} onPress={() => setKind('')} />
              {OFFER_KINDS.map((value) => <Choice key={value} label={kindLabel(value, text)} selected={kind === value} onPress={() => setKind(kind === value ? '' : value)} />)}
            </View>
            <View style={styles.filterGroup}>
              <Text style={styles.fieldLabel}>{text.status}</Text>
              <Choice label={text.anyStatus} selected={!status} onPress={() => setStatus('')} />
              {(['DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED'] as const).map((value) => <Choice key={value} label={statusLabel(value, text)} selected={status === value} onPress={() => setStatus(status === value ? '' : value)} />)}
            </View>
            {kind || status ? <Action label={text.clearFilters} onPress={() => { setKind(''); setStatus(''); }} /> : null}
            <Action label={text.create} onPress={openCreate} disabled={!timeZone || contextLoading || formOpen} primary />
            {!contextLoading && !timeZone ? <Text style={styles.warning}>{text.allRequired}</Text> : null}
          </PremiumCard>

          {formOpen && timeZone ? (
            <OfferEditor
              form={form}
              editing={Boolean(editing)}
              services={services}
              timeZone={timeZone}
              preview={preview}
              previewBusy={previewBusy}
              formError={formError}
              busy={busy}
              text={text}
              onChange={changeForm}
              onPreview={() => void checkDraftPrices()}
              onSave={() => void saveDraft()}
              onCancel={() => { previewRequestSequence.current += 1; setFormOpen(false); setEditing(null); setPreview(null); setPreviewBusy(false); setFormError(null); }}
            />
          ) : null}

          {loading ? <Text style={styles.muted}>{text.loading}</Text> : items.length === 0 ? (
            <Text style={styles.muted}>{kind || status ? text.noMatches : text.noOffers}</Text>
          ) : items.map((offer) => {
            const currentStatus = effectiveOwnerOfferStatus(offer);
            const offerStats = stats[offer.id];
            const savedPreview = savedPreviews[offer.id];
            return (
              <PremiumCard key={offer.id} style={styles.offerCard}>
                <View style={styles.headingRow}>
                  <Text style={styles.offerTitle}>{offer.title}</Text>
                  <Text style={[styles.badge, currentStatus === 'ACTIVE' ? styles.activeBadge : currentStatus === 'PAUSED' ? styles.pausedBadge : styles.draftBadge]}>{statusLabel(currentStatus, text)}</Text>
                </View>
                <Text style={styles.offerMeta}>{kindLabel(offer.kind, text)} · {discountText(offer)} · {audienceText(offer.audience, text)}</Text>
                {timeZone ? <Text style={styles.muted}>{ownerOfferTimeText(offer.validFrom, timeZone, language)} – {ownerOfferTimeText(offer.validTo, timeZone, language)}</Text> : null}
                <Text style={styles.muted}>{offer.redemptionCount} {text.count} · {offer.maxRedemptions === null ? text.unlimited : `${offer.redemptionCount}/${offer.maxRedemptions}`} · {offer.serviceIds.length ? `${offer.serviceIds.length} ${text.services.toLowerCase()}` : text.allServices}</Text>
                <View style={styles.actions}>
                  {(currentStatus === 'DRAFT' || currentStatus === 'PAUSED') && timeZone ? <Action label={text.edit} onPress={() => openEdit(offer)} disabled={busy || formOpen} /> : null}
                  <Action label={statsLoading === `preview:${offer.id}` ? text.checking : text.preview} onPress={() => void showSavedPreview(offer)} disabled={Boolean(statsLoading) || !canPreviewOwnerOffer(offer.serviceIds, services.length)} />
                  <Action label={statsLoading === offer.id ? text.checking : text.stats} onPress={() => void showStats(offer)} disabled={Boolean(statsLoading)} />
                  {currentStatus === 'DRAFT' || currentStatus === 'PAUSED' ? <Action label={text.publish} onPress={() => askStatusChange(offer, 'publish')} disabled={busy} primary /> : null}
                  {currentStatus === 'ACTIVE' ? <Action label={text.pause} onPress={() => askStatusChange(offer, 'pause')} disabled={busy} /> : null}
                </View>
                {statsLoading === `preview:${offer.id}` ? <Text style={styles.muted}>{text.checking}</Text> : savedPreview ? <PreviewSummary preview={savedPreview} text={text} /> : null}
                {offerStats ? <Text style={styles.muted}>{offerStats.redemptionCount} {text.count} · {offerStats.uniqueCustomers} {text.customers} · {offerStats.completedBookings} {text.completed} · {offerStats.cancelledBookings} {text.cancelled} · {text.recordedDiscount}: {formatMoney(offerStats.recordedDiscount, offerStats.currency)}</Text> : null}
              </PremiumCard>
            );
          })}
          {nextCursor ? <Action label={loadingMore ? text.loadingMore : text.loadMore} onPress={() => void loadMore()} disabled={loadingMore} /> : null}
        </>
      )}
    </PremiumScreen>
  );
}

function kindLabel(kind: string, text: typeof COPY.EN | typeof COPY.HI): string {
  if (kind === 'PROMOTION') return text.promotion;
  if (kind === 'DAILY_DEAL') return text.dailyDeal;
  return text.offer;
}

function statusLabel(status: string, text: typeof COPY.EN | typeof COPY.HI): string {
  if (status === 'ACTIVE') return text.active;
  if (status === 'PAUSED') return text.paused;
  if (status === 'EXPIRED') return text.expired;
  return text.draft;
}

function audienceText(audience: OfferDto['audience'], text: typeof COPY.EN | typeof COPY.HI): string {
  switch (audience) {
    case 'NEW': return text.new;
    case 'REPEAT': return text.repeat;
    case 'INACTIVE': return text.inactive;
    default: return text.all;
  }
}

function discountText(offer: Pick<OfferDto, 'discountType' | 'discountValue' | 'currency'>): string {
  return offer.discountType === 'PERCENT' ? `${offer.discountValue}% off` : `${formatMoney(offer.discountValue, offer.currency)} off`;
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>;
}

function Action({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.action, primary && styles.primaryAction, disabled && styles.disabledAction]}><Text style={[styles.actionText, primary && styles.primaryText]}>{label}</Text></Pressable>;
}

function Field({ label, value, onChange, placeholder, multiline = false, keyboardType }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={fastQue.textMuted} multiline={multiline} keyboardType={keyboardType} autoCorrect={false} maxLength={multiline ? 500 : 120} style={[styles.input, multiline && styles.multilineInput]} />
    </View>
  );
}

function OfferEditor({ form, editing, services, timeZone, preview, previewBusy, formError, busy, text, onChange, onPreview, onSave, onCancel }: {
  form: OwnerOfferForm; editing: boolean; services: SalonServiceDto[]; timeZone: string; preview: OfferPreviewDto | null; previewBusy: boolean; formError: string | null; busy: boolean; text: typeof COPY.EN | typeof COPY.HI;
  onChange: (patch: Partial<OwnerOfferForm>) => void; onPreview: () => void; onSave: () => void; onCancel: () => void;
}) {
  const allServices = form.serviceIds.length === 0;
  const toggleService = (serviceId: string) => {
    const selected = allServices
      ? services.map((service) => service.id).filter((id) => id !== serviceId)
      : form.serviceIds.includes(serviceId)
        ? form.serviceIds.filter((id) => id !== serviceId)
        : [...form.serviceIds, serviceId];
    const unique = [...new Set(selected)];
    onChange({ serviceIds: unique.length >= services.length ? [] : unique });
  };
  const audienceHelp = form.audience === 'NEW' ? text.newHint : form.audience === 'REPEAT' ? text.repeatHint : form.audience === 'INACTIVE' ? text.inactiveHint : text.allCustomersHint;

  return (
    <PremiumCard strong style={styles.editorCard}>
      <Text style={styles.cardTitle}>{editing ? text.updateDraft : text.create}</Text>
      <Text style={styles.muted}>{text.dateHint} · {timeZone}</Text>
      <Text style={styles.fieldLabel}>{text.kind}</Text>
      <View style={styles.choiceRow}>{OFFER_KINDS.map((value) => <Choice key={value} label={kindLabel(value, text)} selected={form.kind === value} onPress={() => onChange({ kind: value })} />)}</View>
      <Field label={text.name} value={form.title} onChange={(title) => onChange({ title })} />
      <Field label={text.description} value={form.description} onChange={(description) => onChange({ description })} multiline />
      <Text style={styles.fieldLabel}>{text.discount}</Text>
      <View style={styles.choiceRow}>
        {OFFER_DISCOUNT_TYPES.map((value) => <Choice key={value} label={value === 'PERCENT' ? text.percent : text.flat} selected={form.discountType === value} onPress={() => onChange({ discountType: value })} />)}
      </View>
      <Field label={text.discount} value={form.discountValue} onChange={(discountValue) => onChange({ discountValue })} keyboardType="decimal-pad" />
      <Text style={styles.fieldLabel}>{text.audience}</Text>
      <View style={styles.choiceRow}>{OFFER_AUDIENCES.map((value) => <Choice key={value} label={audienceText(value, text)} selected={form.audience === value} onPress={() => onChange({ audience: value, inactiveDays: value === 'INACTIVE' ? form.inactiveDays : '' })} />)}</View>
      <Text style={styles.muted}>{audienceHelp}</Text>
      {form.audience === 'INACTIVE' ? <Field label={text.inactiveDays} value={form.inactiveDays} onChange={(inactiveDays) => onChange({ inactiveDays })} keyboardType="number-pad" /> : null}
      <Field label={text.starts} value={form.validFrom} onChange={(validFrom) => onChange({ validFrom })} placeholder="YYYY-MM-DDTHH:mm" />
      <Field label={text.ends} value={form.validTo} onChange={(validTo) => onChange({ validTo })} placeholder="YYYY-MM-DDTHH:mm" />
      <Field label={text.maxRedemptions} value={form.maxRedemptions} onChange={(maxRedemptions) => onChange({ maxRedemptions })} keyboardType="number-pad" />
      <Field label={text.perCustomerLimit} value={form.perCustomerLimit} onChange={(perCustomerLimit) => onChange({ perCustomerLimit })} keyboardType="number-pad" />
      <Text style={styles.fieldLabel}>{text.services}</Text>
      <Choice label={text.allServices} selected={allServices} onPress={() => onChange({ serviceIds: [] })} />
      {services.length > 100 ? <Text style={styles.muted}>{text.tooManyServices}</Text> : null}
      {services.length <= 100 ? services.map((service) => <Choice key={service.id} label={`${allServices || form.serviceIds.includes(service.id) ? '✓ ' : ''}${service.name}`} selected={allServices || form.serviceIds.includes(service.id)} onPress={() => toggleService(service.id)} />) : null}
      {formError ? <Text accessibilityRole="alert" style={styles.warning}>{formError}</Text> : null}
      {preview ? <PreviewSummary preview={preview} text={text} /> : null}
      <View style={styles.actions}>
        <Action label={previewBusy ? text.checking : text.preview} onPress={onPreview} disabled={busy || previewBusy || contextMissing(services, timeZone) || !canPreviewOwnerOffer(form.serviceIds, services.length)} />
        <Action label={busy ? text.saving : editing ? text.updateDraft : text.saveDraft} onPress={onSave} disabled={busy || previewBusy} primary />
        <Action label={text.cancel} onPress={onCancel} disabled={busy} />
      </View>
    </PremiumCard>
  );
}

function contextMissing(services: SalonServiceDto[], timeZone: string): boolean {
  return !timeZone || services.length === 0;
}

function PreviewSummary({ preview, text }: { preview: OfferPreviewDto; text: typeof COPY.EN | typeof COPY.HI }) {
  return (
    <View style={styles.preview}>
      <Text style={styles.fieldLabel}>{text.preview}</Text>
      {preview.lines.map((line) => <View key={line.serviceId} style={styles.previewRow}><Text style={styles.previewName}>{line.serviceName}</Text><Text style={styles.muted}>{formatMoney(line.basePrice, line.currency)} − {formatMoney(line.discount, line.currency)} = {formatMoney(line.finalPrice, line.currency)}</Text></View>)}
      <Text style={styles.previewTotal}>{formatMoney(preview.subtotal, preview.currency)} − {formatMoney(preview.discount, preview.currency)} = {formatMoney(preview.finalTotal, preview.currency)}</Text>
      <Text style={styles.muted}>{text.previewNote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  explainer: { marginBottom: space[4] },
  editorCard: { marginBottom: space[4] },
  offerCard: { marginBottom: space[3] },
  cardTitle: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.lg },
  muted: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), marginTop: space[2] },
  warning: { color: fastQue.coral, fontFamily: font.bodyMedium, fontSize: fontSize.sm, marginTop: space[2] },
  notice: { color: fastQue.success, fontFamily: font.bodyMedium, fontSize: fontSize.sm, marginBottom: space[3] },
  field: { marginTop: space[3] },
  fieldLabel: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.xs, marginTop: space[3], marginBottom: space[1] },
  input: { minHeight: 46, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.sm, paddingHorizontal: space[3], color: fastQue.text, backgroundColor: fastQue.background, fontFamily: font.bodyRegular, fontSize: fontSize.sm },
  multilineInput: { minHeight: 76, textAlignVertical: 'top', paddingTop: space[3] },
  filterGroup: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2], marginTop: space[2] },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[1] },
  choice: { minHeight: 38, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.pill, paddingHorizontal: space[3], justifyContent: 'center', marginTop: space[2] },
  choiceSelected: { backgroundColor: fastQue.card, borderColor: fastQue.borderStrong },
  choiceText: { color: fastQue.textMuted, fontFamily: font.bodyMedium, fontSize: fontSize.xs },
  choiceTextSelected: { color: fastQue.text },
  action: { minHeight: 42, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.sm, paddingHorizontal: space[3], alignItems: 'center', justifyContent: 'center', marginTop: space[2] },
  primaryAction: { backgroundColor: fastQue.pink, borderColor: fastQue.pink },
  disabledAction: { opacity: 0.55 },
  actionText: { color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.xs },
  primaryText: { color: '#FFFFFF' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  offerTitle: { flex: 1, color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.base },
  offerMeta: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.xs, marginTop: space[2] },
  badge: { overflow: 'hidden', borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: space[1], fontFamily: font.bodySemiBold, fontSize: 10 },
  activeBadge: { backgroundColor: '#153B30', color: '#84E0B9' },
  pausedBadge: { backgroundColor: '#49371D', color: '#F2C879' },
  draftBadge: { backgroundColor: '#302A42', color: '#CDC3F4' },
  preview: { borderTopWidth: 1, borderTopColor: fastQue.border, marginTop: space[3], paddingTop: space[2] },
  previewRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space[2], paddingVertical: space[2] },
  previewName: { flex: 1, color: fastQue.text, fontFamily: font.bodyMedium, fontSize: fontSize.xs },
  previewTotal: { color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.sm, marginTop: space[2] },
});
