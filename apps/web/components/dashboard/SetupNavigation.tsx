import Link from "next/link";
import { Button, LinkButton } from "../ui/Button";
import styles from "./dashboard.module.css";

const SETUP_STEPS = [
  { id: "services", label: "Services" },
  { id: "hours", label: "Opening hours" },
  { id: "photos", label: "Photos" },
  { id: "chairs", label: "Chairs" },
  { id: "staff", label: "Barbers" },
  { id: "payment-qr", label: "Payment QR" },
  { id: "queue", label: "Live queue" },
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number]["id"];

type NextAction =
  | { kind: "link"; href: string; label?: string }
  | { kind: "submit"; formId: string; label?: string; disabled?: boolean };

export function SetupNavigation({
  salonId,
  currentStep,
  nextAction,
  section = "both",
}: {
  salonId: string;
  currentStep: SetupStep;
  nextAction?: NextAction;
  section?: "steps" | "actions" | "both";
}) {
  const index = SETUP_STEPS.findIndex((step) => step.id === currentStep);
  const previous = index > 0 ? SETUP_STEPS[index - 1] : null;
  const defaultNext = index < SETUP_STEPS.length - 1 ? SETUP_STEPS[index + 1] : null;

  return (
    <>
      {section !== "actions" && <nav className={styles.setupNav} aria-label="Shop setup steps">
        <p className={styles.setupProgress}>Step {index + 1} of {SETUP_STEPS.length}</p>
        <ol className={styles.setupStepRail}>
          {SETUP_STEPS.map((step, stepIndex) => (
            <li key={step.id}>
              <Link
                href={`/dashboard/salons/${salonId}/${step.id}`}
                className={`${styles.setupStep} ${step.id === currentStep ? styles.setupStepCurrent : ""}`}
                aria-current={step.id === currentStep ? "step" : undefined}
              >
                <span aria-hidden="true">{stepIndex + 1}</span>
                {step.label}
              </Link>
            </li>
          ))}
        </ol>
      </nav>}

      {section !== "steps" && <div className={styles.setupActions} aria-label="Setup navigation">
        <div>
          {previous ? (
            <LinkButton
              variant="outline"
              href={`/dashboard/salons/${salonId}/${previous.id}`}
            >
              ← Previous
            </LinkButton>
          ) : (
            <Link href={`/dashboard/salons/${salonId}/settings`} className={styles.setupOverviewLink}>
              Setup overview
            </Link>
          )}
        </div>

        {nextAction?.kind === "submit" ? (
          <Button
            type="submit"
            form={nextAction.formId}
            name="setupIntent"
            value="next"
            variant="secondary"
            disabled={nextAction.disabled}
          >
            {nextAction.label ?? "Save & Next →"}
          </Button>
        ) : (
          <LinkButton
            variant="secondary"
            href={
              nextAction?.kind === "link"
                ? nextAction.href
                : defaultNext
                  ? `/dashboard/salons/${salonId}/${defaultNext.id}`
                  : `/dashboard/salons/${salonId}/settings?setup=complete`
            }
          >
            {nextAction?.label ?? (defaultNext ? "Next →" : "Finish setup")}
          </LinkButton>
        )}
      </div>}
    </>
  );
}
