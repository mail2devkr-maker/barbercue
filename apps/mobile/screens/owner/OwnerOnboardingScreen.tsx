import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  ChairStatus,
  DASHBOARD_PATHS,
  SalonSetupErrorCode,
  SalonStatus,
  StaffMemberStatus,
  type OperatingHoursDto,
  type PhotoDto,
  type SalonChairDto,
  type SalonPaymentQrDto,
  type SalonSetupReadinessDto,
  type SalonStaffDto,
  type ServiceDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { ONBOARDING_SKIPPABLE_STEPS, ONBOARDING_TOTAL_STEPS, computeFirstIncompleteStep } from '../../lib/onboarding-progress';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Screen, SectionHeader, Card, Button, EmptyState, Skeleton, InlineError } from '../../components/ui';
import {
  scope,
  ServiceRow,
  AddServiceForm,
  ChairRow,
  AddChairForm,
  AddStaffForm,
  HoursEditor,
  PhotosSection,
  PaymentQrSection,
  styles as sectionStyles,
} from '../../components/owner/ShopSetupSections';

const TOTAL_STEPS = ONBOARDING_TOTAL_STEPS;

/**
 * The 7-step self-serve setup wizard for a freshly-registered (PENDING) shop — Mobile Shop Owner
 * Onboarding mission. Every step below renders one of ShopSetupSections' existing forms; this
 * screen owns none of that business logic itself, only step sequencing and the final Go Live call.
 *
 * Reused for BOTH a brand-new registration (App.tsx swaps straight into OwnerNavigator, which
 * mounts this the moment it sees the owner's one PENDING workplace) AND a returning owner who
 * closed the app mid-setup — OwnerNavigator renders this same component either way, so there is
 * exactly one onboarding code path, not a separate "resume" screen. The initial step is computed
 * once from what is already saved (see computeFirstIncompleteStep below), so completed steps are
 * never re-shown as step 1 and a returning owner always lands where they left off.
 */
export default function OwnerOnboardingScreen({ salonId }: { salonId: string }) {
  const { reload } = useSalon();
  const { t } = useLanguage();
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [chairs, setChairs] = useState<SalonChairDto[]>([]);
  const [staff, setStaff] = useState<SalonStaffDto[]>([]);
  const [hours, setHours] = useState<OperatingHoursDto[]>([]);
  const [photos, setPhotos] = useState<PhotoDto[]>([]);
  const [paymentQr, setPaymentQr] = useState<SalonPaymentQrDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [maxStepReached, setMaxStepReached] = useState(1);
  // Null until the very first load resolves; then fixed at whichever step that load resumed onto
  // (1 for a brand-new registration, >1 for a returning owner) — used only to decide whether the
  // "pick up where you left off" banner below is warranted, never touched again afterward.
  const [resumedAtStep, setResumedAtStep] = useState<number | null>(null);
  const stepInitializedRef = useRef(false);
  const [goingLive, setGoingLive] = useState(false);
  const [goLiveError, setGoLiveError] = useState<string | null>(null);
  const [missingRequirements, setMissingRequirements] = useState<SalonSetupReadinessDto | null>(null);
  const [live, setLive] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return Promise.all([
      apiFetch<ServiceDto[]>(scope(salonId, DASHBOARD_PATHS.services)),
      apiFetch<SalonChairDto[]>(scope(salonId, DASHBOARD_PATHS.chairs)),
      apiFetch<SalonStaffDto[]>(scope(salonId, DASHBOARD_PATHS.staff)),
      apiFetch<OperatingHoursDto[]>(scope(salonId, DASHBOARD_PATHS.operatingHours)),
      apiFetch<PhotoDto[]>(scope(salonId, DASHBOARD_PATHS.photos)),
      apiFetch<SalonPaymentQrDto>(scope(salonId, DASHBOARD_PATHS.paymentQr)),
    ])
      .then(([s, c, st, h, p, qr]) => {
        setServices(s);
        setChairs(c);
        setStaff(st);
        setHours(h);
        setPhotos(p);
        setPaymentQr(qr);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load your shop setup.'))
      .finally(() => setLoading(false));
  }, [salonId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasService = services.some((s) => s.isActive);
  const hasChair = chairs.some((c) => c.status === ChairStatus.ACTIVE);
  const hasStaff = staff.some((s) => s.status === StaffMemberStatus.ACTIVE);
  const hasOpenDay = hours.some((h) => !h.isClosed);
  const hasPhoto = photos.length > 0;
  const hasPaymentQr = Boolean(paymentQr?.paymentQrImageUrl);

  // Runs once, the instant every list has loaded — never again, so navigating between steps
  // (which doesn't reload) can't reset progress, and a step already completed by the time the
  // owner returns is never re-shown as the current step.
  useEffect(() => {
    if (loading || stepInitializedRef.current) return;
    stepInitializedRef.current = true;
    const first = computeFirstIncompleteStep({ hasService, hasOpenDay, hasPhoto, hasChair, hasStaff, hasPaymentQr });
    setStep(first);
    setMaxStepReached(first);
    setResumedAtStep(first);
  }, [loading, hasService, hasOpenDay, hasPhoto, hasChair, hasStaff, hasPaymentQr]);

  function goToStep(next: number) {
    setStep(next);
    setMaxStepReached((prev) => Math.max(prev, next));
    setGoLiveError(null);
    setMissingRequirements(null);
  }

  async function goLive() {
    setGoingLive(true);
    setGoLiveError(null);
    setMissingRequirements(null);
    try {
      await apiFetch(scope(salonId, DASHBOARD_PATHS.status), {
        method: 'PATCH',
        body: JSON.stringify({ status: SalonStatus.ACTIVE }),
      });
      setLive(true);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === SalonSetupErrorCode.SALON_SETUP_INCOMPLETE) {
        setMissingRequirements((err.details ?? null) as SalonSetupReadinessDto | null);
      } else {
        setGoLiveError(err instanceof ApiError ? err.message : t.couldNotGoLive);
      }
    } finally {
      setGoingLive(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <Skeleton style={styles.skeleton} />
        <Skeleton style={styles.skeleton} />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen scroll={false}>
        <EmptyState title={t.couldNotGoLive} message={error} />
      </Screen>
    );
  }

  if (live) {
    return (
      <Screen scroll={false} contentStyle={styles.liveScreen}>
        <SectionHeader eyebrow={t.onboardingGoLiveStepTitle} title={t.shopIsLiveTitle} subtitle={t.shopIsLiveHint} />
        <Button title={t.continueToDashboardAction} onPress={reload} style={styles.goLiveButton} />
      </Screen>
    );
  }

  const stepTitle = STEP_TITLES[step](t);

  return (
    <Screen contentStyle={styles.screenContent}>
      {resumedAtStep !== null && resumedAtStep > 1 && step === resumedAtStep && (
        <Text style={styles.resumeBanner}>{t.resumeSetupBanner}</Text>
      )}
      <SectionHeader eyebrow={t.onboardingStepOf(step, TOTAL_STEPS)} title={stepTitle} />
      <View style={styles.progressTrack}>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
          <View key={s} style={[styles.progressDot, s <= maxStepReached && styles.progressDotDone, s === step && styles.progressDotActive]} />
        ))}
      </View>

      {step === 1 && (
        <>
          <Card style={sectionStyles.card}>
            {services.length === 0 ? (
              <Text style={sectionStyles.emptyText}>{t.noServicesYet}</Text>
            ) : (
              services.map((s) => <ServiceRow key={s.id} salonId={salonId} service={s} onChanged={() => void load()} />)
            )}
          </Card>
          <AddServiceForm salonId={salonId} onAdded={() => void load()} />
        </>
      )}

      {step === 2 && (
        <Card style={sectionStyles.card}>
          <HoursEditor salonId={salonId} hours={hours} onSaved={setHours} />
        </Card>
      )}

      {step === 3 && <PhotosSection salonId={salonId} photos={photos} onChanged={() => void load()} />}

      {step === 4 && (
        <>
          <Card style={sectionStyles.card}>
            {chairs.length === 0 ? (
              <Text style={sectionStyles.emptyText}>{t.noChairsYet}</Text>
            ) : (
              chairs.map((c) => <ChairRow key={c.id} salonId={salonId} chair={c} onChanged={() => void load()} />)
            )}
          </Card>
          <AddChairForm salonId={salonId} onAdded={() => void load()} />
        </>
      )}

      {step === 5 && (
        <>
          <Card style={sectionStyles.card}>
            {staff.length === 0 ? (
              <Text style={sectionStyles.emptyText}>{t.noBarbersYet}</Text>
            ) : (
              staff.map((member) => (
                <View key={member.id} style={sectionStyles.row}>
                  <View style={sectionStyles.rowBody}>
                    <Text style={sectionStyles.rowTitle}>{member.displayName}</Text>
                    <Text style={sectionStyles.rowMeta}>{member.status}</Text>
                  </View>
                </View>
              ))
            )}
          </Card>
          <AddStaffForm salonId={salonId} onAdded={() => void load()} />
        </>
      )}

      {step === 6 && <PaymentQrSection salonId={salonId} paymentQr={paymentQr} onChanged={() => void load()} />}

      {step === 7 && (
        <View>
          {goLiveError && <InlineError message={goLiveError} />}
          {missingRequirements && (
            <Card style={sectionStyles.card}>
              <Text style={styles.missingTitle}>{t.setupIncompleteTitle}</Text>
              {!missingRequirements.hasActiveService && <Text style={styles.missingItem}>{t.setupIncompleteMissingService}</Text>}
              {!missingRequirements.hasActiveChair && <Text style={styles.missingItem}>{t.setupIncompleteMissingChair}</Text>}
              {!missingRequirements.hasActiveStaff && <Text style={styles.missingItem}>{t.setupIncompleteMissingStaff}</Text>}
            </Card>
          )}
          <Button
            title={goingLive ? t.goingLiveEllipsis : t.goLiveAction}
            onPress={() => void goLive()}
            loading={goingLive}
            style={styles.goLiveButton}
          />
        </View>
      )}

      <View style={styles.navRow}>
        {step > 1 && <Button title={t.previousAction} variant="outline" onPress={() => goToStep(step - 1)} style={styles.navButton} />}
        {step < TOTAL_STEPS && ONBOARDING_SKIPPABLE_STEPS.has(step) && (
          <Button title={t.skipForNowAction} variant="outline" onPress={() => goToStep(step + 1)} style={styles.navButton} />
        )}
        {step < TOTAL_STEPS && (
          <Button title={t.saveAndNextAction} onPress={() => goToStep(step + 1)} style={styles.navButton} />
        )}
      </View>
    </Screen>
  );
}

const STEP_TITLES: Record<number, (t: ReturnType<typeof useLanguage>['t']) => string> = {
  1: (t) => t.onboardingServicesStepTitle,
  2: (t) => t.onboardingHoursStepTitle,
  3: (t) => t.onboardingPhotosStepTitle,
  4: (t) => t.onboardingChairsStepTitle,
  5: (t) => t.onboardingStaffStepTitle,
  6: (t) => t.onboardingPaymentQrStepTitle,
  7: (t) => t.onboardingGoLiveStepTitle,
};

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeleton: { height: 100, borderRadius: radius.lg, marginBottom: space[3] },
  resumeBanner: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.xs,
    color: color.accent,
    backgroundColor: color.goldSoft,
    borderRadius: radius.sm,
    padding: space[3],
    marginBottom: space[3],
  },
  progressTrack: { flexDirection: 'row', gap: space[2], marginBottom: space[4] },
  progressDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.border },
  progressDotDone: { backgroundColor: color.goldSoft },
  progressDotActive: { backgroundColor: color.accent },
  navRow: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
  navButton: { flex: 1 },
  goLiveButton: { marginTop: space[2] },
  missingTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink, marginBottom: space[2] },
  missingItem: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginBottom: space[1] },
  liveScreen: { flex: 1, padding: space[5], justifyContent: 'center' },
});
