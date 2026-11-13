import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ChairStatus,
  DASHBOARD_PATHS,
  Language,
  type BulkChairDeactivationPreviewDto,
  type BulkChairDeactivationResultDto,
  type SalonChairDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import {
  applyChairRemoval,
  planFromPreview,
  previewSelection,
  type ChairRemovalPlan,
  type ChairRemovalSummary,
  type ChairRemovalVerdict,
} from '../../lib/chair-bulk-removal';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, InlineError } from '../ui';
import { PermanentDeletePanel } from './StaffAdmin';

/**
 * Website parity for apps/web/components/dashboard/ChairBulkActions.tsx (+ the chairs page's
 * permanent delete): select chairs, let the SERVER review which can be taken out of capacity (in-use
 * chairs are blocked, already-inactive ones skipped), then apply only the reviewed chairs with their
 * reviewed version — a chair that changed since the review is refused, never removed. Chairs are taken
 * out of capacity, not deleted; history stays. Helpers are the website's lib/chair-bulk-removal.ts.
 */
const VERDICT: Record<ChairRemovalVerdict, { en: string; hi: string }> = {
  REMOVE: { en: 'Will be removed', hi: 'हटाई जाएगी' },
  BLOCKED: { en: 'Cannot be removed now', hi: 'अभी नहीं हट सकती' },
  SKIP: { en: 'Already removed', hi: 'पहले से हटाई गई' },
};

export function ChairBulkRemoval({ salonId, chairs, language, onChanged }: {
  salonId: string;
  chairs: SalonChairDto[];
  language: Language;
  onChanged: () => void;
}) {
  const hi = language === Language.HI;
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.chairs}`;
  const selectable = chairs.filter((c) => c.status === ChairStatus.ACTIVE);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<'idle' | 'checking' | 'review' | 'running' | 'done'>('idle');
  const [plan, setPlan] = useState<ChairRemovalPlan | null>(null);
  const [summary, setSummary] = useState<ChairRemovalSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (selectable.length === 0 && !summary) return null;
  const toggle = (id: string) => setChosen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const review = async () => {
    const ids = selectable.filter((c) => chosen.has(c.id)).map((c) => c.id);
    setError(null); setSummary(null); setPhase('checking');
    try {
      const reviewed = await previewSelection(ids, (chairIds) => apiFetch<BulkChairDeactivationPreviewDto>(`${base}/bulk-deactivate/preview`, { method: 'POST', body: JSON.stringify({ chairIds }) }));
      setPlan(planFromPreview(ids, chairs, reviewed));
      setPhase('review');
    } catch (err) {
      setPlan(null);
      setError(err instanceof ApiError ? err.message : hi ? 'जाँच नहीं हो सकी। कुछ नहीं हटाया गया।' : 'Could not check which chairs are in use. Nothing was removed.');
      setPhase('idle');
    }
  };

  const confirm = async () => {
    if (!plan) return;
    setPhase('running');
    const result = await applyChairRemoval({
      plan,
      requestApply: (items) => apiFetch<BulkChairDeactivationResultDto>(`${base}/bulk-deactivate/apply`, { method: 'POST', body: JSON.stringify({ items }) }),
      describeError: (err) => (err instanceof ApiError ? err.message : 'The request failed.'),
    });
    setSummary(result); setPlan(null); setPhase('done'); setChosen(new Set());
    onChanged();
  };

  return (
    <View style={styles.box} accessibilityLabel={hi ? 'कई कुर्सियाँ एक साथ' : 'Bulk chair actions'}>
      {selectable.length > 0 && phase !== 'review' && (
        <>
          <Text style={styles.strong}>{hi ? 'कई कुर्सियाँ एक साथ हटाएँ' : 'Take several chairs out of use'}</Text>
          <View style={styles.chips}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: chosen.size === selectable.length }} onPress={() => setChosen(chosen.size === selectable.length ? new Set() : new Set(selectable.map((c) => c.id)))} style={[styles.chip, chosen.size === selectable.length && styles.chipOn]}>
              <Text style={styles.chipText}>{`${hi ? 'सभी चुनें' : 'Select all'} (${selectable.length})`}</Text>
            </Pressable>
            {selectable.map((c) => (
              <Pressable key={c.id} accessibilityRole="checkbox" accessibilityLabel={c.label} accessibilityState={{ checked: chosen.has(c.id) }} onPress={() => toggle(c.id)} style={[styles.chip, chosen.has(c.id) && styles.chipOn]}>
                <Text style={styles.chipText}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
          <Button title={phase === 'checking' ? (hi ? 'जाँच हो रही है…' : 'Checking…') : `${hi ? 'हटाने की समीक्षा' : 'Review removal'}${chosen.size ? ` (${chosen.size})` : ''}`} variant="outline" onPress={() => void review()} disabled={chosen.size === 0 || phase === 'checking' || phase === 'running'} />
        </>
      )}
      {!!error && <InlineError message={error} />}
      {plan && phase === 'review' && (
        <>
          <Text style={styles.strong}>{hi ? `${plan.items.length} कुर्सियों की समीक्षा` : `Review removal of ${plan.items.length} chair${plan.items.length === 1 ? '' : 's'}`}</Text>
          <Text style={styles.muted}>{hi ? 'कुर्सियाँ हटाई नहीं जातीं, सिर्फ़ उपयोग से बाहर होती हैं। इतिहास बना रहता है।' : 'Chairs are taken out of active capacity, not deleted. Past bookings and service history stay intact, and you can restore a chair later.'}</Text>
          {plan.leavesNoActiveChairs && <Text style={styles.warn}>{hi ? 'इसके बाद कोई कुर्सी उपयोग में नहीं रहेगी।' : 'After this, none of your chairs will be in use. Customers cannot be seated until you restore or add a chair.'}</Text>}
          {plan.items.map((item) => (
            <View key={item.chairId} style={styles.item}>
              <Text style={styles.label}>{`${item.label} — ${VERDICT[item.verdict][hi ? 'hi' : 'en']}`}</Text>
              {item.messages.map((m, i) => <Text key={i} style={styles.muted}>{m}</Text>)}
            </View>
          ))}
          <View style={styles.row}>
            <Button title={hi ? `${plan.removableIds.length} हटाएँ` : `Remove ${plan.removableIds.length} chair${plan.removableIds.length === 1 ? '' : 's'}`} variant="secondary" onPress={() => void confirm()} disabled={plan.removableIds.length === 0} style={styles.btn} />
            <Button title={hi ? 'रद्द करें' : 'Cancel'} variant="outline" onPress={() => { setPlan(null); setPhase('idle'); }} style={styles.btn} />
          </View>
        </>
      )}
      {phase === 'running' && <Text style={styles.muted}>{hi ? 'हटाया जा रहा है…' : 'Removing chairs…'}</Text>}
      {summary && phase === 'done' && (
        <>
          <Text style={styles.strong}>{`${summary.removed} ${hi ? 'हटाई गईं' : 'removed'}${summary.blocked ? `, ${summary.blocked} ${hi ? 'नहीं हटीं' : 'not removed'}` : ''}${summary.failed ? `, ${summary.failed} ${hi ? 'विफल' : 'failed'}` : ''}${summary.skipped ? `, ${summary.skipped} ${hi ? 'पहले से' : 'already removed'}` : ''}`}</Text>
          {summary.results.filter((r) => r.outcome !== 'REMOVED').map((r) => <Text key={r.chairId} style={styles.muted}>{`${r.label}: ${r.message}`}</Text>)}
          <Button title={hi ? 'ठीक है' : 'Done'} variant="outline" onPress={() => { setSummary(null); setPhase('idle'); }} />
        </>
      )}
    </View>
  );
}

export function ChairDeleteAction({ salonId, chair, language, onDeleted }: { salonId: string; chair: SalonChairDto; language: Language; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const hi = language === Language.HI;
  return open
    ? <PermanentDeletePanel kind="chair" salonId={salonId} targetId={chair.id} language={language} onClose={() => setOpen(false)} onDeleted={() => { setOpen(false); onDeleted(); }} />
    : <Pressable accessibilityRole="button" accessibilityLabel={`${hi ? 'स्थायी रूप से हटाएँ' : 'Delete permanently'} ${chair.label}`} onPress={() => setOpen(true)}><Text style={styles.link}>{hi ? 'स्थायी रूप से हटाएँ' : 'Delete permanently'}</Text></Pressable>;
}

const styles = StyleSheet.create({
  box: { gap: space[2], marginTop: space[3], padding: space[3], borderRadius: radius.sm, borderWidth: 1, borderColor: color.border },
  strong: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.sm },
  label: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs },
  warn: { fontFamily: font.bodyBold, color: color.warn, fontSize: fontSize.sm },
  link: { fontFamily: font.bodySemiBold, color: color.warn, fontSize: fontSize.xs, paddingVertical: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: color.surface },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
  item: { paddingVertical: space[1] },
  row: { flexDirection: 'row', gap: space[2] },
  btn: { flex: 1 },
});
