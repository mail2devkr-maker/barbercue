import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  VERIFICATION_BADGE_CAPTION,
  submitVerificationSchema,
  type UiStrings,
  type VerificationRequestDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader, Skeleton } from '../../components/ui';
import { SalonSwitcher } from '../../components/owner/SalonSwitcher';

function verificationPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${DASHBOARD_PATHS.verification}`;
}

function statusCopy(t: UiStrings, status: string): string {
  switch (status) {
    case 'SUBMITTED':
      return t.verificationStatusSubmitted;
    case 'UNDER_REVIEW':
      return t.verificationStatusUnderReview;
    case 'APPROVED':
      return t.verificationStatusApproved;
    case 'REJECTED':
      return t.verificationStatusRejected;
    default:
      return status;
  }
}

/**
 * Owner-side Shop Verification — submit evidence for manual admin review. No file upload exists
 * (there is no object storage): evidence is free text plus already-hosted https links, exactly as on
 * the website. The badge wording is the shared VERIFICATION_BADGE_CAPTION, never a paraphrase.
 */
export default function OwnerVerificationScreen() {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { t } = useLanguage();
  // undefined = still loading, null = no request yet.
  const [current, setCurrent] = useState<VerificationRequestDto | null | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [linksText, setLinksText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const requestRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      const request = ++requestRef.current;
      setCurrent(undefined);
      setError(null);
      if (!selectedSalonId) return;
      apiFetch<VerificationRequestDto | null>(verificationPath(selectedSalonId))
        .then((result) => {
          if (request === requestRef.current) setCurrent(result);
        })
        .catch((err: unknown) => {
          if (request === requestRef.current) setError(err instanceof ApiError ? err.message : t.verificationLoadFailed);
        });
    }, [selectedSalonId, t]),
  );

  async function submit() {
    if (!selectedSalonId) return;
    const evidenceUrls = linksText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (!notes.trim() && evidenceUrls.length === 0) {
      setError(t.verificationNeedEvidence);
      return;
    }
    const parsed = submitVerificationSchema.safeParse({
      evidenceNotes: notes.trim() || undefined,
      evidenceUrls: evidenceUrls.length > 0 ? evidenceUrls : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.verificationNeedEvidence);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<VerificationRequestDto>(verificationPath(selectedSalonId), {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      setCurrent(result);
      setNotes('');
      setLinksText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.verificationSubmitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  if (!selectedSalonId) {
    return (
      <PremiumScreen scroll={false}>
        <EmptyState title={t.selectShopTitle} message={t.chooseShopHint} />
      </PremiumScreen>
    );
  }

  const canSubmit = current === null || current?.status === 'REJECTED';
  return (
    <PremiumScreen>
      <PremiumSectionHeader eyebrow={selectedSalon?.name ?? t.ownerEyebrow} title={t.verificationTitle} subtitle={VERIFICATION_BADGE_CAPTION} />
      <SalonSwitcher />
      {error ? <InlineError message={error} /> : null}
      {current === undefined && !error ? <Skeleton style={styles.skeleton} /> : null}

      {current ? (
        <PremiumCard strong style={styles.status} testID="verification-status">
          <Text style={styles.statusLabel}>{current.status}</Text>
          <Text style={styles.statusText}>{statusCopy(t, current.status)}</Text>
          {current.reviewNotes ? (
            <Text style={styles.statusText}>
              <Text style={styles.statusLabel}>{t.verificationAdminNotes} </Text>
              {current.reviewNotes}
            </Text>
          ) : null}
        </PremiumCard>
      ) : null}

      {canSubmit ? (
        <View testID="verification-form">
          <Text style={styles.label}>{t.verificationEvidenceNotes}</Text>
          <TextInput
            testID="verification-notes"
            value={notes}
            onChangeText={setNotes}
            maxLength={2000}
            multiline
            placeholder={t.verificationEvidenceNotesPlaceholder}
            placeholderTextColor={fastQue.textMuted}
            style={[styles.input, styles.tall]}
          />
          <Text style={styles.label}>{t.verificationEvidenceLinks}</Text>
          <TextInput
            testID="verification-links"
            value={linksText}
            onChangeText={setLinksText}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={'https://example.com/registration.jpg\nhttps://example.com/shop-front.jpg'}
            placeholderTextColor={fastQue.textMuted}
            style={styles.input}
          />
          <Text style={styles.hint}>{t.verificationEvidenceLinksHint}</Text>
          <PremiumButton
            testID="verification-submit"
            title={submitting ? t.savingEllipsis : current ? t.verificationResubmit : t.verificationSubmit}
            onPress={() => void submit()}
            loading={submitting}
            style={styles.submit}
          />
        </View>
      ) : null}
    </PremiumScreen>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 90, borderRadius: radius.lg },
  status: { marginVertical: space[3], gap: space[1] },
  statusLabel: { fontFamily: font.bodyBold, fontSize: fontSize.sm, color: fastQue.text },
  statusText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textSecondary, marginTop: space[1] },
  label: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.text, marginTop: space[3], marginBottom: space[2] },
  input: {
    minHeight: 72,
    textAlignVertical: 'top',
    backgroundColor: fastQue.input,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.sm,
    color: fastQue.text,
    fontFamily: font.bodyRegular,
    padding: space[3],
    fontSize: fontSize.base,
  },
  tall: { minHeight: 110 },
  hint: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, marginTop: space[1] },
  submit: { marginTop: space[4] },
});
