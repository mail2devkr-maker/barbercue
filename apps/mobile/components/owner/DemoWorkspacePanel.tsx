import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { DASHBOARD_PATHS } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { isSandbox, isUsable, parseCapabilities, unavailableMessage, type CapabilityMap } from '../../lib/capabilities-web';
import {
  confirmationMatches,
  countRows,
  DELETE_CONFIRMATION,
  DEMO_BANNER,
  deleteBody,
  minorText,
  nameOf,
  parseDeletePreview,
  parseDemoStatus,
  parseDemoView,
  previewExpired,
  SIMULATED_NOTE,
  statusWord,
  type DeletePreview,
  type DemoStatus,
  type DemoView,
} from '../../lib/demo-workspace-web';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * Website parity for apps/web/components/owner/DemoWorkspace.tsx and DemoDashboard.tsx: sample data in
 * a separate private workspace — add it, browse it read-only under a permanent DEMO banner, and delete
 * it with a server confirmation token plus the typed phrase. It never touches the shop's real
 * customers, bookings, revenue or reports. Shown only where the server reports demoData as usable.
 */
export function DemoWorkspacePanel({ salonId }: { salonId: string }) {
  const root = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const base = `${root}/demo`;
  const [caps, setCaps] = useState<CapabilityMap | null | undefined>(undefined);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [view, setView] = useState<DemoView | null>(null);
  const [busy, setBusy] = useState<'loading' | 'import' | 'preview' | 'delete' | 'view' | null>('loading');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [typed, setTyped] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      setStatus(parseDemoStatus(await apiFetch<unknown>(`${base}/status`)));
    } catch (err) {
      setStatus(null);
      setError(err instanceof ApiError ? err.message : 'Could not check your demo data.');
    } finally {
      setBusy(null);
    }
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<unknown>(`${root}/capabilities`).then((raw) => { if (!cancelled) setCaps(parseCapabilities(raw)); }).catch(() => { if (!cancelled) setCaps(null); });
    return () => { cancelled = true; };
  }, [root]);
  const usable = !!caps && isUsable(caps, 'demoData');
  useEffect(() => { if (usable) void loadStatus(); }, [usable, loadStatus]);

  if (caps === undefined) return <Text style={styles.muted}>…</Text>;
  if (!usable) return <Card><Text style={styles.heading}>Demo data is not available yet</Text><Text style={styles.muted}>{`${unavailableMessage(caps ?? null, 'demoData')} Nothing about your real shop is affected.`}</Text></Card>;

  const importDemo = async () => {
    setBusy('import'); setError(null); setNotice(null);
    try {
      const next = parseDemoStatus(await apiFetch<unknown>(`${base}/import`, { method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() } }));
      if (!next.active) { setError('The server did not confirm that demo data was added. Check again in a moment.'); await loadStatus(); }
      else { setStatus(next); setNotice('Demo data added to a separate private workspace. Your real shop was not changed.'); }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add demo data.');
    } finally {
      setBusy(null);
    }
  };
  const startDelete = async () => {
    setBusy('preview'); setError(null); setNotice(null);
    try {
      const next = parseDeletePreview(await apiFetch<unknown>(`${base}/delete-preview`, { method: 'POST' }));
      if (!next) setError('The server did not return a confirmation. Nothing was deleted.');
      else { setPreview(next); setTyped(''); }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not prepare the deletion. Nothing was deleted.');
    } finally {
      setBusy(null);
    }
  };
  const confirmDelete = async () => {
    if (!status?.workspaceId || !preview) return;
    if (previewExpired(preview)) { setPreview(null); setError('That confirmation has expired. Start again to delete the demo data.'); return; }
    setBusy('delete'); setError(null);
    try {
      await apiFetch<unknown>(base, { method: 'DELETE', body: JSON.stringify(deleteBody(status.workspaceId, preview.confirmationToken)) });
      setPreview(null); setTyped(''); setView(null);
      await loadStatus();
      setNotice('Demo data deleted. Your real shop data was not changed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the demo data.');
    } finally {
      setBusy(null);
    }
  };
  const openView = async () => {
    if (!status?.workspaceId) return;
    setBusy('view'); setError(null);
    try {
      const parsed = parseDemoView(await apiFetch<unknown>(`${base}/workspaces/${status.workspaceId}`));
      if (!parsed) setError('The demo workspace could not be read.');
      setView(parsed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the demo dashboard.');
    } finally {
      setBusy(null);
    }
  };

  const rows = countRows(status?.counts ?? null);
  const working = busy !== null;
  return (
    <>
      {isSandbox(caps!, 'demoData') && <Text style={styles.info}>This feature is in test mode for your shop.</Text>}
      <Card>
        <Text style={styles.heading}>Demo data</Text>
        <Text style={styles.muted}>Try FastQue with sample customers, staff, services and bookings. Demo data lives in a separate private workspace. It never mixes with your real customers, bookings, revenue or reports.</Text>
        {busy === 'loading' && <Text style={styles.muted}>…</Text>}
        {!!error && <InlineError message={error} />}
        {!!notice && <Text style={styles.ok}>{notice}</Text>}
        {status && !status.active && busy !== 'loading' && (
          <>
            <Text style={styles.muted}>You have no demo data right now.</Text>
            <Button title={busy === 'import' ? 'Adding…' : 'Add demo data'} onPress={() => void importDemo()} disabled={working} />
          </>
        )}
        {status?.active && (
          <>
            <Text style={styles.banner}>{status.label}</Text>
            {rows.map((r) => <View key={r.key} style={styles.line}><Text style={styles.small}>{r.label}</Text><Text style={styles.strong}>{r.value}</Text></View>)}
            <Text style={styles.muted}>Opening the demo dashboard is read-only. Deleting demo data removes only this demo workspace.</Text>
            <Button title={busy === 'view' ? 'Opening…' : view ? 'Refresh demo dashboard' : 'Open demo dashboard'} variant="outline" onPress={() => void openView()} disabled={working} />
            {!preview ? <Button title={busy === 'preview' ? 'Preparing…' : 'Delete demo data'} variant="outline" onPress={() => void startDelete()} disabled={working} /> : (
              <View style={styles.confirm}>
                <Text style={styles.small}>{`This deletes the demo workspace and everything in it. Your real customers, bookings, revenue and reports are not touched. To confirm, type ${DELETE_CONFIRMATION}.`}</Text>
                <TextInput accessibilityLabel="Type the phrase to confirm" value={typed} onChangeText={setTyped} autoCorrect={false} autoCapitalize="characters" style={styles.input} />
                <View style={styles.row}>
                  <Button title={busy === 'delete' ? 'Deleting…' : 'Confirm delete demo data'} onPress={() => void confirmDelete()} disabled={working || !confirmationMatches(typed)} style={styles.flex} />
                  <Button title="Cancel" variant="outline" onPress={() => { setPreview(null); setTyped(''); }} disabled={busy === 'delete'} style={styles.flex} />
                </View>
              </View>
            )}
          </>
        )}
      </Card>
      {view && <DemoViewer view={view} />}
    </>
  );
}

function DemoViewer({ view }: { view: DemoView }) {
  const money = (minor: number) => minorText(minor, view.currency);
  return (
    <Card>
      <Text style={styles.banner}>{DEMO_BANNER}</Text>
      <Text style={styles.muted}>{SIMULATED_NOTE}</Text>
      <Text style={styles.sub}>Revenue by service (simulated)</Text>
      {view.revenue.byService.map((r) => <View key={r.id} style={styles.line}><Text style={styles.small}>{nameOf(view.services, r.id)}</Text><Text style={styles.strong}>{money(r.estimatedValueMinor)}</Text></View>)}
      <Text style={styles.sub}>Revenue by staff (simulated)</Text>
      {view.revenue.byStaff.map((r) => <View key={r.id} style={styles.line}><Text style={styles.small}>{nameOf(view.staff, r.id)}</Text><Text style={styles.strong}>{money(r.estimatedValueMinor)}</Text></View>)}
      <Text style={styles.sub}>{`Bookings (${view.bookings.length})`}</Text>
      {view.bookings.slice(0, 20).map((b) => <View key={b.id} style={styles.line}><Text style={styles.small}>{`${nameOf(view.customers, b.customerId)} · ${b.serviceIds.map((id) => nameOf(view.services, id)).join(", ")}`}</Text><Text style={styles.muted}>{statusWord(b.status)}</Text></View>)}
      <Text style={styles.sub}>{`Services (${view.services.length}) · Staff (${view.staff.length}) · Customers (${view.customers.length})`}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  sub: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm, marginTop: space[3] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  small: { fontFamily: font.bodyRegular, color: color.ink, fontSize: fontSize.sm, flex: 1 },
  strong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  banner: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.goldSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  info: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.accentSoft, padding: space[3], borderRadius: radius.sm },
  ok: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.successSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  confirm: { gap: space[2], marginTop: space[2], padding: space[3], borderRadius: radius.sm, borderWidth: 1, borderColor: color.border },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular },
  row: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
});
