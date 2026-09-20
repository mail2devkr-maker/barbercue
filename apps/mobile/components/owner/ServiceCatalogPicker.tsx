import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  SERVICE_CATALOG,
  SERVICE_CATALOG_CATEGORIES,
  SERVICE_CATALOG_PACKS,
  normalizeServiceIdentity,
  serviceAvailableInPack,
  suggestedServicePriceInr,
  type ServiceCatalogItem,
  type ServiceDto,
  type ServicePackId,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, InlineError } from '../ui';
import { scope } from './ShopSetupSections';

type ExistingService = Pick<ServiceDto, 'id' | 'name' | 'category' | 'isActive'>;
type PresetDraft = { price: string; durationMinutes: string };

/**
 * Find the saved service represented by a catalog preset. Prefer the same name+category identity
 * used by the web picker, but also fall back to normalized name-only matching. The fallback is
 * deliberately conservative: a shop that already has "Classic Haircut" with an empty/legacy
 * category must never get a second "Classic Haircut" just because the preset now has a category.
 */
export function findExistingServiceForPreset(
  services: ExistingService[],
  preset: ServiceCatalogItem,
): ExistingService | undefined {
  const exactIdentity = normalizeServiceIdentity(preset.name, preset.category);
  const nameIdentity = normalizeServiceIdentity(preset.name, null);
  return services.find(
    (service) =>
      normalizeServiceIdentity(service.name, service.category) === exactIdentity ||
      normalizeServiceIdentity(service.name, null) === nameIdentity,
  );
}

/** Mobile counterpart to the web ServiceCatalogPicker. Both consume the same shared catalog. */
export function ServiceCatalogPicker({
  salonId,
  services,
  onChanged,
}: {
  salonId: string;
  services: ServiceDto[];
  onChanged: () => void;
}) {
  const [pack, setPack] = useState<ServicePackId>("BASIC");
  const [category, setCategory] = useState<string>(SERVICE_CATALOG_CATEGORIES[0]);
  const [selected, setSelected] = useState<Record<string, PresetDraft>>({});
  const [saving, setSaving] = useState(false);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitLockRef = useRef(false);

  const existingByPresetId = useMemo(
    () =>
      new Map(
        SERVICE_CATALOG.map((preset) => [preset.id, findExistingServiceForPreset(services, preset)] as const),
      ),
    [services],
  );
  const visible = SERVICE_CATALOG.filter(
    (preset) => serviceAvailableInPack(preset, pack) && preset.category === category,
  );
  const selectablePack = SERVICE_CATALOG.filter(
    (preset) => serviceAvailableInPack(preset, pack) && !findExistingServiceForPreset(services, preset),
  );
  const packCategories = SERVICE_CATALOG_CATEGORIES.filter((name) =>
    SERVICE_CATALOG.some((item) => serviceAvailableInPack(item, pack) && item.category === name),
  );

  function selectCurrentPack() {
    if (saving) return;
    setSelected((current) => {
      const next = { ...current };
      for (const preset of selectablePack) {
        if (!next[preset.id]) {
          next[preset.id] = {
            price: String(suggestedServicePriceInr(preset, pack)),
            durationMinutes: String(preset.defaultDurationMinutes),
          };
        }
      }
      return next;
    });
    setError(null);
  }

  function toggle(preset: ServiceCatalogItem) {
    if (existingByPresetId.get(preset.id) || saving) return;
    setSelected((current) => {
      if (current[preset.id]) {
        const next = { ...current };
        delete next[preset.id];
        return next;
      }
      return {
        ...current,
        [preset.id]: {
          price: String(suggestedServicePriceInr(preset, pack)),
          durationMinutes: String(preset.defaultDurationMinutes),
        },
      };
    });
    setError(null);
  }

  function update(id: string, patch: Partial<PresetDraft>) {
    setSelected((current) => {
      const currentDraft = current[id];
      if (!currentDraft) return current;
      return { ...current, [id]: { ...currentDraft, ...patch } };
    });
  }

  async function addSelected() {
    if (submitLockRef.current) return;
    const choices = SERVICE_CATALOG.filter((preset) => selected[preset.id]);
    if (choices.length === 0) return;

    const invalid = choices.find((preset) => {
      const draft = selected[preset.id];
      const price = Number(draft.price);
      const minutes = Number(draft.durationMinutes);
      return (
        draft.price.trim() === '' ||
        !Number.isFinite(price) ||
        price < 0 ||
        price > 1_000_000 ||
        !Number.isInteger(minutes) ||
        minutes < 5 ||
        minutes > 480
      );
    });
    if (invalid) {
      setError(`Enter a price and a duration from 5 to 480 minutes for ${invalid.name}.`);
      return;
    }

    submitLockRef.current = true;
    setSaving(true);
    setError(null);
    const completedIds: string[] = [];
    try {
      for (const preset of choices) {
        if (findExistingServiceForPreset(services, preset)) continue;
        const draft = selected[preset.id];
        await apiFetch(scope(salonId, DASHBOARD_PATHS.services), {
          method: 'POST',
          body: JSON.stringify({
            name: preset.name,
            category: preset.category,
            price: Number(draft.price),
            durationMinutes: Number(draft.durationMinutes),
          }),
        });
        completedIds.push(preset.id);
      }
      setSelected({});
      onChanged();
    } catch (err) {
      setSelected((current) => {
        const next = { ...current };
        completedIds.forEach((id) => delete next[id]);
        return next;
      });
      setError(err instanceof ApiError ? err.message : 'Could not add all selected services.');
      if (completedIds.length > 0) onChanged();
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  }

  async function reactivate(service: ExistingService) {
    if (reactivatingId || saving) return;
    setReactivatingId(service.id);
    setError(null);
    try {
      await apiFetch(`${scope(salonId, DASHBOARD_PATHS.services)}/${service.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: true }),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reactivate that service.');
    } finally {
      setReactivatingId(null);
    }
  }

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>Choose a service pack</Text>
          <Text style={styles.hint}>
            Core services can have different suggested prices by salon tier. Pick Basic, Standard or Advance; price and time are prefilled and editable.
          </Text>
        </View>
        <Text style={styles.selectionCount}>{Object.keys(selected).length} selected</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryScroller}
      >
        {SERVICE_CATALOG_PACKS.map((packOption) => (
          <Pressable
            key={packOption.id}
            accessibilityRole="button"
            accessibilityState={{ selected: pack === packOption.id }}
            onPress={() => {
              if (packOption.id === pack) return;
              setPack(packOption.id);
              setSelected({});
              const firstCategory = SERVICE_CATALOG.find(
                (item) => serviceAvailableInPack(item, packOption.id),
              )?.category;
              if (firstCategory) setCategory(firstCategory);
              setError(null);
            }}
            style={[styles.categoryChip, pack === packOption.id && styles.categoryChipSelected]}
          >
            <Text style={[styles.categoryChipText, pack === packOption.id && styles.categoryChipTextSelected]}>
              {packOption.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Button
        title={`Select all ${SERVICE_CATALOG_PACKS.find((item) => item.id === pack)?.label ?? "services"}`}
        variant="outline"
        onPress={selectCurrentPack}
        disabled={saving || selectablePack.length === 0}
        style={styles.addButton}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryScroller}
      >
        {packCategories.map((name) => (
          <Pressable
            key={name}
            accessibilityRole="button"
            accessibilityState={{ selected: category === name }}
            onPress={() => setCategory(name)}
            style={[styles.categoryChip, category === name && styles.categoryChipSelected]}
          >
            <Text style={[styles.categoryChipText, category === name && styles.categoryChipTextSelected]}>
              {name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {visible.map((preset) => {
        const draft = selected[preset.id];
        const existing = existingByPresetId.get(preset.id);
        return (
          <View key={preset.id} style={[styles.presetCard, draft && styles.presetCardSelected]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: Boolean(draft) || Boolean(existing?.isActive),
                disabled: Boolean(existing),
              }}
              disabled={Boolean(existing) || saving}
              onPress={() => toggle(preset)}
              style={styles.presetChoice}
            >
              <View style={[styles.checkMark, (draft || existing?.isActive) && styles.checkMarkSelected]}>
                <Text style={styles.checkMarkText}>{draft || existing?.isActive ? '✓' : ''}</Text>
              </View>
              <View style={styles.presetCopy}>
                <Text style={styles.presetName}>{preset.name}</Text>
                <Text style={styles.presetMeta}>
                  ₹{suggestedServicePriceInr(preset, pack)} · {preset.defaultDurationMinutes} min suggested
                </Text>
              </View>
              {existing?.isActive && <Text style={styles.addedBadge}>Added</Text>}
            </Pressable>

            {existing && !existing.isActive && (
              <View style={styles.reactivateRow}>
                <Text style={styles.inactiveText}>Already saved, currently inactive.</Text>
                <Button
                  title={reactivatingId === existing.id ? 'Restoring…' : 'Reactivate'}
                  variant="outline"
                  onPress={() => void reactivate(existing)}
                  loading={reactivatingId === existing.id}
                  disabled={Boolean(reactivatingId) || saving}
                />
              </View>
            )}

            {draft && (
              <View style={styles.inlineRow}>
                <TextInput
                  style={[styles.input, styles.inputHalf]}
                  value={draft.price}
                  onChangeText={(value) => update(preset.id, { price: value })}
                  keyboardType="decimal-pad"
                  placeholder="Suggested price"
                  placeholderTextColor={color.muted}
                />
                <TextInput
                  style={[styles.input, styles.inputHalf]}
                  value={draft.durationMinutes}
                  onChangeText={(value) => update(preset.id, { durationMinutes: value })}
                  keyboardType="numeric"
                  placeholder="Minutes"
                  placeholderTextColor={color.muted}
                />
              </View>
            )}
          </View>
        );
      })}

      {Object.keys(selected).length > 0 && (
        <Button
          title={
            saving
              ? 'Adding services…'
              : `Add ${Object.keys(selected).length} selected service${Object.keys(selected).length === 1 ? '' : 's'}`
          }
          onPress={() => void addSelected()}
          loading={saving}
          disabled={saving || Boolean(reactivatingId)}
          style={styles.addButton}
        />
      )}
      <Text style={styles.customHint}>Need something else? Add a custom service below.</Text>
      {error && <InlineError message={error} />}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: space[3],
    marginBottom: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], marginBottom: space[3] },
  headingCopy: { flex: 1 },
  title: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: color.ink, marginBottom: space[1] },
  hint: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, lineHeight: 18 },
  selectionCount: {
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.xs,
    color: color.accent,
    backgroundColor: color.goldSoft,
    borderRadius: radius.sm,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  categoryScroller: { gap: space[2], paddingBottom: space[3] },
  categoryChip: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 999,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    backgroundColor: color.surface,
  },
  categoryChipSelected: { borderColor: color.accent, backgroundColor: color.goldSoft },
  categoryChipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.muted },
  categoryChipTextSelected: { color: color.accent },
  presetCard: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space[3],
    marginBottom: space[2],
    backgroundColor: color.surface,
  },
  presetCardSelected: { borderColor: color.accent, backgroundColor: color.goldSoft },
  presetChoice: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  checkMark: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  checkMarkSelected: { borderColor: color.accent, backgroundColor: color.accent },
  checkMarkText: { color: '#ffffff', fontFamily: font.bodySemiBold, fontSize: fontSize.xs },
  presetCopy: { flex: 1 },
  presetName: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  presetMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  addedBadge: {
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.xs,
    color: color.success,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  reactivateRow: {
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: color.border,
    gap: space[2],
  },
  inactiveText: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted },
  inlineRow: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    fontFamily: font.bodyRegular,
    fontSize: fontSize.sm,
    color: color.ink,
    backgroundColor: color.surface,
  },
  inputHalf: { flex: 1 },
  addButton: { marginTop: space[2] },
  customHint: {
    fontFamily: font.bodyRegular,
    fontSize: fontSize.xs,
    color: color.muted,
    marginTop: space[3],
    marginBottom: space[2],
  },
});
