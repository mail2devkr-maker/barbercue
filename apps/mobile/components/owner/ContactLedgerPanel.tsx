import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ContactLedgerSummaryDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { ledgerPath, parseErase, parseSummary, parseWithdraw } from '../../lib/contact-ledger';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * Website parity for apps/web/components/owner/ContactLedgerPanel.tsx: counts of saved agreement records,
 * and the two things a shop must always be able to do for a person — record that they asked to STOP,
 * and ERASE the shop's record of their number. Neither sends anything, and FastQue never shows a saved
 * number back. Shown only where the agreement ledger is SANDBOX-enabled (same gate as the website).
 */
export function ContactLedgerPanel({ salonId, refreshKey = 0 }: { salonId: string; refreshKey?: number }) {
  const [summary, setSummary] = useState<ContactLedgerSummaryDto | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [everywhere, setEverywhere] = useState(false);
  const [keepStopList, setKeepStopList] = useState(true);
  const [confirmErase, setConfirmErase] = useState(false);
  const [busy, setBusy] = useState<'withdraw' | 'erase' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<unknown>(ledgerPath(salonId, '/summary'))
      .then((raw) => {
        const parsed = parseSummary(raw);
        setSummary(parsed);
        setSummaryError(parsed ? null : 'FastQue sent an answer this screen could not read.');
      })
      .catch(() => { setSummary(null); setSummaryError('Could not load your saved records.'); });
  }, [salonId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const describe = (err: unknown): string => {
    if (err instanceof ApiError && err.status === 400) return 'That is not a valid mobile number.';
    if (err instanceof ApiError && err.status === 429) return 'You have done that a lot in a short time. Wait a minute and try again.';
    if (err instanceof ApiError && err.status === 503) return 'Agreement records are not switched on for FastQue yet.';
    return err instanceof ApiError ? err.message : 'That did not work. Nothing was changed.';
  };

  const withdraw = async () => {
    setBusy('withdraw'); setError(null); setNotice(null);
    try {
      const result = parseWithdraw(await apiFetch<unknown>(ledgerPath(salonId, '/withdraw'), { method: 'POST', body: JSON.stringify({ phone, suppressEverywhere: everywhere }) }));
      if (!result) setError('FastQue sent an answer this screen could not read, so nothing is assumed to be changed.');
      else {
        setNotice(result.withdrawn
          ? result.suppressedEverywhere ? 'Saved as asked to stop, and added to the list nobody on FastQue may contact.' : 'Saved as asked to stop.'
          : result.suppressedEverywhere ? 'No record of this number was found at your shop, and it is now on the list nobody on FastQue may contact.' : 'There was no active record of this number at your shop, so nothing changed.');
        setPhone('');
        load();
      }
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(null);
    }
  };

  const erase = async () => {
    setBusy('erase'); setError(null); setNotice(null);
    try {
      const result = parseErase(await apiFetch<unknown>(ledgerPath(salonId, '/erase'), { method: 'POST', body: JSON.stringify({ phone, keepSuppression: keepStopList }) }));
      if (!result) setError('FastQue sent an answer this screen could not read, so nothing is assumed to be erased.');
      else {
        setNotice(result.erased > 0
          ? result.suppressionKept ? 'Your record of this number was erased. Only a do-not-contact marker is kept, so nobody contacts them by mistake.' : 'Your record of this number was erased completely.'
          : result.suppressionKept ? 'Your shop had no record of this number. A do-not-contact marker was kept.' : 'Your shop had no record of this number.');
        setPhone('');
        setConfirmErase(false);
        load();
      }
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(null);
    }
  };

  const hasPhone = phone.trim().length > 0;
  const tick = (label: string, value: boolean, onChange: (v: boolean) => void) => (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={styles.ackRow}>
      <View style={[styles.box, value && styles.boxOn]} />
      <Text style={styles.ackText}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <Card>
        <Text style={styles.heading}>Saved agreement records</Text>
        <Text style={styles.muted}>Counts only. FastQue does not show saved numbers back.</Text>
        {summaryError ? <InlineError message={summaryError} /> : null}
        {summary ? (
          <>
            {([['Agreed', summary.active], ['Asked to stop', summary.withdrawn], ['Out of date', summary.expired], ['Run out within 30 days', summary.expiringWithin30Days]] as const).map(([label, value]) => (
              <View key={label} style={styles.line}><Text style={styles.small}>{label}</Text><Text style={styles.strong}>{String(value)}</Text></View>
            ))}
            <Text style={styles.muted}>{`Records are kept for ${summary.retentionDays} days and then stop counting. Nothing can be sent from here.`}</Text>
          </>
        ) : null}
      </Card>
      <Card>
        <Text style={styles.heading}>Stop contacting someone, or erase a record</Text>
        <Text style={styles.muted}>Enter the phone number. Use this when a person asks you to stop, or asks you to delete what you hold about them.</Text>
        <TextInput accessibilityLabel="Phone number" value={phone} onChangeText={(v) => { setPhone(v); setNotice(null); setError(null); }} keyboardType="phone-pad" autoComplete="off" maxLength={40} style={styles.input} />
        {tick('Also make sure nobody on FastQue contacts this number', everywhere, setEverywhere)}
        {tick('When erasing, keep a do-not-contact marker (recommended)', keepStopList, setKeepStopList)}
        {tick('I understand that erasing deletes my shop’s record of this number', confirmErase, setConfirmErase)}
        {error ? <InlineError message={error} /> : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={styles.ok}>{notice}</Text> : null}
        <View style={styles.row}>
          <Button title={busy === 'withdraw' ? 'Saving…' : 'They asked to stop'} onPress={() => void withdraw()} disabled={!hasPhone || busy !== null} style={styles.flex} />
          <Button title={busy === 'erase' ? 'Erasing…' : 'Erase my record'} variant="outline" onPress={() => void erase()} disabled={!hasPhone || !confirmErase || busy !== null} style={styles.flex} />
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.sm, marginVertical: space[1] },
  small: { fontFamily: font.bodyRegular, color: color.ink, fontSize: fontSize.sm, flex: 1 },
  strong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  line: { flexDirection: 'row', paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space[3], color: color.ink, fontFamily: font.bodyRegular, marginVertical: space[2] },
  ackRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2] },
  box: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: color.border },
  boxOn: { backgroundColor: color.accent, borderColor: color.accent },
  ackText: { flex: 1, fontFamily: font.bodyRegular, color: color.ink, fontSize: fontSize.sm },
  ok: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.successSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  row: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  flex: { flex: 1 },
});
