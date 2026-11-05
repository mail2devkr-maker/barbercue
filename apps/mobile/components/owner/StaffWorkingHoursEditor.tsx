import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  setStaffWorkingHoursSchema,
  type StaffWorkingHoursDto,
} from '@barbercue/shared';
import { ApiError, apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, InlineError } from '../ui';

const DAYS = [
  ['Sunday', 'रविवार'],
  ['Monday', 'सोमवार'],
  ['Tuesday', 'मंगलवार'],
  ['Wednesday', 'बुधवार'],
  ['Thursday', 'गुरुवार'],
  ['Friday', 'शुक्रवार'],
  ['Saturday', 'शनिवार'],
] as const;

function staffHoursPath(salonId: string, staffId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.staff}/${staffId}/${DASHBOARD_PATHS.workingHours}`;
}

function staffDayName(dayOfWeek: number, hindi: boolean): string {
  return DAYS[dayOfWeek]?.[hindi ? 1 : 0] ?? DAYS[0][0];
}

/**
 * Mobile editor for the existing owner-scoped weekly staff-hours API. Unconfigured days use the
 * shop's operating hours; a configured day's times further restrict that staff member's schedule.
 * The backend remains responsible for salon/staff ownership validation and atomic weekly saving.
 */
export function StaffWorkingHoursEditor({ salonId, staffId }: { salonId: string; staffId: string }) {
  const { language } = useLanguage();
  const hindi = language === 'HI';
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<StaffWorkingHoursDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const path = staffHoursPath(salonId, staffId);

  useEffect(() => {
    if (!open || days !== null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<StaffWorkingHoursDto[]>(path)
      .then((result) => {
        if (!Array.isArray(result) || result.length !== 7) {
          throw new Error('The server returned an incomplete staff schedule.');
        }
        if (!cancelled) setDays(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : (hindi ? 'कर्मचारी के समय लोड नहीं हुए।' : 'Could not load staff hours.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, hindi, loadAttempt, open, path]);

  function updateDay(dayOfWeek: number, patch: Partial<StaffWorkingHoursDto>) {
    setError(null);
    setNotice(null);
    setDays((current) => (current ?? []).map((day) =>
      day.dayOfWeek === dayOfWeek ? { ...day, ...patch, configured: true } : day,
    ));
  }

  async function save() {
    if (!days) return;
    setError(null);
    setNotice(null);
    const payload = { days: days.map(({ dayOfWeek, openTime, closeTime, isClosed }) => ({ dayOfWeek, openTime, closeTime, isClosed })) };
    const parsed = setStaffWorkingHoursSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const index = typeof issue.path[1] === 'number' ? issue.path[1] : null;
      const day = index === null ? '' : `${staffDayName(days[index]?.dayOfWeek ?? 0, hindi)}: `;
      setError(`${day}${issue.message}`);
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch<StaffWorkingHoursDto[]>(path, {
        method: 'PUT',
        body: JSON.stringify(parsed.data),
      });
      if (!Array.isArray(saved) || saved.length !== 7) throw new Error('The server returned an incomplete staff schedule.');
      setDays(saved);
      setNotice(hindi ? 'कर्मचारी का साप्ताहिक समय सहेजा गया।' : 'Staff weekly hours saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (hindi ? 'कर्मचारी का समय सहेजा नहीं जा सका।' : 'Could not save staff hours.'));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return <Button title={hindi ? 'कार्य समय' : 'Working hours'} variant="outline" onPress={() => setOpen(true)} />;
  }

  return (
    <View style={styles.panel}>
      {error && <InlineError message={error} />}
      {notice && <Text accessibilityRole="text" style={styles.notice}>{notice}</Text>}
      {loading ? <Text style={styles.hint}>{hindi ? 'समय लोड हो रहा है…' : 'Loading staff hours…'}</Text> : null}
      {!loading && days === null && error ? (
        <Button title={hindi ? 'फिर कोशिश करें' : 'Retry'} variant="outline" onPress={() => { setError(null); setLoadAttempt((n) => n + 1); }} />
      ) : null}
      {!loading && days ? (
        <>
          <Text style={styles.hint}>
            {hindi
              ? 'बिना बदले दिन दुकान के समय का पालन करते हैं। समय यहाँ HH:MM (24 घंटे) में दर्ज करें।'
              : 'Unchanged days follow shop hours. Enter times in HH:MM (24-hour) format.'}
          </Text>
          {days.map((day) => {
            const dayName = staffDayName(day.dayOfWeek, hindi);
            return (
              <View key={day.dayOfWeek} style={styles.row}>
                <Text style={styles.day}>{hindi ? DAYS[day.dayOfWeek]?.[1] : DAYS[day.dayOfWeek]?.[0]}</Text>
                <Button
                  title={day.isClosed ? (hindi ? 'बंद' : 'Off') : (hindi ? 'कार्य' : 'Working')}
                  variant="outline"
                  onPress={() => updateDay(day.dayOfWeek, { isClosed: !day.isClosed })}
                  style={day.isClosed ? styles.toggle : [styles.toggle, styles.toggleActive]}
                />
                {day.isClosed ? (
                  <Text style={styles.closed}>{hindi ? 'छुट्टी' : 'Day off'}</Text>
                ) : (
                  <View style={styles.times}>
                    <TextInput
                      accessibilityLabel={`${dayName} start time`}
                      style={styles.timeInput}
                      value={day.openTime}
                      onChangeText={(value) => updateDay(day.dayOfWeek, { openTime: value })}
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      placeholder="09:00"
                      placeholderTextColor={color.muted}
                    />
                    <Text style={styles.dash}>–</Text>
                    <TextInput
                      accessibilityLabel={`${dayName} end time`}
                      style={styles.timeInput}
                      value={day.closeTime}
                      onChangeText={(value) => updateDay(day.dayOfWeek, { closeTime: value })}
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      placeholder="17:00"
                      placeholderTextColor={color.muted}
                    />
                  </View>
                )}
                {!day.configured && !day.isClosed ? <Text style={styles.unrestricted}>{hindi ? 'दुकान के समय के अनुसार' : 'Shop hours'}</Text> : null}
              </View>
            );
          })}
          <View style={styles.actions}>
            <Button title={hindi ? 'समय सहेजें' : 'Save staff hours'} onPress={() => void save()} loading={saving} style={styles.saveButton} />
            <Button title={hindi ? 'रद्द करें' : 'Cancel'} variant="outline" onPress={() => setOpen(false)} disabled={saving} style={styles.cancelButton} />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.border, marginTop: space[2] },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space[1], paddingVertical: space[1], borderBottomWidth: 1, borderBottomColor: color.border },
  day: { width: 54, color: color.ink, fontFamily: font.bodySemiBold, fontSize: fontSize.xs },
  toggle: { minWidth: 65, minHeight: 38, paddingVertical: space[1], paddingHorizontal: space[2] },
  toggleActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  times: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  timeInput: { flex: 1, minWidth: 52, minHeight: 40, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space[1], color: color.ink, textAlign: 'center', fontFamily: font.bodyRegular, fontSize: fontSize.xs },
  dash: { color: color.muted, fontSize: fontSize.xs },
  closed: { flex: 1, color: color.muted, fontFamily: font.bodyRegular, fontSize: fontSize.xs },
  unrestricted: { position: 'absolute', right: 0, top: 1, fontSize: 10, color: color.muted, backgroundColor: color.surface },
  hint: { color: color.muted, fontFamily: font.bodyRegular, fontSize: fontSize.xs, marginBottom: space[2] },
  notice: { color: color.success, fontFamily: font.bodyMedium, fontSize: fontSize.xs, marginBottom: space[2] },
  actions: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  saveButton: { flex: 1 },
  cancelButton: { flex: 1 },
});

