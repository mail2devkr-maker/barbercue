"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkAssignmentSummaryDto, WorkerDashboardDto } from "@barbercue/shared";
import { RequireRole } from "../../../../components/auth/RequireRole";
import { safeNextPath } from "../../../../lib/safe-next-path";
import { ASSIGNMENT_STATUS, errorText, money, PAYOUT_STATUS, when, workGet } from "../../../../lib/work";
import { Badge, WorkNav } from "../WorkUi";
import { WorkerProfileForm } from "./WorkerProfileForm";
import styles from "../work.module.css";

function AssignmentList({
  title,
  icon,
  items,
  empty,
  cta,
}: {
  title: string;
  icon: string;
  items: WorkAssignmentSummaryDto[];
  empty: string;
  cta?: { href: string; label: string };
}) {
  const id = `list-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section className={styles.pgListCard} aria-labelledby={id}>
      <div className={styles.pgListHead}>
        <h2 id={id}>{title}</h2>
        <span className={styles.pgCount}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className={styles.pgEmpty}>
          <span>{empty}</span>
          {cta && (
            <Link href={cta.href} className={styles.btnPrimary}>
              {cta.label}
            </Link>
          )}
        </div>
      ) : (
        items.map((a) => (
          <Link key={a.id} href={`/work/me/assignments/${a.id}`} className={styles.pgRow}>
            <span className={styles.pgRowIcon} aria-hidden="true">
              {icon}
            </span>
            <span className={styles.rowMain}>
              <span className={styles.pgRowTitle}>{a.jobTitle}</span>
              <span className={styles.meta}>
                {a.employerName} · {a.city} · {when(a.startsAt)}
              </span>
            </span>
            <span className={styles.pgRowEnd}>
              <strong>{money(a.approvedAmountPaise ?? a.agreedPayPaise)}</strong>
              <Badge tone={ASSIGNMENT_STATUS[a.status].tone}>{ASSIGNMENT_STATUS[a.status].label}</Badge>
              {a.payoutStatus && a.status !== "PAID" && <Badge tone={PAYOUT_STATUS[a.payoutStatus].tone}>{PAYOUT_STATUS[a.payoutStatus].label}</Badge>}
            </span>
          </Link>
        ))
      )}
    </section>
  );
}

function ProfileOnboarding({ editing, profile, onSaved, onCancel }: { editing: boolean; profile: WorkerDashboardDto["profile"]; onSaved: () => void; onCancel: () => void }) {
  return (
    <>
      <section className={styles.pgHero} aria-labelledby="me-hero">
        <div className={styles.pgHeroMain}>
          <span className={styles.lpEyebrow}>🎓 Your worker profile</span>
          <h1 id="me-hero" className={styles.pgTitle}>
            {editing ? (
              "Edit your profile"
            ) : (
              <>
                Start earning <span className={styles.lpTitleAccent}>in two minutes.</span>
              </>
            )}
          </h1>
          <p className={styles.pgLead}>A short profile so we only show you gigs you’re eligible for. Your phone number is already verified from sign-in.</p>
          <div className={styles.pgPills}>
            <span className={styles.pgPill}>✓ ₹0 to join</span>
            <span className={styles.pgPill}>✓ 18+ only</span>
            <span className={styles.pgPill}>✓ Paid to your UPI</span>
          </div>
          {editing && (
            <button type="button" className={styles.pgBtnOutline} onClick={onCancel}>
              ← Back to my work
            </button>
          )}
        </div>
        <div className={styles.pgHeroAside} aria-hidden="true">
          <div className={styles.pgFeature}>
            <span className={styles.pgFeatureIcon}>🔍</span>
            <span>
              <strong>Matched gigs</strong>Your city, skills and travel distance decide what you see.
            </span>
          </div>
          <div className={styles.pgFeature}>
            <span className={styles.pgFeatureIcon}>🔒</span>
            <span>
              <strong>Private by default</strong>Businesses never see your UPI ID or date of birth.
            </span>
          </div>
        </div>
      </section>

      <div className={styles.pgSplit}>
        <WorkerProfileForm initial={profile} onSaved={onSaved} />
        <aside className={styles.pgSide} aria-label="Tips">
          <div className={styles.pgPanel}>
            <h2>Why we ask</h2>
            <ul className={styles.pgTicks}>
              <li>
                <span>
                  <strong>Date of birth</strong> — to confirm you’re 18+. Only your age is used.
                </span>
              </li>
              <li>
                <span>
                  <strong>City and distance</strong> — so on-site gigs are actually reachable for you.
                </span>
              </li>
              <li>
                <span>
                  <strong>Skills and languages</strong> — gigs list what they need; honest skills mean better matches.
                </span>
              </li>
              <li>
                <span>
                  <strong>UPI ID</strong> — the only way we pay you. You can add it later.
                </span>
              </li>
            </ul>
          </div>
          <div className={styles.pgPanel}>
            <h3>⚠️ Stay safe</h3>
            <p>No real gig asks you to pay a fee, deposit, or share an OTP. If one does, don’t pay — report it.</p>
          </div>
        </aside>
      </div>
    </>
  );
}

function WorkerHome() {
  const router = useRouter();
  const [data, setData] = useState<WorkerDashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    workGet<WorkerDashboardDto>("me/dashboard")
      .then(setData)
      .catch((err) => setError(errorText(err, "Couldn’t load your work.")));
  }, []);
  useEffect(load, [load]);

  if (error) return <p className={styles.error} role="alert">{error}</p>;
  if (!data) return <div className={styles.skeleton} aria-busy="true" />;

  if (!data.profile || editing) {
    return (
      <ProfileOnboarding
        editing={!!data.profile}
        profile={data.profile}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          const next = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("next");
          const safe = next ? safeNextPath(next) : null;
          if (safe && safe.startsWith("/work/")) router.push(safe);
          else load();
        }}
      />
    );
  }

  const p = data.profile;
  const r = data.reliability;
  const verifiedLabel = p.verificationLevel >= 2 ? "✓ Verified worker" : p.verificationLevel === 1 ? "✓ Phone verified" : "Phone not verified";
  const reliabilityPct = r.reliabilityRate === null ? null : Math.round(r.reliabilityRate * 100);
  const nextUp = data.today[0] ?? data.upcoming[0] ?? null;

  return (
    <>
      <section className={styles.pgHero} aria-labelledby="me-greet">
        <div className={styles.pgHeroMain}>
          <span className={styles.lpEyebrow}>🎓 My work</span>
          <h1 id="me-greet" className={styles.pgTitle}>
            Hi {p.fullName.split(" ")[0]} 👋
          </h1>
          <p className={styles.pgLead}>
            {nextUp ? (
              <>
                Next up: <strong>{nextUp.jobTitle}</strong> · {when(nextUp.startsAt)}
              </>
            ) : (
              "Nothing booked yet — there are gigs waiting for you."
            )}
          </p>
          <div className={styles.pgPills}>
            <span className={`${styles.pgPill} ${p.verificationLevel >= 1 ? styles.pgPillGood : styles.pgPillWarn}`}>{verifiedLabel}</span>
            <span className={styles.pgPill}>📍 {p.city}</span>
            {!p.payoutUpiVpaMasked && <span className={`${styles.pgPill} ${styles.pgPillWarn}`}>Add a UPI ID to get paid</span>}
          </div>
          <div className={styles.pgHeroActions}>
            <Link href="/work" className={styles.pgBtnHot}>
              Find gigs →
            </Link>
            <button type="button" className={styles.pgBtnOutline} onClick={() => setEditing(true)}>
              Edit profile
            </button>
          </div>
        </div>
        <div className={styles.pgMoney}>
          <span className={styles.pgMoneyLabel}>Paid to your UPI</span>
          <span className={styles.pgMoneyValue}>{money(data.earnings.paidPaise)}</span>
          <div className={styles.pgMoneyRow}>
            <span>
              Being paid <strong>{money(data.earnings.payablePaise)}</strong>
            </span>
            <span>
              Awaiting review <strong>{money(data.earnings.pendingReviewPaise)}</strong>
            </span>
          </div>
        </div>
      </section>

      {!p.payoutUpiVpaMasked && (
        <div className={styles.pgCallout}>
          <p>
            <strong>Add your UPI ID</strong> so approved gigs can be paid straight to you. Businesses never see it.
          </p>
          <button type="button" className={styles.pgBigBtn} onClick={() => setEditing(true)}>
            Add UPI ID
          </button>
        </div>
      )}

      <div className={styles.pgGrid2}>
        <div className={styles.pgStat}>
          <span className={styles.pgStatLabel}>Completed gigs</span>
          <span className={styles.pgStatValue}>{r.completed}</span>
          <span className={styles.pgStatHint}>Shown to businesses on your profile</span>
        </div>
        <div className={styles.pgStat}>
          <span className={styles.pgStatLabel}>Reliability</span>
          <span className={styles.pgStatValue}>{reliabilityPct === null ? "New" : `${reliabilityPct}%`}</span>
          {reliabilityPct !== null && (
            <div className={styles.pgMeter} aria-hidden="true">
              <span style={{ width: `${reliabilityPct}%` }} />
            </div>
          )}
          <span className={styles.pgStatHint}>
            Completed ÷ (completed + late cancellations + upheld no-shows). Late cancellations: {r.lateCancellations} · No-shows: {r.noShows}
          </span>
        </div>
      </div>

      {data.applications.length > 0 && (
        <section className={styles.pgListCard} aria-labelledby="me-apps">
          <div className={styles.pgListHead}>
            <h2 id="me-apps">Applications</h2>
            <span className={styles.pgCount}>{data.applications.length}</span>
          </div>
          {data.applications.map((a) => (
            <Link key={a.id} href={`/work/jobs/${a.jobId}`} className={styles.pgRow}>
              <span className={styles.pgRowIcon} aria-hidden="true">
                {a.status === "OFFERED" ? "🎉" : "📨"}
              </span>
              <span className={styles.pgRowTitle}>{a.jobTitle}</span>
              <span className={styles.pgRowEnd}>
                <Badge tone={a.status === "OFFERED" ? "green" : a.status === "APPLIED" ? "amber" : "grey"}>{a.status === "OFFERED" ? "Offer — respond now" : a.status.toLowerCase()}</Badge>
              </span>
            </Link>
          ))}
        </section>
      )}

      <div className={styles.pgGrid2}>
        <AssignmentList title="Today" icon="⏰" items={data.today} empty="Nothing scheduled for today." />
        <AssignmentList title="Upcoming" icon="🗓" items={data.upcoming} empty="No upcoming gigs yet." cta={{ href: "/work", label: "Find a gig" }} />
      </div>
      <AssignmentList title="Waiting for review or in dispute" icon="🕵️" items={data.awaitingReview} empty="Nothing waiting for review." />
      <AssignmentList title="Completed and past" icon="✅" items={data.completed} empty="Your finished gigs and payments will appear here." />

      {data.earnings.transactions.length > 0 && (
        <section className={styles.pgListCard} aria-labelledby="me-earn">
          <div className={styles.pgListHead}>
            <h2 id="me-earn">Earnings history</h2>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Gig</th>
                  <th>Type</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.earnings.transactions.map((t) => (
                  <tr key={t.id}>
                    <td>{when(t.createdAt)}</td>
                    <td>{t.jobTitle ?? "—"}</td>
                    <td>{t.kind === "PAID_OUT" ? "Paid to your UPI" : "Earned (approved)"}</td>
                    <td>{money(Math.abs(t.amountPaise))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

export default function WorkerAreaPage() {
  return (
    <RequireRole redirectTo="/login">
      <main className={styles.page}>
        <WorkNav />
        <WorkerHome />
      </main>
    </RequireRole>
  );
}
