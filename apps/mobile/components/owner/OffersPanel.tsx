import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { type OfferDto, type OfferPreviewDto, type SalonServiceDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { buildOfferBody, buildOfferPatch, canEditOffer, emptyOfferForm, formFromOffer, type OfferErrors, type OfferForm } from '../../lib/offers';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, EmptyState, InlineError } from '../ui';

export type MobileOffersCopy = {
  noOffers: string;
  offerPanelTitle: string;
  offerTypeOption: string;
  promotionTypeOption: string;
  dailyDealTypeOption: string;
  percentOption: string;
  flatOption: string;
  allAudienceOption: string;
  newAudienceOption: string;
  repeatAudienceOption: string;
  inactiveAudienceOption: string;
  previewLimited: string;
  offersUnavailable: string;
  createOffer: string;
  editOffer: string;
  previewPrices: string;
  saveDraft: string;
  saveChanges: string;
  checkPrices: string;
  offerTitle: string;
  offerDescription: string;
  offerKind: string;
  discountType: string;
  discountValueLabel: string;
  audience: string;
  inactiveDays: string;
  startsAt: string;
  endsAt: string;
  maxRedemptions: string;
  perCustomerLimit: string;
  services: string;
  allActiveServices: string;
  offerTimezoneUnavailable: string;
  pauseBeforeEdit: string;
  offerSafetyNote: string;
  noActiveServices: string;
  publish: string;
  pause: string;
  publishingTitle: string;
  publishingMessage: string;
  confirm: string;
  cancel: string;
  offerDiscount: string;
  redemption: string;
  loading: string;
  completed: string;
  balanceDue: string;
  error: string;
};

export function OffersPanel({ enabled, items, busyId, onAction, timeZone, services, editor, base, onCreate, onEdit, onCancelEdit, onSave, c }: {
  enabled: boolean;
  items: OfferDto[];
  busyId: string | null;
  onAction: (offer: OfferDto, action: 'publish' | 'pause') => void;
  timeZone: string | null;
  services: SalonServiceDto[];
  editor: { offer: OfferDto | null } | null;
  base: string;
  onCreate: () => void;
  onEdit: (offer: OfferDto | null) => void;
  onCancelEdit: () => void;
  onSave: (offer: OfferDto | null, form: OfferForm, onErrors: (errors: OfferErrors) => void) => void;
  c: MobileOffersCopy;
}) {
  if (!enabled) return <EmptyState title={c.offersUnavailable} />;
  return <View style={styles.stack}>
    <Card>
      <Text style={styles.heading}>{c.offerPanelTitle}</Text>
      <Text style={styles.muted}>{c.offerSafetyNote}</Text>
      {!timeZone && <Text style={styles.error}>{c.offerTimezoneUnavailable}</Text>}
      <Button title={c.createOffer} disabled={!timeZone || !!editor || busyId === 'offer'} onPress={onCreate} style={styles.action} />
    </Card>
    {editor && timeZone && <OfferEditor
      key={editor.offer?.id ?? 'new-offer'}
      offer={editor.offer}
      base={base}
      timeZone={timeZone}
      services={services}
      busy={busyId === 'offer'}
      onCancel={onCancelEdit}
      onSave={(form, setErrors) => onSave(editor.offer, form, setErrors)}
      c={c}
    />}
    {items.length === 0 ? <EmptyState title={c.noOffers} /> : items.map((offer) => <Card key={offer.id}>
      <Text style={styles.heading}>{offer.title}</Text>
      <Text style={styles.line}>{offer.kind + ' · ' + offer.status}</Text>
      <Text style={styles.muted}>{c.offerDiscount + ': ' + (offer.discountType === 'PERCENT' ? String(offer.discountValue) + '%' : money(offer.discountValue, offer.currency)) + ' · ' + dateLabel(offer.validFrom, timeZone) + ' – ' + dateLabel(offer.validTo, timeZone)}</Text>
      <Text style={styles.muted}>{c.redemption + ': ' + String(offer.redemptionCount) + (offer.maxRedemptions ? ' / ' + String(offer.maxRedemptions) : '')}</Text>
      {canEditOffer(offer.status) && <Button title={c.editOffer} disabled={!!editor || busyId === 'offer'} onPress={() => onEdit(offer)} style={styles.action} />}
      {offer.status === 'ACTIVE' && <Text style={styles.muted}>{c.pauseBeforeEdit}</Text>}
      {offer.status === 'DRAFT' && <Button title={c.publish} disabled={busyId === offer.id || !!editor} onPress={() => onAction(offer, 'publish')} style={styles.action} />}
      {offer.status === 'ACTIVE' && <Button title={c.pause} variant="outline" disabled={busyId === offer.id || !!editor} onPress={() => onAction(offer, 'pause')} style={styles.action} />}
      <SavedOfferPreview offer={offer} services={services} timeZone={timeZone} base={'dashboard/salons/' + offer.salonId} c={c} />
    </Card>)}
  </View>;
}

function OfferEditor({ offer, base, timeZone, services, busy, onCancel, onSave, c }: {
  offer: OfferDto | null;
  base: string;
  timeZone: string;
  services: SalonServiceDto[];
  busy: boolean;
  onCancel: () => void;
  onSave: (form: OfferForm, setErrors: (errors: OfferErrors) => void) => void;
  c: MobileOffersCopy;
}) {
  const [form, setForm] = useState<OfferForm>(() => offer ? formFromOffer(offer, timeZone) : emptyOfferForm(timeZone));
  const [errors, setErrors] = useState<OfferErrors>({});
  const [preview, setPreview] = useState<OfferPreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const setField = <K extends keyof OfferForm>(key: K, value: OfferForm[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => { const next = { ...previous }; delete next[key]; return next; });
    setPreview(null);
    setPreviewError(null);
  };
  const toggleService = (id: string) => setField('serviceIds', form.serviceIds.includes(id) ? form.serviceIds.filter((item) => item !== id) : [...form.serviceIds, id]);
  const save = () => {
    const result = offer ? buildOfferPatch(offer, form, timeZone) : buildOfferBody(form, timeZone);
    setErrors(result.errors);
    if (Object.keys(result.errors).length || !result.body) return;
    onSave(form, setErrors);
  };
  const checkPrices = async () => {
    const result = buildOfferBody(form, timeZone);
    setErrors(result.errors);
    if (Object.keys(result.errors).length || !result.body) return;
    setPreview(null);
    setPreviewError(null);
    setPreviewBusy(true);
    try {
      setPreview(await apiFetch<OfferPreviewDto>(base + '/offers/preview', { method: 'POST', body: JSON.stringify(result.body) }));
    } catch (err) {
      setPreviewError(err instanceof ApiError ? err.message : c.error);
    } finally {
      setPreviewBusy(false);
    }
  };
  return <Card>
    <Text style={styles.heading}>{offer ? c.editOffer : c.createOffer}</Text>
    <Text style={styles.muted}>{c.startsAt + ' · ' + timeZone}</Text>
    <ChoiceRow label={c.offerKind} value={form.kind} choices={[['OFFER', c.offerTypeOption], ['PROMOTION', c.promotionTypeOption], ['DAILY_DEAL', c.dailyDealTypeOption]]} onSelect={(value) => setField('kind', value as OfferForm['kind'])} />
    <Field label={c.offerTitle} value={form.title} onChange={(value) => setField('title', value)} error={errors.title} maxLength={120} />
    <Field label={c.offerDescription} value={form.description} onChange={(value) => setField('description', value)} error={errors.description} maxLength={500} multiline />
    <ChoiceRow label={c.discountType} value={form.discountType} choices={[['PERCENT', c.percentOption], ['FLAT', c.flatOption]]} onSelect={(value) => setField('discountType', value as OfferForm['discountType'])} />
    <Field label={c.discountValueLabel} value={form.discountValue} onChange={(value) => setField('discountValue', value)} error={errors.discountValue} keyboardType="decimal-pad" />
    <ChoiceRow label={c.audience} value={form.audience} choices={[['ALL', c.allAudienceOption], ['NEW', c.newAudienceOption], ['REPEAT', c.repeatAudienceOption], ['INACTIVE', c.inactiveAudienceOption]]} onSelect={(value) => setField('audience', value as OfferForm['audience'])} />
    {form.audience === 'INACTIVE' && <Field label={c.inactiveDays} value={form.inactiveDays} onChange={(value) => setField('inactiveDays', value)} error={errors.inactiveDays} keyboardType="number-pad" />}
    <Field label={c.startsAt + ' (' + timeZone + ')'} value={form.validFrom} onChange={(value) => setField('validFrom', value)} error={errors.validFrom} placeholder="YYYY-MM-DDTHH:mm" />
    <Field label={c.endsAt + ' (' + timeZone + ')'} value={form.validTo} onChange={(value) => setField('validTo', value)} error={errors.validTo} placeholder="YYYY-MM-DDTHH:mm" />
    <Field label={c.maxRedemptions} value={form.maxRedemptions} onChange={(value) => setField('maxRedemptions', value)} error={errors.maxRedemptions} keyboardType="number-pad" />
    <Field label={c.perCustomerLimit} value={form.perCustomerLimit} onChange={(value) => setField('perCustomerLimit', value)} error={errors.perCustomerLimit} keyboardType="number-pad" />
    <Text style={styles.heading}>{c.services}</Text>
    <Text style={styles.muted}>{c.allActiveServices}</Text>
    {services.length === 0 ? <Text style={styles.muted}>{c.noActiveServices}</Text> : services.map((service) => {
      const selected = form.serviceIds.includes(service.id);
      return <Pressable key={service.id} accessibilityRole="checkbox" accessibilityLabel={service.name} accessibilityState={{ checked: selected }} onPress={() => toggleService(service.id)} style={styles.serviceChoice}>
        <Text style={styles.line}>{(selected ? '☑ ' : '☐ ') + service.name}</Text>
      </Pressable>;
    })}
    {!!errors.serviceIds && <Text style={styles.error}>{errors.serviceIds}</Text>}
    {!!previewError && <InlineError message={previewError} />}
    {previewBusy && <Text style={styles.muted}>{c.loading}</Text>}
    {preview && <PricePreview preview={preview} c={c} />}
    <Button title={c.checkPrices} variant="outline" disabled={busy || previewBusy} onPress={() => void checkPrices()} style={styles.action} />
    <Button title={busy ? c.loading : offer ? c.saveChanges : c.saveDraft} disabled={busy} onPress={save} style={styles.action} />
    <Button title={c.cancel} variant="outline" disabled={busy} onPress={onCancel} style={styles.action} />
  </Card>;
}

function Field({ label, value, onChange, error, placeholder, maxLength, multiline, keyboardType }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
}) {
  return <View style={styles.field}>
    <Text style={styles.lineStrong}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholder={placeholder ?? label} value={value} onChangeText={onChange} maxLength={maxLength} multiline={multiline} keyboardType={keyboardType} autoCapitalize="sentences" style={styles.input} />
    {!!error && <Text style={styles.error}>{error}</Text>}
  </View>;
}

function ChoiceRow({ label, value, choices, onSelect }: { label: string; value: string; choices: Array<[string, string]>; onSelect: (value: string) => void }) {
  return <View style={styles.choiceGroup}>
    <Text style={styles.lineStrong}>{label}</Text>
    <View style={styles.choiceRow}>{choices.map(([key, title]) => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: value === key }} onPress={() => onSelect(key)} style={[styles.choice, value === key && styles.choiceSelected]}>
      <Text style={[styles.choiceText, value === key && styles.choiceTextSelected]}>{title}</Text>
    </Pressable>)}</View>
  </View>;
}

function SavedOfferPreview({ offer, services, timeZone, base, c }: { offer: OfferDto; services: SalonServiceDto[]; timeZone: string | null; base: string; c: MobileOffersCopy }) {
  const [preview, setPreview] = useState<OfferPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  if (!timeZone) return null;
  const check = async () => {
    const ids = offer.serviceIds.length ? offer.serviceIds : services.slice(0, 100).map((service) => service.id);
    if (!ids.length) { setError(c.noActiveServices); return; }
    setBusy(true); setError(null); setPreview(null);
    const note = offer.serviceIds.length === 0 && services.length > 100 ? c.previewLimited.replace('{count}', String(services.length)) : null;
    setPreviewNote(note);
    try {
      setPreview(await apiFetch<OfferPreviewDto>(base + '/offers/' + offer.id + '/preview', { method: 'POST', body: JSON.stringify({ serviceIds: ids }) }));
    } catch (err) { setError(err instanceof ApiError ? err.message : c.error); }
    finally { setBusy(false); }
  };
  return <>
    <Button title={busy ? c.loading : c.previewPrices} variant="outline" disabled={busy} onPress={() => void check()} style={styles.action} />
    {!!error && <InlineError message={error} />}
    {preview && <PricePreview preview={preview} c={c} note={previewNote ?? undefined} />}
  </>;
}

function PricePreview({ preview, c, note }: { preview: OfferPreviewDto; c: MobileOffersCopy; note?: string }) {
  return <Card style={styles.preview}>
    <Text style={styles.heading}>{c.previewPrices}</Text>
    <Text style={styles.muted}>{c.offerSafetyNote}</Text>
    {note && <Text style={styles.muted}>{note}</Text>}
    {preview.lines.map((line) => <View key={line.serviceId} style={styles.priceLine}>
      <View style={styles.priceText}><Text style={styles.lineStrong}>{line.serviceName}</Text><Text style={styles.muted}>{c.offerDiscount + ': ' + money(line.discount, line.currency) + ' · ' + money(line.basePrice, line.currency)}</Text></View>
      <Text style={styles.lineStrong}>{money(line.finalPrice, line.currency)}</Text>
    </View>)}
    <Text style={styles.line}>{c.completed + ': ' + money(preview.subtotal, preview.currency) + ' · ' + c.offerDiscount + ': ' + money(preview.discount, preview.currency)}</Text>
    <Text style={styles.lineStrong}>{c.balanceDue + ': ' + money(preview.finalTotal, preview.currency)}</Text>
  </Card>;
}

function money(value: number, currency: string | null | undefined): string {
  if (!currency) return value.toFixed(2);
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return currency + ' ' + value.toFixed(2); }
}
function dateLabel(value: string, timeZone: string | null): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try { return new Intl.DateTimeFormat(undefined, { timeZone: timeZone ?? undefined, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date); }
  catch { return date.toLocaleString(); }
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[2] },
  line: { fontFamily: font.bodyRegular, color: color.ink, fontSize: fontSize.sm, marginVertical: space[1] },
  lineStrong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginTop: space[1] },
  error: { fontFamily: font.bodyMedium, color: color.accent, fontSize: fontSize.xs, marginTop: space[1] },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginTop: space[2], marginBottom: space[1], textAlignVertical: 'top' },
  field: { marginTop: space[3] },
  action: { marginTop: space[2] },
  choiceGroup: { gap: space[2], marginTop: space[3] },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  choice: { borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space[3], paddingVertical: space[2] },
  choiceSelected: { borderColor: color.accent, backgroundColor: color.accentSoft },
  choiceText: { color: color.ink, fontFamily: font.bodyMedium, fontSize: fontSize.xs },
  choiceTextSelected: { color: color.accent, fontFamily: font.bodyBold },
  serviceChoice: { paddingVertical: space[1] },
  preview: { backgroundColor: color.accentSoft, marginTop: space[2] },
  priceLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  priceText: { flex: 1 },
});
