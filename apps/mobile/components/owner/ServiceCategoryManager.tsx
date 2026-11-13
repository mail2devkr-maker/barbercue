import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { DASHBOARD_PATHS, type SalonServiceDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { existingNode, parseServiceTree, serviceCounts, sortedTree, taxonomyErrorText, validateNodeName, type ServiceTree } from '../../lib/service-taxonomy-web';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, InlineError } from '../ui';

/**
 * Website parity for apps/web/components/dashboard/ServiceCategoryManager.tsx: add, rename and delete
 * service categories and subcategories. Renaming updates the services in it; bookings and invoices
 * keep the names they were made with. A category can be deleted only when nothing is in it — the
 * server enforces both, the screen says so first and asks before deleting. Rules are the website's
 * lib/service-taxonomy.ts (copied).
 */
type Editing = { kind: 'category'; id: string; name: string } | { kind: 'sub'; id: string; categoryId: string; name: string } | null;

export function ServiceCategoryManager({ salonId, onChanged }: { salonId: string; onChanged?: () => void }) {
  const root = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const treePath = `${root}/service-categories`;
  const [tree, setTree] = useState<ServiceTree | null>(null);
  const [services, setServices] = useState<SalonServiceDto[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newSub, setNewSub] = useState<{ categoryId: string; name: string } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);

  const load = useCallback(async () => {
    try {
      const [raw, svc] = await Promise.all([apiFetch<unknown>(treePath), apiFetch<SalonServiceDto[]>(`${root}/${DASHBOARD_PATHS.services}`)]);
      const parsed = parseServiceTree(raw);
      if (!parsed) { setState('error'); setError('The server sent categories in a form this screen cannot read.'); return; }
      setTree(sortedTree(parsed));
      setServices(Array.isArray(svc) ? svc : []);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setState('missing');
      else { setState('error'); setError(err instanceof ApiError ? taxonomyErrorText(err.code, err.message) : 'Could not load your categories.'); }
    }
  }, [treePath, root]);

  useEffect(() => { void load(); }, [load]);

  const write = async (request: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await request();
      setNotice(done); setEditing(null); setNewCategory(''); setNewSub(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? taxonomyErrorText(err.code, err.message) : 'That did not go through. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return <Text style={styles.muted}>…</Text>;
  if (state === 'missing') return <Text style={styles.muted}>Managing categories is not available yet on this server. You can still type a category name when you add or edit a service.</Text>;
  if (state === 'error' || !tree) return <InlineError message={error ?? 'Could not load your categories.'} />;
  const counts = serviceCounts(tree, services);

  const addCategory = () => {
    const problem = validateNodeName(newCategory);
    if (problem) { setError(problem); return; }
    const dup = existingNode(tree, newCategory);
    if (dup) { setError(`You already have a category called “${dup.name}”.`); return; }
    void write(() => apiFetch(treePath, { method: 'POST', body: JSON.stringify({ name: newCategory.trim() }) }), `${newCategory.trim()} added.`);
  };
  const addSubcategory = () => {
    if (!newSub) return;
    const problem = validateNodeName(newSub.name);
    if (problem) { setError(problem); return; }
    const parent = tree.find((c) => c.id === newSub.categoryId);
    const dup = parent ? existingNode(parent.subcategories, newSub.name) : null;
    if (dup) { setError(`This category already has “${dup.name}”.`); return; }
    void write(() => apiFetch(`${treePath}/${newSub.categoryId}/subcategories`, { method: 'POST', body: JSON.stringify({ name: newSub.name.trim() }) }), `${newSub.name.trim()} added.`);
  };
  const saveRename = () => {
    if (!editing) return;
    const problem = validateNodeName(editing.name);
    if (problem) { setError(problem); return; }
    if (editing.kind === 'category') {
      const dup = existingNode(tree, editing.name, editing.id);
      if (dup) { setError(`You already have a category called “${dup.name}”.`); return; }
      void write(() => apiFetch(`${treePath}/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ name: editing.name.trim() }) }), `Renamed to ${editing.name.trim()}.`);
    } else {
      const parent = tree.find((c) => c.id === editing.categoryId);
      const dup = parent ? existingNode(parent.subcategories, editing.name, editing.id) : null;
      if (dup) { setError(`This category already has “${dup.name}”.`); return; }
      void write(() => apiFetch(`${treePath}/${editing.categoryId}/subcategories/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ name: editing.name.trim() }) }), `Renamed to ${editing.name.trim()}.`);
    }
  };
  const remove = (name: string, path: string) => Alert.alert(`Delete ${name}?`, 'Only an empty category or subcategory can be deleted.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => void write(() => apiFetch(path, { method: 'DELETE' }), `${name} deleted.`) },
  ]);

  const renameBox = (
    <View style={styles.row}>
      <TextInput accessibilityLabel="New name" value={editing?.name ?? ''} onChangeText={(v) => setEditing((e) => (e ? { ...e, name: v } : e))} maxLength={60} style={[styles.input, styles.flex]} />
      <Button title="Save" onPress={saveRename} disabled={busy} />
      <Button title="Cancel" variant="outline" onPress={() => setEditing(null)} disabled={busy} />
    </View>
  );

  return (
    <View style={styles.wrap}>
      <Text style={styles.muted}>Renaming updates the services in it; bookings and invoices already made keep the names they had. A category or subcategory can be deleted only when it is empty.</Text>
      <View style={styles.row}>
        <TextInput accessibilityLabel="New category" placeholder="New category" value={newCategory} onChangeText={setNewCategory} maxLength={60} style={[styles.input, styles.flex]} />
        <Button title="Add" onPress={addCategory} disabled={busy} />
      </View>
      {!!error && <InlineError message={error} />}
      {!!notice && <Text style={styles.ok}>{notice}</Text>}
      {tree.length === 0 && <Text style={styles.muted}>You have no categories yet. Add one above, or type a category when you add a service.</Text>}
      {tree.map((category) => {
        const inCategory = counts.categories.get(category.id) ?? 0;
        return (
          <View key={category.id} style={styles.category}>
            {editing?.kind === 'category' && editing.id === category.id ? renameBox : (
              <View style={styles.row}>
                <Text style={[styles.strong, styles.flex]}>{`${category.name} (${inCategory} service${inCategory === 1 ? '' : 's'})`}</Text>
                <Button title={`Rename ${category.name}`} variant="outline" onPress={() => setEditing({ kind: 'category', id: category.id, name: category.name })} />
                {inCategory === 0 && category.subcategories.length === 0 && <Button title={`Delete ${category.name}`} variant="outline" onPress={() => remove(category.name, `${treePath}/${category.id}`)} />}
              </View>
            )}
            {category.subcategories.map((sub) => {
              const inSub = counts.subcategories.get(sub.id) ?? 0;
              return editing?.kind === 'sub' && editing.id === sub.id ? <View key={sub.id}>{renameBox}</View> : (
                <View key={sub.id} style={[styles.row, styles.sub]}>
                  <Text style={[styles.small, styles.flex]}>{`› ${sub.name} (${inSub})`}</Text>
                  <Button title={`Rename ${sub.name}`} variant="outline" onPress={() => setEditing({ kind: 'sub', id: sub.id, categoryId: category.id, name: sub.name })} />
                  {inSub === 0 && <Button title={`Delete ${sub.name}`} variant="outline" onPress={() => remove(sub.name, `${treePath}/${category.id}/subcategories/${sub.id}`)} />}
                </View>
              );
            })}
            {newSub?.categoryId === category.id ? (
              <View style={[styles.row, styles.sub]}>
                <TextInput accessibilityLabel="New subcategory" placeholder="New subcategory" value={newSub.name} onChangeText={(v) => setNewSub({ categoryId: category.id, name: v })} maxLength={60} style={[styles.input, styles.flex]} />
                <Button title="Add" onPress={addSubcategory} disabled={busy} />
              </View>
            ) : <Button title={`+ Subcategory in ${category.name}`} variant="outline" onPress={() => setNewSub({ categoryId: category.id, name: '' })} />}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 140 },
  sub: { paddingLeft: space[4] },
  category: { gap: space[1], paddingVertical: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  strong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  small: { fontFamily: font.bodyRegular, color: color.ink, fontSize: fontSize.sm },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  ok: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.successSoft, padding: space[3], borderRadius: radius.sm },
  input: { minHeight: 44, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, paddingHorizontal: space[3], color: color.ink, fontFamily: font.bodyRegular },
});
