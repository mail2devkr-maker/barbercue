import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  Language,
  OWNER_OPS_PATHS,
  type BookingAttributionCampaignDto,
  type BookingAttributionSummaryDto,
  type CreateBookingAttributionCampaignDto,
  type PaginatedResult,
  type SalonTimezoneResultDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import {
  buildCampaignUrl,
  CAMPAIGN_SOURCES,
  campaignStatus,
  canonicalBaseUrl,
  formatLastDay,
  formatShopDate,
  MAX_LABEL_LENGTH,
  sortByBookings,
  sourceLabel,
  STATUS_LABEL,
  summaryQueryString,
  toCreateBody,
  validateCampaignForm,
  type CampaignForm,
  type CampaignFormErrors,
  type ShareLinksAnswer,
} from '../../lib/booking-sources';
import { presetRange, RANGE_ERROR_TEXT, todayInZone, validateRange, type PresetId } from '../../lib/revenue-report';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, EmptyState, InlineError } from '../ui';
import { QrMatrixView } from './QrMatrixView';

/**
 * Website parity for apps/web/components/owner/BookingSources.tsx: where bookings came from for any
 * date range (by source and by campaign link), and campaign links — create one per place the shop is
 * shared, see its code ONCE (with the canonical link and a QR code), and turn it off. Every rule is
 * the website's (lib/booking-sources.ts, copied); the server alone validates and counts.
 */
const EMPTY_FORM: CampaignForm = { source: 'FACEBOOK', label: '', firstDay: '', lastDay: '' };
const PRESETS: ReadonlyArray<{ id: PresetId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
];

export function BookingSourcesPanel({ salonId, language }: { salonId: string; language: Language }) {
  const hi = language === Language.HI;
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const attributionBase = `${base}/${OWNER_OPS_PATHS.bookingAttribution}`;
  const [zone, setZone] = useState<string | null | undefined>(undefined);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [summary, setSummary] = useState<BookingAttributionSummaryDto | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<BookingAttributionCampaignDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<CampaignFormErrors>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateBookingAttributionCampaignDto | null>(null);
  const [createdLink, setCreatedLink] = useState<string | null | undefined>(undefined);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const seq = useRef(0);

  const loadSummary = useCallback(async (next: { from: string; to: string }) => {
    const problem = validateRange(next.from, next.to);
    if (problem) { setSummaryError(RANGE_ERROR_TEXT[problem]); return; }
    const id = ++seq.current;
    setRange(next);
    setSummaryError(null);
    try {
      const result = await apiFetch<BookingAttributionSummaryDto>(`${attributionBase}/summary?${summaryQueryString(next)}`);
      if (id === seq.current) setSummary(result);
    } catch (err) {
      if (id === seq.current) setSummaryError(err instanceof ApiError ? err.message : 'Could not load booking sources.');
    }
  }, [attributionBase]);

  const loadCampaigns = useCallback(async (cursor: string | null) => {
    setListError(null);
    try {
      const params = new URLSearchParams({ limit: '25', ...(cursor ? { cursor } : {}) });
      const page = await apiFetch<PaginatedResult<BookingAttributionCampaignDto>>(`${attributionBase}/${OWNER_OPS_PATHS.attributionCampaigns}?${params.toString()}`);
      setCampaigns((prev) => (cursor ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not load campaign links.');
    }
  }, [attributionBase]);

  useEffect(() => {
    let cancelled = false;
    setSummary(null); setCampaigns([]); setCreated(null); setZone(undefined);
    apiFetch<SalonTimezoneResultDto>(`${base}/${DASHBOARD_PATHS.timezone}`)
      .then((tz) => {
        if (cancelled) return;
        setZone(tz.timezone ?? null);
        if (tz.timezone) void loadSummary(presetRange('last30', todayInZone(tz.timezone)));
      })
      .catch(() => { if (!cancelled) setZone(null); });
    void loadCampaigns(null);
    return () => { cancelled = true; seq.current += 1; };
  }, [base, loadSummary, loadCampaigns]);

  if (zone === undefined) return <Text style={styles.muted}>…</Text>;
  if (zone === null) {
    return <InlineError message={hi ? 'दुकान का समय क्षेत्र सेट नहीं है, इसलिए बुकिंग तारीखें सुरक्षित रूप से नहीं गिनी जा सकतीं। सेटिंग में समय क्षेत्र सेट करें।' : 'Your shop has no timezone yet, so booking dates cannot be computed safely. Set the timezone in Shop Settings.'} />;
  }

  const create = async () => {
    const errors = validateCampaignForm(form);
    setFormErrors(errors);
    if (Object.keys(errors).length) return;
    setBusy('create');
    setListError(null);
    try {
      const result = await apiFetch<CreateBookingAttributionCampaignDto>(`${attributionBase}/${OWNER_OPS_PATHS.attributionCampaigns}`, {
        method: 'POST', body: JSON.stringify(toCreateBody(form, zone)),
      });
      setCreated(result);
      setCreatedLink(undefined);
      setForm(EMPTY_FORM);
      try {
        const answer = await apiFetch<ShareLinksAnswer>(`${base}/share-links`);
        const baseUrl = canonicalBaseUrl(answer);
        setCreatedLink(baseUrl ? buildCampaignUrl(baseUrl, result.token) : null);
      } catch {
        setCreatedLink(null);
      }
      await loadCampaigns(null);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not create the campaign.');
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (campaignId: string) => {
    setBusy(campaignId);
    setListError(null);
    try {
      const updated = await apiFetch<BookingAttributionCampaignDto>(`${attributionBase}/${OWNER_OPS_PATHS.attributionCampaigns}/${campaignId}/revoke`, { method: 'POST' });
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setConfirmRevoke(null);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not turn the campaign off.');
    } finally {
      setBusy(null);
    }
  };

  const bySource = summary ? sortByBookings(summary.bySource) : [];
  const byCampaign = summary ? sortByBookings(summary.campaigns) : [];
  const total = bySource.reduce((sum, row) => sum + row.bookingCount, 0);

  return (
    <>
      <Card>
        <Text style={styles.heading}>{hi ? 'बुकिंग कहाँ से आईं' : 'Where bookings came from'}</Text>
        <View style={styles.chips}>
          {PRESETS.map((p) => (
            <Pressable key={p.id} accessibilityRole="button" onPress={() => void loadSummary(presetRange(p.id, todayInZone(zone)))} style={styles.chip}>
              <Text style={styles.chipText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        {!!summaryError && <InlineError message={summaryError} />}
        {summary && range && (total === 0 ? <EmptyState title={hi ? 'इस सीमा में कोई बुकिंग नहीं' : 'No bookings in this range'} message={hi ? 'बड़ी सीमा चुनें।' : 'Try a wider range.'} /> : (
          <>
            <Text style={styles.muted}>{`${summary.from} → ${summary.to}`}</Text>
            {bySource.map((row) => <Row key={row.source} title={sourceLabel(row.source)} value={String(row.bookingCount)} />)}
            {byCampaign.length > 0 && <Text style={styles.sub}>{hi ? 'कैंपेन लिंक के अनुसार' : 'By campaign link'}</Text>}
            {byCampaign.map((row) => <Row key={row.campaignId} title={row.label} note={sourceLabel(row.source)} value={String(row.bookingCount)} />)}
          </>
        ))}
        <Text style={styles.muted}>{hi ? 'स्रोत दर्ज होने से पहले की पुरानी बुकिंग "दर्ज नहीं" दिखती हैं। उनका अनुमान नहीं लगाया जाता।' : 'Older bookings made before sources were recorded show as “Not recorded”. They are never guessed.'}</Text>
      </Card>

      <Card>
        <Text style={styles.heading}>{hi ? 'कैंपेन लिंक' : 'Campaign links'}</Text>
        <Text style={styles.muted}>{hi ? 'हर जगह के लिए एक कोड बनाएँ जहाँ आप दुकान शेयर करते हैं। कोड एक ही बार दिखता है।' : 'Create one code for each place you share your shop (a Facebook post, an Instagram bio, a ChatGPT answer). The code is shown once, so copy it when it appears.'}</Text>
        <Text style={styles.label}>{hi ? 'कहाँ शेयर किया' : 'Shared on'}</Text>
        <View style={styles.chips}>
          {CAMPAIGN_SOURCES.map((s) => (
            <Pressable key={s.value} accessibilityRole="button" accessibilityState={{ selected: form.source === s.value }} onPress={() => setForm({ ...form, source: s.value })} style={[styles.chip, form.source === s.value && styles.chipOn]}>
              <Text style={[styles.chipText, form.source === s.value && styles.chipTextOn]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput accessibilityLabel="Campaign name" placeholder={hi ? 'कैंपेन का नाम (जैसे दिवाली ऑफ़र पोस्ट)' : 'Campaign name (e.g. Diwali offer post)'} value={form.label} onChangeText={(v) => setForm({ ...form, label: v })} maxLength={MAX_LABEL_LENGTH} style={styles.input} />
        {!!formErrors.label && <Text style={styles.error}>{formErrors.label}</Text>}
        <View style={styles.row}>
          <TextInput accessibilityLabel="First day" placeholder={hi ? 'पहला दिन YYYY-MM-DD (वैकल्पिक)' : 'First day YYYY-MM-DD (optional)'} value={form.firstDay} onChangeText={(v) => setForm({ ...form, firstDay: v })} maxLength={10} style={[styles.input, styles.flex]} />
          <TextInput accessibilityLabel="Last day" placeholder={hi ? 'अंतिम दिन (वैकल्पिक)' : 'Last day (optional)'} value={form.lastDay} onChangeText={(v) => setForm({ ...form, lastDay: v })} maxLength={10} style={[styles.input, styles.flex]} />
        </View>
        {!!(formErrors.firstDay || formErrors.lastDay || formErrors.source) && <Text style={styles.error}>{formErrors.firstDay ?? formErrors.lastDay ?? formErrors.source}</Text>}
        <Button title={busy === 'create' ? (hi ? 'बनाया जा रहा है…' : 'Creating…') : (hi ? 'कैंपेन कोड बनाएँ' : 'Create campaign code')} onPress={() => void create()} disabled={busy !== null} />

        {created && (
          <View style={styles.created} accessibilityLabel="New campaign link">
            <Text style={styles.lineStrong}>{`${created.label}: ${hi ? 'तैयार। कोड केवल एक बार दिखेगा।' : 'ready. The code is shown only once and cannot be recovered. Share or save the link now.'}`}</Text>
            {createdLink === undefined && <Text style={styles.muted}>{hi ? 'लिंक तैयार हो रहा है…' : 'Preparing your link…'}</Text>}
            {createdLink && (
              <>
                <Text selectable style={styles.code}>{createdLink}</Text>
                <View style={styles.qr}><QrMatrixView value={createdLink} label={hi ? 'कैंपेन लिंक का QR कोड' : 'QR code for this campaign link'} /></View>
                <Button title={hi ? 'लिंक शेयर / कॉपी करें' : 'Share / copy link'} variant="outline" onPress={() => void Share.share({ message: createdLink })} />
              </>
            )}
            {createdLink === null && <Text style={styles.muted}>{hi ? 'दुकान का सार्वजनिक पता अभी उपलब्ध नहीं, इसलिए लिंक नहीं बन सका। नीचे का कोड कॉपी करें।' : "FastQue could not build a link right now because your shop's public address is not available. You can still copy the code below."}</Text>}
            <Text style={styles.label}>{hi ? 'कैंपेन कोड' : 'Campaign code'}</Text>
            <Text selectable style={styles.code} testID="campaign-code">{created.token}</Text>
            <View style={styles.row}>
              <Button title={hi ? 'कोड शेयर / कॉपी करें' : 'Share / copy code'} variant="outline" onPress={() => void Share.share({ message: created.token })} style={styles.flex} />
              <Button title={hi ? 'मैंने सहेज लिया' : 'I have saved it'} variant="secondary" onPress={() => setCreated(null)} style={styles.flex} />
            </View>
          </View>
        )}

        {!!listError && <InlineError message={listError} />}
        {campaigns.length === 0 && !listError ? <Text style={styles.muted}>{hi ? 'अभी कोई कैंपेन लिंक नहीं।' : 'No campaign links yet. Create your first one above.'}</Text> : campaigns.map((c) => {
          const status = campaignStatus(c);
          return (
            <View key={c.id} style={styles.campaign}>
              <Row title={c.label} note={`${sourceLabel(c.source)} · ${formatShopDate(c.startsAt, zone)} – ${formatLastDay(c.endsAt, zone)} · ${STATUS_LABEL[status]}`} value={String(c.bookingCount)} />
              {status !== 'REVOKED' && (confirmRevoke === c.id ? (
                <View style={styles.row}>
                  <Button title={busy === c.id ? '…' : hi ? 'हाँ, बंद करें' : 'Yes, turn off'} onPress={() => void revoke(c.id)} disabled={busy !== null} style={styles.flex} />
                  <Button title={hi ? 'रखें' : 'Keep'} variant="outline" onPress={() => setConfirmRevoke(null)} disabled={busy !== null} style={styles.flex} />
                </View>
              ) : (
                <Button title={hi ? 'बंद करें' : `Turn off ${c.label}`} variant="outline" onPress={() => setConfirmRevoke(c.id)} />
              ))}
            </View>
          );
        })}
        {nextCursor && <Button title={hi ? 'और दिखाएँ' : 'Load more'} variant="outline" onPress={() => void loadCampaigns(nextCursor)} />}
        <Text style={styles.muted}>{hi ? 'कैंपेन बंद करने पर नई बुकिंग उससे नहीं जुड़तीं। पुरानी बुकिंग का रिकॉर्ड रहता है।' : 'Turning a campaign off stops new bookings from being linked to it. Past bookings keep their record.'}</Text>
      </Card>
    </>
  );
}

function Row({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <View style={styles.line}>
      <View style={styles.flex}><Text style={styles.lineStrong}>{title}</Text>{note ? <Text style={styles.muted}>{note}</Text> : null}</View>
      <Text style={styles.lineStrong}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  sub: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm, marginTop: space[3] },
  label: { fontFamily: font.bodyMedium, color: color.muted, fontSize: fontSize.xs, marginTop: space[2] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  error: { fontFamily: font.bodyMedium, color: color.warn, fontSize: fontSize.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginVertical: space[2] },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: color.surface },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
  chipTextOn: { color: color.accent, fontFamily: font.bodyBold },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginVertical: space[1] },
  row: { flexDirection: 'row', gap: space[2], marginVertical: space[1] },
  flex: { flex: 1 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  lineStrong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  created: { marginTop: space[3], padding: space[3], borderRadius: radius.sm, backgroundColor: color.successSoft, gap: space[2] },
  code: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
  qr: { alignSelf: 'flex-start', backgroundColor: '#fff', padding: space[3], borderRadius: radius.sm },
  campaign: { marginTop: space[2] },
});
