import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
  type OperatingHoursDto,
  type PhotoDto,
  type SalonChairDto,
  type SalonStaffDto,
  type ServiceDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Screen, SectionHeader, Card, Button, EmptyState, Skeleton, InlineError, SafeImage } from '../../components/ui';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

function scope(salonId: string, segment: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${segment}`;
}

// ---------- Services ----------

function ServiceRow({ salonId, service, onChanged }: { salonId: string; service: ServiceDto; onChanged: () => void }) {
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

function AddServiceForm({ salonId, onAdded }: { salonId: string; onAdded: () => void }) {
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

function ChairRow({ salonId, chair, onChanged }: { salonId: string; chair: SalonChairDto; onChanged: () => void }) {
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isActive = chair.status === ChairStatus.ACTIVE;

  // Chairs are never hard-deleted (foreign-keyed from ServiceSession/QueueEntry) — "Remove" sets
  // status to INACTIVE, the same soft-delete convention services use for isActive.
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

function AddChairForm({ salonId, onAdded }: { salonId: string; onAdded: () => void }) {
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

function PhotoTile({ salonId, photo, onChanged }: { salonId: string; photo: PhotoDto; onChanged: () => void }) {
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

function AddPhotoButton({
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
      const form = new FormData();
      // Same {uri, name, type} shape StyleAdvisorScreen already uses for a native multipart part.
      form.append('image', {
        uri: asset.uri,
        name: asset.fileName ?? 'photo.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      } as unknown as Blob);
      form.append('type', type);
      await apiFetch(`${scope(salonId, DASHBOARD_PATHS.photos)}/${DASHBOARD_PATHS.photoUpload}`, {
        method: 'POST',
        body: form,
      });
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload that photo.');
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

function PhotosSection({ salonId, photos, onChanged }: { salonId: string; photos: PhotoDto[]; onChanged: () => void }) {
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

// ---------- Hours ----------

function HoursEditor({ salonId, hours, onSaved }: { salonId: string; hours: OperatingHoursDto[]; onSaved: (h: OperatingHoursDto[]) => void }) {
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

function AddStaffForm({ salonId, onAdded }: { salonId: string; onAdded: () => void }) {
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

// ---------- Screen ----------

export default function OwnerShopScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<OwnerShopStackParamList>>();
  const { selectedSalonId, selectedSalon } = useSalon();
  const { t } = useLanguage();
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [chairs, setChairs] = useState<SalonChairDto[]>([]);
  const [staff, setStaff] = useState<SalonStaffDto[]>([]);
  const [hours, setHours] = useState<OperatingHoursDto[]>([]);
  const [photos, setPhotos] = useState<PhotoDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((isRefresh = false) => {
    if (!selectedSalonId) return Promise.resolve();
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    return Promise.all([
      apiFetch<ServiceDto[]>(scope(selectedSalonId, DASHBOARD_PATHS.services)),
      apiFetch<SalonChairDto[]>(scope(selectedSalonId, DASHBOARD_PATHS.chairs)),
      apiFetch<SalonStaffDto[]>(scope(selectedSalonId, DASHBOARD_PATHS.staff)),
      apiFetch<OperatingHoursDto[]>(scope(selectedSalonId, DASHBOARD_PATHS.operatingHours)),
      apiFetch<PhotoDto[]>(scope(selectedSalonId, DASHBOARD_PATHS.photos)),
    ])
      .then(([s, c, st, h, p]) => {
        setServices(s);
        setChairs(c);
        setStaff(st);
        setHours(h);
        setPhotos(p);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load your shop.'))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [selectedSalonId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!selectedSalonId) {
    return (
      <Screen scroll={false}>
        <EmptyState title={t.selectShopTitle} message={t.chooseShopHint} />
      </Screen>
    );
  }
  if (loading) {
    return (
      <Screen>
        <Skeleton style={styles.skeleton} />
        <Skeleton style={styles.skeleton} />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen scroll={false}>
        <InlineError message={error} />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.screenContent} refreshing={refreshing} onRefresh={() => void load(true)}>
      <SectionHeader eyebrow={t.ownerEyebrow} title={selectedSalon?.name ?? t.tabShop} subtitle={t.shopSubtitle} />

      <Text style={styles.sectionTitle}>{t.servicesLabel}</Text>
      <Card style={styles.card}>
        {services.length === 0 ? (
          <Text style={styles.emptyText}>{t.noServicesYet}</Text>
        ) : (
          services.map((s) => <ServiceRow key={s.id} salonId={selectedSalonId} service={s} onChanged={() => void load()} />)
        )}
      </Card>
      <AddServiceForm salonId={selectedSalonId} onAdded={() => void load()} />

      <Text style={styles.sectionTitle}>{t.chairsLabel}</Text>
      <Card style={styles.card}>
        {chairs.length === 0 ? (
          <Text style={styles.emptyText}>{t.noChairsYet}</Text>
        ) : (
          chairs.map((c) => <ChairRow key={c.id} salonId={selectedSalonId} chair={c} onChanged={() => void load()} />)
        )}
      </Card>
      <AddChairForm salonId={selectedSalonId} onAdded={() => void load()} />

      <Text style={styles.sectionTitle}>{t.staffLabel}</Text>
      <Card style={styles.card}>
        {staff.length === 0 ? (
          <Text style={styles.emptyText}>{t.noBarbersYet}</Text>
        ) : (
          staff.map((member) => (
            <View key={member.id} style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{member.displayName}</Text>
                <Text style={styles.rowMeta}>
                  {member.status} {member.hasPassword ? '' : t.invitePendingSuffix}
                </Text>
              </View>
            </View>
          ))
        )}
      </Card>
      <AddStaffForm salonId={selectedSalonId} onAdded={() => void load()} />

      <Text style={styles.sectionTitle}>{t.hoursLabel}</Text>
      <Card style={styles.card}>
        <HoursEditor salonId={selectedSalonId} hours={hours} onSaved={setHours} />
      </Card>

      <PhotosSection salonId={selectedSalonId} photos={photos} onChanged={() => void load()} />

      <Text style={styles.sectionTitle}>{t.customersLabel}</Text>
      <Text style={styles.hint}>{t.customersHint}</Text>
      <Button title={t.viewCustomers} variant="outline" onPress={() => navigation.navigate('OwnerCustomers')} style={styles.addButton} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeleton: { height: 100, borderRadius: radius.lg, marginBottom: space[3] },
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

  // Hours
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

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginBottom: space[3] },
  photoTile: { width: '47%' },
  photoImage: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.sm },
  photoTileFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[1] },
  photoTypeLabel: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: color.muted },
});
