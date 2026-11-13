import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  Language,
  PERMANENT_DELETION_PATHS,
  Role,
  StaffMemberStatus,
  type PermanentDeletionKind,
  type PermanentDeletionPreviewDto,
  type PermanentDeletionResultDto,
  type SalonStaffDto,
  type StaffInviteResultDto,
  type VerificationRequestDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, InlineError } from '../ui';

/**
 * Website parity for the owner Staff page (apps/web .../staff/page.tsx): working / not working,
 * resend the login invitation, remove or restore a staff member's access (explicit confirmation),
 * staff verification evidence, and permanent deletion. Permanent deletion is the website's exact
 * protocol (PermanentDeleteDialog, issue #378): opening it changes nothing; the server previews the
 * effects and blockers and issues a single-use token; Confirm Delete stays disabled until the exact
 * name is typed AND the irreversible box is ticked; the server checks all of it again.
 */
const PATH: Record<PermanentDeletionKind, string> = { chair: DASHBOARD_PATHS.chairs, staff: DASHBOARD_PATHS.staff };

/** Same rule as apps/web/lib/permanent-delete-access.ts: owners (and platform admins) only. */
export function canPermanentlyDelete(roles: readonly Role[] | undefined): boolean {
  return !!roles && (roles.includes(Role.SALON_OWNER) || roles.includes(Role.PLATFORM_ADMIN));
}

export function StaffManageActions({ salonId, member, language, canDelete, onChanged }: {
  salonId: string;
  member: SalonStaffDto;
  language: Language;
  canDelete: boolean;
  onChanged: (message: string) => void;
}) {
  const hi = language === Language.HI;
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.staff}/${member.id}`;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'verification' | 'delete' | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const working = member.status === StaffMemberStatus.ACTIVE;

  const run = async (key: string, request: () => Promise<unknown>, message: string) => {
    setBusy(key);
    setError(null);
    try {
      await request();
      onChanged(message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : hi ? 'बदलाव नहीं हो सका।' : 'Could not update that staff member.');
    } finally {
      setBusy(null);
    }
  };

  const toggleWorking = (next: boolean) => run('status', () => apiFetch(base, { method: 'PATCH', body: JSON.stringify({ status: next ? StaffMemberStatus.ACTIVE : StaffMemberStatus.INACTIVE }) }),
    next ? (hi ? `${member.displayName} अब काम पर हैं।` : `${member.displayName} is now working.`) : (hi ? `${member.displayName} अब काम पर नहीं हैं।` : `${member.displayName} is marked not working.`));

  const resend = async () => {
    setBusy('invite');
    setError(null);
    try {
      const result = await apiFetch<StaffInviteResultDto>(`${base}/${DASHBOARD_PATHS.resendInvite}`, { method: 'POST' });
      setInviteUrl(result.inviteUrl ?? null);
      onChanged(hi ? `नया निमंत्रण ${member.email ?? 'ईमेल'} पर भेजा गया।` : `New invitation sent to ${member.email ?? 'their email'}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : hi ? 'निमंत्रण दोबारा नहीं भेजा जा सका।' : 'Could not resend that invitation.');
    } finally {
      setBusy(null);
    }
  };

  const changeAccess = () => {
    const revoke = !member.accessRevoked;
    Alert.alert(
      revoke ? (hi ? `${member.displayName} की पहुँच हटाएँ?` : `Remove ${member.displayName}'s access?`) : (hi ? `${member.displayName} की पहुँच लौटाएँ?` : `Restore ${member.displayName}'s access?`),
      revoke
        ? (hi ? 'वे इस दुकान में लॉग इन नहीं कर पाएँगे। उनका रिकॉर्ड और इतिहास बना रहेगा।' : 'They will no longer be able to sign in to this shop. Their record and history are kept, and you can restore access later.')
        : (hi ? 'वे फिर से इस दुकान में लॉग इन कर पाएँगे।' : 'They will be able to sign in to this shop again.'),
      [
        { text: hi ? 'रद्द करें' : 'Cancel', style: 'cancel' },
        { text: revoke ? (hi ? 'पहुँच हटाएँ' : 'Remove access') : (hi ? 'पहुँच लौटाएँ' : 'Restore access'), style: revoke ? 'destructive' : 'default',
          onPress: () => void run('access', () => apiFetch(`${base}/access/${revoke ? 'revoke' : 'restore'}`, { method: 'POST', body: JSON.stringify({}) }),
            revoke ? (hi ? 'पहुँच हटाई गई।' : 'Access removed.') : (hi ? 'पहुँच लौटाई गई।' : 'Access restored.')) },
      ],
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.switchRow}>
        <Text style={styles.label}>{working ? (hi ? 'काम पर' : 'Working') : (hi ? 'काम पर नहीं' : 'Not working')}{member.accessRevoked ? (hi ? ' · पहुँच हटाई गई' : ' · access removed') : ''}</Text>
        <Switch accessibilityLabel={`${member.displayName} ${hi ? 'काम पर' : 'working'}`} value={working} disabled={busy !== null} onValueChange={(v) => void toggleWorking(v)} />
      </View>
      <View style={styles.row}>
        {member.email && !member.hasPassword && (
          <Button title={busy === 'invite' ? '…' : hi ? 'निमंत्रण फिर भेजें' : 'Resend invitation'} variant="outline" onPress={() => void resend()} disabled={busy !== null} style={styles.btn} />
        )}
        <Button title={member.accessRevoked ? (hi ? 'पहुँच लौटाएँ' : 'Restore access') : (hi ? 'पहुँच हटाएँ' : 'Remove access')} variant="outline" onPress={changeAccess} disabled={busy !== null} style={styles.btn} />
        <Button title={hi ? 'सत्यापन' : 'Verification'} variant="outline" onPress={() => setPanel(panel === 'verification' ? null : 'verification')} style={styles.btn} />
        {canDelete && <Button title={hi ? 'स्थायी रूप से हटाएँ' : 'Delete permanently'} variant="outline" onPress={() => setPanel(panel === 'delete' ? null : 'delete')} style={styles.btn} />}
      </View>
      {!!inviteUrl && <Text selectable style={styles.muted}>{inviteUrl}</Text>}
      {!!error && <InlineError message={error} />}
      {panel === 'verification' && <StaffVerification salonId={salonId} staffId={member.id} language={language} />}
      {panel === 'delete' && (
        <PermanentDeletePanel kind="staff" salonId={salonId} targetId={member.id} language={language} onClose={() => setPanel(null)}
          onDeleted={() => { setPanel(null); onChanged(hi ? `${member.displayName} स्थायी रूप से हटाए गए।` : `${member.displayName} was permanently deleted.`); }} />
      )}
    </View>
  );
}

export function StaffVerification({ salonId, staffId, language }: { salonId: string; staffId: string; language: Language }) {
  const hi = language === Language.HI;
  const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.staff}/${staffId}/${DASHBOARD_PATHS.verification}`;
  const [current, setCurrent] = useState<VerificationRequestDto | null | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [urls, setUrls] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<VerificationRequestDto | null>(path)
      .then((r) => { if (!cancelled) setCurrent(r ?? null); })
      .catch((err) => { if (!cancelled) { setCurrent(null); setError(err instanceof ApiError ? err.message : 'Could not load verification status.'); } });
    return () => { cancelled = true; };
  }, [path]);

  const submit = async () => {
    const evidenceUrls = urls.split('\n').map((u) => u.trim()).filter(Boolean);
    if (!notes.trim() && evidenceUrls.length === 0) { setError(hi ? 'साक्ष्य विवरण या लिंक जोड़ें।' : 'Add evidence notes or at least one HTTPS link.'); return; }
    setBusy(true);
    setError(null);
    try {
      setCurrent(await apiFetch<VerificationRequestDto>(path, { method: 'POST', body: JSON.stringify({ evidenceNotes: notes.trim() || undefined, evidenceUrls: evidenceUrls.length ? evidenceUrls : undefined }) }));
      setNotes(''); setUrls('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit verification.');
    } finally {
      setBusy(false);
    }
  };

  if (current === undefined) return <Text style={styles.muted}>…</Text>;
  const canSubmit = current === null || current.status === 'REJECTED';
  return (
    <View style={styles.box}>
      {current ? (
        <>
          <Text style={styles.strong}>{current.status}</Text>
          {current.reviewNotes ? <Text style={styles.muted}>{current.reviewNotes}</Text> : null}
        </>
      ) : <Text style={styles.muted}>{hi ? 'अभी कोई सत्यापन अनुरोध नहीं।' : 'No verification request yet.'}</Text>}
      {canSubmit && (
        <>
          <TextInput accessibilityLabel="Evidence notes" placeholder={hi ? 'साक्ष्य विवरण' : 'Evidence notes'} value={notes} onChangeText={setNotes} multiline maxLength={2000} style={styles.input} />
          <TextInput accessibilityLabel="Evidence links" placeholder={hi ? 'HTTPS लिंक, हर पंक्ति में एक (वैकल्पिक)' : 'HTTPS links, one per line (optional)'} value={urls} onChangeText={setUrls} multiline autoCapitalize="none" style={styles.input} />
          <Button title={busy ? '…' : hi ? 'समीक्षा हेतु जमा करें' : 'Submit for review'} onPress={() => void submit()} disabled={busy} />
        </>
      )}
      {!!error && <InlineError message={error} />}
    </View>
  );
}

export function PermanentDeletePanel({ kind, salonId, targetId, language, onClose, onDeleted }: {
  kind: PermanentDeletionKind;
  salonId: string;
  targetId: string;
  language: Language;
  onClose: () => void;
  onDeleted: (result: PermanentDeletionResultDto) => void;
}) {
  const hi = language === Language.HI;
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${PATH[kind]}/${targetId}`;
  const [preview, setPreview] = useState<PermanentDeletionPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    // Opening this panel changes nothing: the server only previews and issues a single-use token.
    apiFetch<PermanentDeletionPreviewDto>(`${base}/${PERMANENT_DELETION_PATHS.preview}`, { method: 'POST' })
      .then((p) => { if (live) { setPreview(p); setError(null); } })
      .catch((e) => { if (live) setError(e instanceof ApiError ? e.message : 'Could not check this record. Nothing was deleted.'); });
    return () => { live = false; };
  }, [base, round]);

  const matches = !!preview && typed.trim() === preview.confirmName.trim();
  const canConfirm = !!preview?.deletable && !!preview.token && matches && ack && !busy;

  const confirm = async () => {
    if (!canConfirm || !preview?.token) return;
    setBusy(true);
    setError(null);
    try {
      onDeleted(await apiFetch<PermanentDeletionResultDto>(`${base}/${PERMANENT_DELETION_PATHS.confirm}`, {
        method: 'POST', body: JSON.stringify({ token: preview.token, typedName: typed, acknowledged: true }),
      }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete. Nothing was deleted.');
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      <Text style={styles.strong}>{kind === 'staff' ? (hi ? 'कर्मचारी को स्थायी रूप से हटाएँ' : 'Delete staff member permanently') : (hi ? 'कुर्सी को स्थायी रूप से हटाएँ' : 'Delete chair permanently')}</Text>
      {!preview && !error && <Text style={styles.muted}>{hi ? 'जाँच हो रही है…' : 'Checking whether this can be deleted…'}</Text>}
      {!!error && <InlineError message={error} />}
      {!!error && preview && <Button title={hi ? 'फिर जाँचें' : 'Check again'} variant="outline" onPress={() => { setPreview(null); setTyped(''); setAck(false); setBusy(false); setRound((r) => r + 1); }} />}
      {preview && (
        <>
          <Text style={styles.label}>{`${preview.target.name} · ${preview.salon.name}`}</Text>
          {preview.deletable ? (
            <>
              {preview.effects.map((e) => <Text key={e} style={styles.muted}>{`• ${e}`}</Text>)}
              <Text style={styles.warn}>{hi ? 'इसे वापस नहीं किया जा सकता।' : 'This cannot be undone.'}</Text>
              <Text style={styles.label}>{hi ? `पुष्टि के लिए "${preview.confirmName}" लिखें` : `Type "${preview.confirmName}" to confirm`}</Text>
              <TextInput accessibilityLabel="Type the name to confirm" value={typed} onChangeText={setTyped} autoCorrect={false} autoCapitalize="none" style={styles.input} />
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: ack }} onPress={() => setAck(!ack)} style={styles.ackRow}>
                <View style={[styles.box16, ack && styles.box16On]} />
                <Text style={styles.ackText}>{hi ? 'मैं समझता/समझती हूँ कि यह स्थायी है।' : 'I understand this is permanent.'}</Text>
              </Pressable>
            </>
          ) : (
            <>
              {preview.blockers.map((b) => <Text key={b.code} style={styles.muted}>{`• ${b.message}`}</Text>)}
              {preview.alternative ? <Text style={styles.muted}>{preview.alternative}</Text> : null}
            </>
          )}
          <View style={styles.row}>
            <Button title={hi ? 'रद्द करें' : 'Cancel'} variant="outline" onPress={onClose} disabled={busy} style={styles.btn} />
            {preview.deletable && <Button title={busy ? '…' : hi ? 'हटाने की पुष्टि करें' : 'Confirm Delete'} onPress={() => void confirm()} disabled={!canConfirm} style={styles.btn} />}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space[2], gap: space[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  btn: { flexGrow: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm },
  strong: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs },
  warn: { fontFamily: font.bodyBold, color: color.warn, fontSize: fontSize.sm },
  box: { gap: space[2], padding: space[3], borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceTint },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular },
  ackRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  box16: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: color.ink },
  box16On: { backgroundColor: color.accent, borderColor: color.accent },
  ackText: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, flex: 1 },
});
