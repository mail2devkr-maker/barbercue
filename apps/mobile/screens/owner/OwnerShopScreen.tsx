import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  ChairStatus,
  DASHBOARD_PATHS,
  formatMoney,
  type OperatingHoursDto,
  type SalonChairDto,
  type SalonStaffDto,
  type ServiceDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Screen, SectionHeader, Card, Button, EmptyState, Skeleton, InlineError } from '../../components/ui';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function scope(salonId: string, segment: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${segment}`;
}

// ---------- Services ----------

function ServiceRow({ salonId, service, onChanged }: { salonId: string; service: ServiceDto; onChanged: () => void }) {
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
      setError(err instanceof ApiError ? err.message : 'Could not save this service.');
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
      setError(err instanceof ApiError ? err.message : 'Could not update this service.');
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
            {formatMoney(service.price, null)} · {service.durationMinutes} min {service.isActive ? '' : '· Inactive'}
          </Text>
        </View>
        <Pressable onPress={() => setEditing(true)}>
          <Text style={styles.rowAction}>Edit</Text>
        </Pressable>
        <Pressable onPress={() => void toggleActive()} disabled={saving}>
          <Text style={styles.rowAction}>{service.isActive ? 'Deactivate' : 'Activate'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.editPanel}>
      {error && <InlineError message={error} />}
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Service name" placeholderTextColor={color.muted} />
      <View style={styles.inlineRow}>
        <TextInput style={[styles.input, styles.inputHalf]} value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="Price" placeholderTextColor={color.muted} />
        <TextInput style={[styles.input, styles.inputHalf]} value={duration} onChangeText={setDuration} keyboardType="numeric" placeholder="Minutes" placeholderTextColor={color.muted} />
      </View>
      <View style={styles.actionRow}>
        <Button title="Save" onPress={() => void save()} loading={saving} style={styles.actionButton} />
        <Button title="Cancel" variant="outline" onPress={() => setEditing(false)} style={styles.actionButton} />
      </View>
    </View>
  );
}

function AddServiceForm({ salonId, onAdded }: { salonId: string; onAdded: () => void }) {
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
      setError(err instanceof ApiError ? err.message : 'Could not add this service.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return <Button title="Add service" variant="outline" onPress={() => setOpen(true)} style={styles.addButton} />;

  return (
    <View style={styles.editPanel}>
      {error && <InlineError message={error} />}
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Service name" placeholderTextColor={color.muted} />
      <View style={styles.inlineRow}>
        <TextInput style={[styles.input, styles.inputHalf]} value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="Price" placeholderTextColor={color.muted} />
        <TextInput style={[styles.input, styles.inputHalf]} value={duration} onChangeText={setDuration} keyboardType="numeric" placeholder="Minutes" placeholderTextColor={color.muted} />
      </View>
      <View style={styles.actionRow}>
        <Button title="Add" onPress={() => void submit()} loading={saving} disabled={!name || !price || !duration} style={styles.actionButton} />
        <Button title="Cancel" variant="outline" onPress={() => setOpen(false)} style={styles.actionButton} />
      </View>
    </View>
  );
}

// ---------- Chairs ----------

function ChairRow({ salonId, chair, onChanged }: { salonId: string; chair: SalonChairDto; onChanged: () => void }) {
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
      setError(err instanceof ApiError ? err.message : 'Could not update this chair.');
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
        <Text style={styles.rowAction}>{isActive ? 'Remove' : 'Reactivate'}</Text>
      </Pressable>
    </View>
  );
}

function AddChairForm({ salonId, onAdded }: { salonId: string; onAdded: () => void }) {
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
      setError(err instanceof ApiError ? err.message : 'Could not add this chair.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return <Button title="Add chair" variant="outline" onPress={() => setOpen(true)} style={styles.addButton} />;

  return (
    <View style={styles.editPanel}>
      {error && <InlineError message={error} />}
      <TextInput style={styles.input} value={label} onChangeText={setLabel} placeholder="Chair label" placeholderTextColor={color.muted} />
      <View style={styles.actionRow}>
        <Button title="Add" onPress={() => void submit()} loading={saving} disabled={!label} style={styles.actionButton} />
        <Button title="Cancel" variant="outline" onPress={() => setOpen(false)} style={styles.actionButton} />
      </View>
    </View>
  );
}

// ---------- Screen ----------

export default function OwnerShopScreen() {
  const { selectedSalonId, selectedSalon } = useSalon();
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [chairs, setChairs] = useState<SalonChairDto[]>([]);
  const [staff, setStaff] = useState<SalonStaffDto[]>([]);
  const [hours, setHours] = useState<OperatingHoursDto[]>([]);
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
    ])
      .then(([s, c, st, h]) => {
        setServices(s);
        setChairs(c);
        setStaff(st);
        setHours(h);
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
        <EmptyState title="Select a shop" message="Choose a shop from the Dashboard tab first." />
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
      <SectionHeader eyebrow="Owner" title={selectedSalon?.name ?? 'Shop'} subtitle="Services, chairs, staff, and hours" />

      <Text style={styles.sectionTitle}>Services</Text>
      <Card style={styles.card}>
        {services.length === 0 ? (
          <Text style={styles.emptyText}>No services yet.</Text>
        ) : (
          services.map((s) => <ServiceRow key={s.id} salonId={selectedSalonId} service={s} onChanged={() => void load()} />)
        )}
      </Card>
      <AddServiceForm salonId={selectedSalonId} onAdded={() => void load()} />

      <Text style={styles.sectionTitle}>Chairs</Text>
      <Card style={styles.card}>
        {chairs.length === 0 ? (
          <Text style={styles.emptyText}>No chairs yet.</Text>
        ) : (
          chairs.map((c) => <ChairRow key={c.id} salonId={selectedSalonId} chair={c} onChanged={() => void load()} />)
        )}
      </Card>
      <AddChairForm salonId={selectedSalonId} onAdded={() => void load()} />

      <Text style={styles.sectionTitle}>Staff</Text>
      <Card style={styles.card}>
        {staff.length === 0 ? (
          <Text style={styles.emptyText}>No barbers added yet. Invite staff from the BarberCue web dashboard.</Text>
        ) : (
          staff.map((member) => (
            <View key={member.id} style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{member.displayName}</Text>
                <Text style={styles.rowMeta}>
                  {member.status} {member.hasPassword ? '' : '· Invite pending'}
                </Text>
              </View>
            </View>
          ))
        )}
      </Card>

      <Text style={styles.sectionTitle}>Hours</Text>
      <Card style={styles.card}>
        {hours.length === 0 ? (
          <Text style={styles.emptyText}>Hours not set yet — set them on the BarberCue web dashboard so customers can book ahead.</Text>
        ) : (
          hours
            .slice()
            .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
            .map((h) => (
              <View key={h.dayOfWeek} style={styles.hoursRow}>
                <Text style={styles.hoursDay}>{DAY_LABELS[h.dayOfWeek]}</Text>
                <Text style={styles.hoursValue}>{h.isClosed ? 'Closed' : `${h.openTime} – ${h.closeTime}`}</Text>
              </View>
            ))
        )}
      </Card>
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
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space[1] },
  hoursDay: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink },
  hoursValue: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted },
});
