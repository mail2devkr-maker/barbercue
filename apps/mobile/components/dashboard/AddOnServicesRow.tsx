import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  Language,
  MAX_QUEUE_ADD_ONS,
  type QueueEntryDetailDto,
  type ServiceOptionDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, InlineError } from '../ui';

/**
 * Live-visit add-on mission (17 Nov 2026) — Android and iOS share this exact component (no Platform
 * branches). The customer asks for one more service at the shop (beard, head massage...): the owner or
 * barber adds it to the live visit; the server lengthens the visit, recomputes everyone's wait, keeps
 * the barber reserved for it and bills it on the invoice.
 */
export function AddOnServicesRow({
  entry,
  services,
  onChanged,
}: {
  entry: QueueEntryDetailDto;
  services: ServiceOptionDto[];
  onChanged: () => void;
}) {
  const { language } = useLanguage();
  const hi = language === Language.HI;
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addOns = entry.addOns ?? [];
  const taken = new Set<string>([...(entry.serviceId ? [entry.serviceId] : []), ...addOns.map((a) => a.serviceId)]);
  const choices = services.filter((s) => !taken.has(s.id));
  const atLimit = addOns.length >= MAX_QUEUE_ADD_ONS;
  const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.queueEntries}/${entry.id}/${DASHBOARD_PATHS.addOns}`;

  async function add(serviceId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(path, {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify({ serviceId }),
      });
      setPicking(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : hi ? 'सेवा नहीं जोड़ी जा सकी।' : 'Could not add this service.');
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) onChanged();
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(serviceId: string, name: string) {
    Alert.alert(
      hi ? 'सेवा हटाएँ?' : 'Remove this service?',
      hi ? `${name} इस विज़िट से हटा दी जाएगी।` : `${name} will be removed from this visit.`,
      [
        { text: hi ? 'रहने दें' : 'Keep', style: 'cancel' },
        { text: hi ? 'हटाएँ' : 'Remove', style: 'destructive', onPress: () => void remove(serviceId) },
      ],
    );
  }

  async function remove(serviceId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${path}/${serviceId}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : hi ? 'सेवा नहीं हटाई जा सकी।' : 'Could not remove this service.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {addOns.length > 0 && (
        <View style={styles.chipRow} accessibilityLabel={hi ? 'दुकान पर जोड़ी गई सेवाएँ' : 'Services added at the shop'}>
          {addOns.map((a) => (
            <Pressable
              key={a.serviceId}
              accessibilityRole="button"
              accessibilityLabel={hi ? `${a.name} हटाएँ` : `Remove ${a.name}`}
              disabled={busy}
              onPress={() => confirmRemove(a.serviceId, a.name)}
              style={styles.addOnChip}
            >
              <Text style={styles.addOnChipText}>{`+ ${a.name} · ${a.durationMinutes} min  ×`}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {picking ? (
        <View>
          <Text style={styles.label}>{hi ? 'कौन-सी सेवा जोड़ें?' : 'Which service to add?'}</Text>
          <View style={styles.chipRow}>
            {choices.map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={hi ? `${s.name} जोड़ें` : `Add ${s.name}`}
                disabled={busy}
                onPress={() => void add(s.id)}
                style={styles.choiceChip}
              >
                <Text style={styles.choiceText}>
                  {s.name}
                  {s.durationMinutes ? ` · ${s.durationMinutes} min` : ''}
                  {typeof s.price === 'number' ? ` · ₹${s.price}` : ''}
                </Text>
              </Pressable>
            ))}
          </View>
          <Button title={hi ? 'बंद करें' : 'Close'} variant="outline" onPress={() => setPicking(false)} style={styles.button} />
        </View>
      ) : (
        <Button
          title={hi ? '+ सेवा जोड़ें' : '+ Add service'}
          variant="outline"
          loading={busy}
          disabled={atLimit || choices.length === 0}
          onPress={() => setPicking(true)}
          style={styles.button}
        />
      )}
      {error && <InlineError message={error} />}
    </View>
  );
}

/** "Haircut + Beard Trim" — the visit's own service(s) followed by anything added at the shop. */
export function visitServiceLabel(entry: QueueEntryDetailDto): string | null {
  const added = (entry.addOns ?? []).map((a) => a.name);
  const parts = [entry.serviceName, ...added].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(' + ') : null;
}

const styles = StyleSheet.create({
  wrap: { marginTop: space[2], gap: space[2] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  addOnChip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: color.accentSoft,
  },
  addOnChipText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.accent },
  choiceChip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  choiceText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.ink },
  label: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink, marginBottom: space[2] },
  button: { marginTop: space[1] },
});
