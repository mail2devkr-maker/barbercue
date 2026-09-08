import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  ChairStatus,
  DASHBOARD_PATHS,
  PhotoType,
  SALON_PHOTO_UPLOAD,
  TIME_OF_DAY_REGEX,
  e164PhoneSchema,
  formatMoney,
  salonPhotoUrlSchema,
  type OperatingHoursDto,
  type PhotoDto,
  type SalonChairDto,
  type SalonPaymentQrDto,
} from '@barbercue/shared';
import { apiFetch, apiUploadImage, ApiError, NativeUploadError } from '../../lib/api';
import {
  IMAGE_UPLOAD_PREPARATION_MESSAGE,
  ImageUploadPreparationError,
  uploadImageAsset,
} from '../../lib/image-upload';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, InlineError, SafeImage } from '../ui';

/**
 * Shared shop-management form pieces — originally OwnerShopScreen's own inline components,
 * extracted here (Mobile Shop Owner Onboarding mission) so the new setup wizard
 * (OwnerOnboardingScreen) reuses the EXACT same forms/validation/API calls a returning owner
 * already uses to edit an established shop, rather than a second, drifting implementation.
 * OwnerShopScreen imports from here unchanged in behavior — this file only moved code, it did not
 * rewrite any of it.
 */

export function scope(salonId: string, segment: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${segment}`;
}

// ---------- Services ----------

export interface ServiceDtoLike {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  isActive: boolean;
}

export function ServiceRow({ salonId, service, onChanged }: { salonId: string; service: ServiceDtoLike; onChanged: () => void }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(service.name);
  const [price, setPrice] = useState(String(service.price));
  const [duration, setDuration] = useState(String(service.durationMinutes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`${scope(salonId, DASHBOARD_PATHS.services)}/${service.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, price: Number(price), durationMinutes: Number(duration) }),
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotSaveService);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`${scope(salonId, DASHBOARD_PATHS.services)}/${service.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !service.isActive }),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotUpdateService);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <View style={styles.row}>
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, !service.isActive && styles.rowTitleInactive]}>{service.name}</Text>
          <Text style={styles.rowMeta}>
            {formatMoney(service.price, null)} · {service.durationMinutes} {t.minutesAbbrev} {service.isActive ? '' : t.inactiveSuffix}
          </Text>
        </View>
        <Pressable onPress={() => setEditing(true)}>
          <Text style={styles.rowAction}>{t.editAction}</Text>
        </Pressable>
        <Pressable onPress={() => void toggleActive()} disabled={saving}>
          <Text style={styles.rowAction}>{service.isActive ? t.deactivateAction : t.activateAction}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.editPanel}>
      {error && <InlineError message={error} />}
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={t.servicePlaceholder} placeholderTextColor={color.muted} />
      <View style={styles.inlineRow}>
        <TextInput style={[styles.input, styles.inputHalf]} value={price} onChangeText={setPrice} keyboardType="numeric" placeholder={t.pricePlaceholder} placeholderTextColor={color.muted} />
        <TextInput style={[styles.input, styles.inputHalf]} value={duration} onChangeText={setDuration} keyboardType="numeric" placeholder={t.minutesPlaceholder} placeholderTextColor={color.muted} />
      </View>
      <View style={styles.actionRow}>
        <Button title={t.saveAction} onPress={() => void save()} loading={saving} style={styles.actionButton} />
        <Button title={t.cancelAction} variant="outline" onPress={() => setEditing(false)} style={styles.actionButton} />
      </View>
    </View>
  );
}

export function AddServiceForm({ salonId, onAdded }: { salonId: string; onAdded: () => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(scope(salonId, DASHBOARD_PATHS.services), {
        method: 'POST',
        body: JSON.stringify({ name, price: Number(price), durationMinutes: Number(duration) }),
      });
      setName('');
      setPrice('');
      setDuration('');
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotAddService);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return <Button title={t.addService} variant="outline" onPress={() => setOpen(true)} style={styles.addButton} />;

  return (
    <View style={styles.editPanel}>
      {error && <InlineError message={error} />}
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={t.servicePlaceholder} placeholderTextColor={color.muted} />
      <View style={styles.inlineRow}>
        <TextInput style={[styles.input, styles.inputHalf]} value={price} onChangeText={setPrice} keyboardType="numeric" placeholder={t.pricePlaceholder} placeholderTextColor={color.muted} />
        <TextInput style={[styles.input, styles.inputHalf]} value={duration} onChangeText={setDuration} keyboardType="numeric" placeholder={t.minutesPlaceholder} placeholderTextColor={color.muted} />
      </View>
      <View style={styles.actionRow}>
        <Button title={t.addAction} onPress={() => void submit()} loading={saving} disabled={!name || !price || !duration} style={styles.actionButton} />
        <Button title={t.cancelAction} variant="outline" onPress={() => setOpen(false)} style={styles.actionButton} />
      </View>
    </View>
  );
}

// ---------- Chairs ----------

export function ChairRow({ salonId, chair, onChanged }: { salonId: string; chair: SalonChairDto; onChanged: () => void }) {
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isActive = chair.status === ChairStatus.ACTIVE;

  async function toggle() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`${scope(salonId, DASHBOARD_PATHS.chairs)}/${chair.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: isActive ? ChairStatus.INACTIVE : ChairStatus.ACTIVE }),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotUpdateChair);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, !isActive && styles.rowTitleInactive]}>{chair.label}</Text>
        <Text style={styles.rowMeta}>{chair.status}</Text>
        {error && <InlineError message={error} />}
      </View>
      <Pressable onPress={() => void toggle()} disabled={saving}>
        <Text style={styles.rowAction}>{isActive ? t.removeAction : t.reactivateAction}</Text>
      </Pressable>
    </View>
  );
}

export function AddChairForm({ salonId, onAdded }: { salonId: string; onAdded: () => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(scope(salonId, DASHBOARD_PATHS.chairs), { method: 'POST', body: JSON.stringify({ label }) });
      setLabel('');
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotAddChair);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return <Button title={t.addChair} variant="outline" onPress={() => setOpen(true)} style={styles.addButton} />;

  return (
    <View style={styles.editPanel}>
      {error && <InlineError message={error} />}
      <TextInput style={styles.input} value={label} onChangeText={setLabel} placeholder={t.chairLabelPlaceholder} placeholderTextColor={color.muted} />
      <View style={styles.actionRow}>
        <Button title={t.addAction} onPress={() => void submit()} loading={saving} disabled={!label} style={styles.actionButton} />
        <Button title={t.cancelAction} variant="outline" onPress={() => setOpen(false)} style={styles.actionButton} />
      </View>
    </View>
  );
}

// ---------- Photos ----------

export function PhotoTile({ salonId, photo, onChanged }: { salonId: string; photo: PhotoDto; onChanged: () => void }) {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      await apiFetch(`${scope(salonId, DASHBOARD_PATHS.photos)}/${photo.id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this photo.');
      setRemoving(false);
    }
  }

  return (
    <View style={styles.photoTile}>
      <SafeImage url={photo.url} alt={photo.altText ?? 'Shop photo'} style={styles.photoImage} />
      <View style={styles.photoTileFoot}>
        <Text style={styles.photoTypeLabel}>{photo.type === PhotoType.COVER ? 'Cover' : 'Gallery'}</Text>
        <Pressable onPress={() => void remove()} disabled={removing}>
          <Text style={styles.rowAction}>{removing ? 'Removing…' : 'Remove'}</Text>
        </Pressable>
      </View>
      {error && <InlineError message={error} />}
    </View>
  );
}

export function AddPhotoButton({
  salonId,
  type,
  label,
  onAdded,
}: {
  salonId: string;
  type: PhotoType;
  label: string;
  onAdded: () => void;
}) {
  const { t } = useLanguage();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickAndUpload() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(t.photoLibraryAccessNeededForShopPhotos);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > SALON_PHOTO_UPLOAD.maxBytes) {
      setError(`${t.photoOverSizeLimitPrefix}${Math.floor(SALON_PHOTO_UPLOAD.maxBytes / (1024 * 1024))}${t.photoOverSizeLimitSuffix}`);
      return;
    }
    setUploading(true);
    try {
      await uploadImageAsset(asset, 'photo.jpg', (prepared) =>
        apiUploadImage(`${scope(salonId, DASHBOARD_PATHS.photos)}/${DASHBOARD_PATHS.photoUpload}`, prepared, { type }),
      );
      onAdded();
    } catch (err) {
      setError(
        err instanceof ImageUploadPreparationError
          ? IMAGE_UPLOAD_PREPARATION_MESSAGE
          : err instanceof ApiError
            ? err.message
            : err instanceof NativeUploadError
              ? err.message
            : 'Could not upload that photo.',
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <View>
      <Button title={uploading ? 'Uploading…' : label} variant="outline" onPress={() => void pickAndUpload()} loading={uploading} style={styles.addButton} />
      {error && <InlineError message={error} />}
    </View>
  );
}

export function PhotosSection({ salonId, photos, onChanged }: { salonId: string; photos: PhotoDto[]; onChanged: () => void }) {
  const { t } = useLanguage();
  const cover = photos.find((p) => p.type === PhotoType.COVER) ?? null;
  const gallery = photos.filter((p) => p.type === PhotoType.GALLERY);

  return (
    <>
      <Text style={styles.sectionTitle}>{t.photosLabel}</Text>
      <Text style={styles.hint}>{t.coverPhotoHint}</Text>
      <View style={styles.photoGrid}>
        {cover && <PhotoTile salonId={salonId} photo={cover} onChanged={onChanged} />}
        {gallery.map((p) => (
          <PhotoTile key={p.id} salonId={salonId} photo={p} onChanged={onChanged} />
        ))}
      </View>
      {photos.length === 0 && <Text style={styles.emptyText}>{t.noPhotosYet}</Text>}
      <AddPhotoButton
        salonId={salonId}
        type={PhotoType.COVER}
        label={cover ? t.replaceCoverPhoto : t.addCoverPhoto}
        onAdded={onChanged}
      />
      <AddPhotoButton salonId={salonId} type={PhotoType.GALLERY} label={t.addGalleryPhoto} onAdded={onChanged} />
    </>
  );
}

// ---------- Payment QR ----------

export function PaymentQrSection({
  salonId,
  paymentQr,
  onChanged,
}: {
  salonId: string;
  paymentQr: SalonPaymentQrDto | null;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const [linkUrl, setLinkUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveLink() {
    const parsed = salonPhotoUrlSchema.safeParse(linkUrl.trim());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.couldNotSavePaymentQr);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await apiFetch(scope(salonId, DASHBOARD_PATHS.paymentQr), {
        method: 'PUT',
        body: JSON.stringify({ url: parsed.data }),
      });
      setLinkUrl('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotSavePaymentQr);
    } finally {
      setSaving(false);
    }
  }

  async function pickAndUpload() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(t.photoLibraryAccessNeededForShopPhotos);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > SALON_PHOTO_UPLOAD.maxBytes) {
      setError(`${t.photoOverSizeLimitPrefix}${Math.floor(SALON_PHOTO_UPLOAD.maxBytes / (1024 * 1024))}${t.photoOverSizeLimitSuffix}`);
      return;
    }
    setSaving(true);
    try {
      await uploadImageAsset(asset, 'payment-qr.jpg', (prepared) =>
        apiUploadImage(`${scope(salonId, DASHBOARD_PATHS.paymentQr)}/${DASHBOARD_PATHS.photoUpload}`, prepared),
      );
      onChanged();
    } catch (err) {
      setError(
        err instanceof ImageUploadPreparationError
          ? IMAGE_UPLOAD_PREPARATION_MESSAGE
          : err instanceof ApiError
            ? err.message
            : err instanceof NativeUploadError
              ? err.message
            : t.couldNotSavePaymentQr,
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      await apiFetch(scope(salonId, DASHBOARD_PATHS.paymentQr), { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotRemovePaymentQr);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <Text style={styles.sectionTitle}>{t.paymentQrSectionTitle}</Text>
      <Text style={styles.hint}>{t.paymentQrSectionHint}</Text>
      {paymentQr?.paymentQrImageUrl ? (
        <View style={styles.photoTile}>
          <SafeImage url={paymentQr.paymentQrImageUrl} alt={t.paymentQrSectionTitle} style={styles.photoImage} />
          <View style={styles.photoTileFoot}>
            <Text style={styles.photoTypeLabel}>{t.paymentQrConfiguredLabel}</Text>
            <Pressable onPress={() => void remove()} disabled={removing}>
              <Text style={styles.rowAction}>{removing ? t.removingEllipsis : t.removePaymentQrAction}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Text style={styles.emptyText}>{t.noPaymentQrConfiguredLabel}</Text>
      )}
      {error && <InlineError message={error} />}
      <View style={styles.inlineRow}>
        <TextInput
          style={[styles.input, styles.inputHalf]}
          placeholder="https://example.com/my-upi-qr.png"
          autoCapitalize="none"
          keyboardType="url"
          value={linkUrl}
          onChangeText={setLinkUrl}
        />
      </View>
      <Button
        title={saving ? t.savingEllipsis : t.linkPaymentQrAction}
        variant="outline"
        onPress={() => void saveLink()}
        loading={saving}
        disabled={!linkUrl.trim()}
        style={styles.addButton}
      />
      <Button
        title={saving ? t.savingEllipsis : t.uploadPaymentQrAction}
        variant="outline"
        onPress={() => void pickAndUpload()}
        loading={saving}
        style={styles.addButton}
      />
    </>
  );
}

// ---------- Hours ----------

export function HoursEditor({ salonId, hours, onSaved }: { salonId: string; hours: OperatingHoursDto[]; onSaved: (h: OperatingHoursDto[]) => void }) {
  const { t } = useLanguage();
  const [days, setDays] = useState(() =>
    Array.from({ length: 7 }, (_, dayOfWeek) => {
      const existing = hours.find((h) => h.dayOfWeek === dayOfWeek);
      return existing ?? { dayOfWeek, openTime: '09:00', closeTime: '21:00', isClosed: dayOfWeek === 0 };
    }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateDay(dayOfWeek: number, patch: Partial<OperatingHoursDto>) {
    setDays((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  }

  const invalidDay = days.find(
    (d) => !d.isClosed && (!TIME_OF_DAY_REGEX.test(d.openTime) || !TIME_OF_DAY_REGEX.test(d.closeTime) || d.closeTime <= d.openTime),
  );

  async function save() {
    setError(null);
    if (invalidDay) {
      setError(`${t.checkHoursPrefix}${t.dayAbbreviations[invalidDay.dayOfWeek]}${t.checkHoursSuffix}`);
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch<OperatingHoursDto[]>(scope(salonId, DASHBOARD_PATHS.operatingHours), {
        method: 'PUT',
        body: JSON.stringify({ days }),
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotSaveHours);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      {error && <InlineError message={error} />}
      {days.map((d) => (
        <View key={d.dayOfWeek} style={styles.hoursEditRow}>
          <Text style={styles.hoursDay}>{t.dayAbbreviations[d.dayOfWeek]}</Text>
          <Pressable
            style={[styles.dayToggle, !d.isClosed && styles.dayToggleOpen]}
            onPress={() => updateDay(d.dayOfWeek, { isClosed: !d.isClosed })}
          >
            <Text style={[styles.dayToggleText, !d.isClosed && styles.dayToggleTextOpen]}>{d.isClosed ? t.slotsClosedLabel : t.openToggleLabel}</Text>
          </Pressable>
          {!d.isClosed && (
            <>
              <TextInput
                style={styles.timeInput}
                value={d.openTime}
                onChangeText={(v) => updateDay(d.dayOfWeek, { openTime: v })}
                placeholder="09:00"
                placeholderTextColor={color.muted}
                maxLength={5}
              />
              <Text style={styles.hoursDash}>–</Text>
              <TextInput
                style={styles.timeInput}
                value={d.closeTime}
                onChangeText={(v) => updateDay(d.dayOfWeek, { closeTime: v })}
                placeholder="21:00"
                placeholderTextColor={color.muted}
                maxLength={5}
              />
            </>
          )}
        </View>
      ))}
      <Button title={t.saveHoursAction} onPress={() => void save()} loading={saving} style={styles.addButton} />
    </View>
  );
}

// ---------- Staff ----------

export function AddStaffForm({ salonId, onAdded }: { salonId: string; onAdded: () => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneValid = e164PhoneSchema.safeParse(phone).success;

  async function submit() {
    setError(null);
    if (!phoneValid) {
      setError(t.invalidPhoneFormatHint);
      return;
    }
    setSaving(true);
    try {
      await apiFetch(scope(salonId, DASHBOARD_PATHS.staff), {
        method: 'POST',
        body: JSON.stringify({ displayName, phone, ...(email.trim() ? { email: email.trim() } : {}) }),
      });
      setDisplayName('');
      setPhone('');
      setEmail('');
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotAddBarber);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return <Button title={t.addBarber} variant="outline" onPress={() => setOpen(true)} style={styles.addButton} />;

  return (
    <View style={styles.editPanel}>
      {error && <InlineError message={error} />}
      <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder={t.barberNamePlaceholder} placeholderTextColor={color.muted} />
      <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder={t.phoneNumberPlaceholder} placeholderTextColor={color.muted} keyboardType="phone-pad" />
      <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder={t.emailOptionalPlaceholder} placeholderTextColor={color.muted} keyboardType="email-address" autoCapitalize="none" />
      <View style={styles.actionRow}>
        <Button title={t.addAction} onPress={() => void submit()} loading={saving} disabled={!displayName || !phone} style={styles.actionButton} />
        <Button title={t.cancelAction} variant="outline" onPress={() => setOpen(false)} style={styles.actionButton} />
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  sectionTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink, marginTop: space[5], marginBottom: space[3] },
  card: { marginBottom: space[2] },
  emptyText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: color.border },
  rowBody: { flex: 1 },
  rowTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  rowTitleInactive: { color: color.muted, textDecorationLine: 'line-through' },
  rowMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  rowAction: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.accent, marginLeft: space[3] },
  editPanel: { paddingVertical: space[2] },
  input: {
    minHeight: 46,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    color: color.ink,
    fontFamily: font.bodyRegular,
    paddingHorizontal: space[3],
    fontSize: fontSize.sm,
    marginBottom: space[2],
  },
  inlineRow: { flexDirection: 'row', gap: space[2] },
  inputHalf: { flex: 1 },
  actionRow: { flexDirection: 'row', gap: space[2], marginTop: space[1] },
  actionButton: { flex: 1 },
  addButton: { marginBottom: space[2] },
  hint: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginBottom: space[3] },

  hoursEditRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: color.border },
  hoursDay: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink, width: 34 },
  dayToggle: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border },
  dayToggleOpen: { borderColor: color.accent, backgroundColor: color.accentSoft },
  dayToggleText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.muted },
  dayToggleTextOpen: { color: color.accent },
  timeInput: {
    flex: 1,
    minHeight: 40,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    color: color.ink,
    fontFamily: font.bodyRegular,
    fontSize: fontSize.xs,
    textAlign: 'center',
  },
  hoursDash: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginBottom: space[3] },
  photoTile: { width: '47%' },
  photoImage: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.sm },
  photoTileFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[1] },
  photoTypeLabel: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.muted },
});
