import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DASHBOARD_PATHS, type RecordContactConsentsResultDto, type SalonCapabilitiesDto, type SalonContactImportPreviewDto, type SalonContactImportPreviewInput } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import {
  buildRequest,
  CONSENT_SOURCES,
  MAX_CONTACTS,
  maskedPhone,
  parseContactList,
  statusText,
  todayIso,
  validateBatch,
  type BatchConsent,
  type ContactRow,
} from '../../lib/contact-preview';
import { ledgerPath, parseRecordResult, savedSentence } from '../../lib/contact-ledger';
import { ContactLedgerPanel } from './ContactLedgerPanel';
import { contactFileToList, hasAcceptedExtension, MAX_FILE_BYTES } from '../../lib/contact-file';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * Website parity for apps/web/components/owner/ContactListCheck.tsx (Contacts page): paste a phone
 * list (optionally with how and when each person agreed), let the server check it, and — only where
 * the agreement ledger is switched on for this environment — save agreement records. FastQue does
 * not and cannot send invitations from here; results show only the last four digits. Rules are the
 * website's lib/contact-preview.ts and lib/contact-ledger.ts (copied).
 */
type Result = { rows: ContactRow[]; body: SalonContactImportPreviewInput; preview: SalonContactImportPreviewDto };

export function ContactsCheckPanel({ salonId }: { salonId: string }) {
  const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.contacts}/preview`;
  const [text, setText] = useState('');
  const [batch, setBatch] = useState<BatchConsent>({ attested: false, source: 'OWNER_ATTESTED', date: todayIso() });
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<RecordContactConsentsResultDto | null>(null);
  const [ledgerEnabled, setLedgerEnabled] = useState(false);
  const [fileNote, setFileNote] = useState<{ tone: 'info' | 'error'; message: string; problems: string[] } | null>(null);
  const parsed = useMemo(() => parseContactList(text), [text]);
  const batchProblem = validateBatch(batch);

  useEffect(() => {
    let cancelled = false;
    // Same rule as the website: agreement records only where contactImport is SANDBOX-enabled.
    apiFetch<SalonCapabilitiesDto>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/capabilities`)
      .then((caps) => { if (!cancelled) setLedgerEnabled((caps.features as Record<string, { status?: string }>).contactImport?.status === 'SANDBOX'); })
      .catch(() => { if (!cancelled) setLedgerEnabled(false); });
    return () => { cancelled = true; };
  }, [salonId]);

  const check = async () => {
    setError(null); setResult(null); setSaved(null); setSaveError(null);
    if (parsed.rows.length === 0) { setError('Add at least one phone number.'); return; }
    if (parsed.rows.length > MAX_CONTACTS) { setError(`Check at most ${MAX_CONTACTS} numbers at a time.`); return; }
    if (batchProblem) { setError(batchProblem); return; }
    setChecking(true);
    try {
      const body = buildRequest(parsed.rows, batch);
      const preview = await apiFetch<SalonContactImportPreviewDto>(path, { method: 'POST', body: JSON.stringify(body) });
      if (!preview || !Array.isArray(preview.items) || preview.items.length !== parsed.rows.length) setError('FastQue sent an answer this screen could not match to your list, so nothing is shown.');
      else setResult({ rows: parsed.rows, body, preview });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError('You have checked a lot of lists in a short time. Wait a minute and try again.');
      else if (err instanceof ApiError && err.status === 404) setError('Checking contact lists is not available for your shop yet.');
      else setError(err instanceof ApiError ? err.message : 'Could not check the list. Nothing was saved.');
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    if (!result) return;
    setSaving(true); setSaveError(null); setSaved(null);
    try {
      const parsedResult = parseRecordResult(await apiFetch<unknown>(ledgerPath(salonId), { method: 'POST', body: JSON.stringify(result.body) }), result.rows.length);
      if (!parsedResult) setSaveError('FastQue sent an answer this screen could not match to your list, so nothing is assumed to be saved.');
      else setSaved(parsedResult);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setSaveError('Saving agreement records is not switched on for FastQue yet. Nothing was saved.');
      else if (err instanceof ApiError && err.status === 429) setSaveError('You have saved a lot of lists in a short time. Wait a minute and try again.');
      else setSaveError(err instanceof ApiError ? err.message : 'Could not save the records. Nothing was assumed to be saved.');
    } finally {
      setSaving(false);
    }
  };

  // Website parity: read a contacts file on the phone and put its numbers in the box for review.
  // The file never leaves the device; only the reviewed list is checked when the owner presses Check.
  const importFile = async () => {
    setFileNote(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'text/vcard', 'text/x-vcard', 'application/vnd.ms-excel', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];
      const name = file.name ?? 'contacts';
      if (!hasAcceptedExtension(name)) {
        setFileNote({ tone: 'error', message: 'That kind of file is not supported. Use a .csv, .txt or .vcf contacts file. Nothing was read.', problems: [] });
        return;
      }
      if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
        setFileNote({ tone: 'error', message: 'That file is larger than 512 KB, which is more than a contact list. Nothing was read.', problems: [] });
        return;
      }
      const content = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 });
      const read = contactFileToList(content, name);
      const problems = read.problems.slice(0, 5).map((p) => `${p.where}: ${p.message}`);
      if (read.found === 0) {
        setFileNote({ tone: 'error', message: `No phone numbers could be read from ${name}. What was in the box is unchanged.`, problems });
        return;
      }
      const replacing = text.trim().length > 0;
      setText(read.text);
      setResult(null);
      setFileNote({
        tone: 'info',
        message: `Read ${read.found} number${read.found === 1 ? '' : 's'} from ${name} and put them in the box below${replacing ? ', replacing what was there' : ''}. The file stays on your phone. Review the list, then press Check.`,
        problems,
      });
    } catch {
      setFileNote({ tone: 'error', message: 'Could not read that file. Nothing was changed.', problems: [] });
    }
  };

  const summary = result?.preview.summary;
  return (
    <>
      <Card>
        <Text style={styles.heading}>Invite people your own way</Text>
        <Text style={styles.muted}>FastQue does not send invitations. Share your shop's public link or QR code yourself, to people who have agreed to hear from you. Here you can check a list before you use it.</Text>
      </Card>
      <Card>
        <Text style={styles.heading}>Your list</Text>
        <Text style={styles.muted}>{`One person per line: the phone number, and optionally how and when they agreed, like "98765 43210, IN_PERSON, 2026-09-30". Up to ${MAX_CONTACTS} at a time.`}</Text>
        <Button title="Import a contacts file (.csv, .txt, .vcf)" variant="outline" onPress={() => void importFile()} />
        {fileNote ? (
          <View accessibilityLiveRegion="polite">
            <Text style={fileNote.tone === 'error' ? styles.fileError : styles.muted}>{fileNote.message}</Text>
            {fileNote.problems.map((p) => <Text key={p} style={styles.muted}>{`• ${p}`}</Text>)}
          </View>
        ) : null}
        <TextInput accessibilityLabel="Contact list" value={text} onChangeText={(v) => { setText(v); setResult(null); }} multiline autoCorrect={false} autoCapitalize="none" style={[styles.input, styles.area]} />
        <Text style={styles.muted}>{`${parsed.rows.length} number${parsed.rows.length === 1 ? '' : 's'}`}</Text>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: batch.attested }} onPress={() => setBatch({ ...batch, attested: !batch.attested })} style={styles.ackRow}>
          <View style={[styles.box, batch.attested && styles.boxOn]} />
          <Text style={styles.ackText}>Everyone on this list agreed to be contacted by my shop</Text>
        </Pressable>
        {batch.attested && (
          <>
            <Text style={styles.label}>How they agreed</Text>
            <View style={styles.chips}>
              {CONSENT_SOURCES.map((s) => (
                <Pressable key={s.value} accessibilityRole="button" accessibilityState={{ selected: batch.source === s.value }} onPress={() => setBatch({ ...batch, source: s.value })} style={[styles.chip, batch.source === s.value && styles.chipOn]}>
                  <Text style={styles.chipText}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>When they agreed (YYYY-MM-DD)</Text>
            <TextInput accessibilityLabel="Agreement date" value={batch.date} onChangeText={(v) => setBatch({ ...batch, date: v })} maxLength={10} style={styles.input} />
          </>
        )}
        {!!error && <InlineError message={error} />}
        <View style={styles.row}>
          <Button title={checking ? 'Checking…' : 'Check list'} onPress={() => void check()} disabled={checking} style={styles.flex} />
          <Button title="Clear" variant="outline" onPress={() => { setText(''); setResult(null); setError(null); setSaved(null); setSaveError(null); }} style={styles.flex} />
        </View>
      </Card>
      {result && summary && (
        <Card>
          <Text style={styles.heading}>Result</Text>
          <Text style={styles.muted}>No invitation has been sent and none can be sent from here.</Text>
          <Text style={styles.strong}>{`${summary.validatedForReview} of ${summary.total} look complete`}</Text>
          {result.preview.items.map((item) => {
            const row = result.rows[item.index];
            const s = statusText(item.status);
            return (
              <View key={item.index} style={styles.item}>
                <Text style={[styles.strong, !s.ok && styles.warnText]}>{`${row ? maskedPhone(row.phone) : `#${item.index + 1}`} · ${s.label}`}</Text>
                {s.help ? <Text style={styles.muted}>{s.help}</Text> : null}
              </View>
            );
          })}
          {ledgerEnabled && summary.validatedForReview > 0 && (
            <>
              <Text style={styles.heading}>Save agreement records</Text>
              <Text style={styles.muted}>Optional. This keeps a record that these people agreed, so you can show it later and so a person who asks you to stop can be respected.</Text>
              <Button title={saving ? 'Saving…' : 'Save agreement records'} onPress={() => void save()} disabled={saving} />
              {!!saveError && <InlineError message={saveError} />}
              {saved && <Text style={styles.ok}>{savedSentence(saved)}</Text>}
            </>
          )}
        </Card>
      )}
      {ledgerEnabled && <ContactLedgerPanel salonId={salonId} refreshKey={saved ? 1 : 0} />}
    </>
  );
}

const styles = StyleSheet.create({
  fileError: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, marginVertical: space[1] },
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginVertical: space[1] },
  label: { fontFamily: font.bodyMedium, color: color.muted, fontSize: fontSize.xs, marginTop: space[2] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  strong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  warnText: { color: color.warn },
  ok: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.successSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginVertical: space[1] },
  area: { minHeight: 140, textAlignVertical: 'top' },
  ackRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginVertical: space[2] },
  box: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: color.ink },
  boxOn: { backgroundColor: color.accent, borderColor: color.accent },
  ackText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: 16, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: color.surface },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.xs },
  row: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  flex: { flex: 1 },
  item: { paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
});
