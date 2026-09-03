import Link from "next/link";
import styles from "./customer-auth.module.css";

export type AuthAudience = "customer" | "owner" | "staff" | "admin" | "recovery";

const STORIES: Record<AuthAudience, { eyebrow: string; title: string; copy: string }> = {
  customer: {
    eyebrow: "BOOK AHEAD · WALK IN SMARTER",
    title: "Your barber. Your time.",
    copy: "Keep bookings, live queue visits and style inspiration together in one calm place.",
  },
  owner: {
    eyebrow: "SHOP OWNER WORKSPACE",
    title: "Keep the shop in rhythm.",
    copy: "Return to your shop dashboard, team setup and day-to-day FastQue tools.",
  },
  staff: {
    eyebrow: "BARBER & STAFF WORKSPACE",
    title: "Your chair, clearly organised.",
    copy: "Sign in with the staff account your shop owner invited you to use.",
  },
  admin: {
    eyebrow: "PLATFORM ACCESS",
    title: "FastQue operations.",
    copy: "Restricted access for authorised platform administrators.",
  },
  recovery: {
    eyebrow: "ACCOUNT RECOVERY",
    title: "Get back to your workspace.",
    copy: "Password recovery is available for owner, staff and administrator accounts.",
  },
};

const AUDIENCE_LINKS = [
  { key: "customer", href: "/login", label: "Customer" },
  { key: "owner", href: "/owner/login", label: "Shop owner" },
  { key: "staff", href: "/staff/login", label: "Barber / staff" },
] as const;

export function AuthCard({
  title,
  subtitle,
  audience,
  children,
  showAudienceLinks = true,
}: {
  title: string;
  subtitle?: string;
  audience: AuthAudience;
  children: React.ReactNode;
  showAudienceLinks?: boolean;
}) {
  const story = STORIES[audience];

  return (
    <main className={styles.page}>
      <header className={styles.topBar}>
        <Link href="/" className={styles.wordmark} aria-label="FastQue home">
          <span className={styles.wordmarkMark} aria-hidden="true">BC</span>
          <span>FastQue</span>
        </Link>
        <Link href="/" className={styles.homeLink}>Home</Link>
      </header>

      <div className={styles.shell}>
        <aside className={`${styles.storyPanel} ${styles[`story-${audience}`]}`} aria-label="About FastQue">
          <div className={styles.storyContent}>
            <p className={styles.storyEyebrow}>{story.eyebrow}</p>
            <p className={styles.storyTitle}>{story.title}</p>
            <p className={styles.storyCopy}>{story.copy}</p>
          </div>
          <div className={styles.chairGraphic} aria-hidden="true">
            <span className={styles.chairHalo} />
            <span className={styles.chairBack} />
            <span className={styles.chairSeat} />
            <span className={styles.chairStem} />
            <span className={styles.chairBase} />
          </div>
          <div className={styles.storyProof} aria-hidden="true">
            <span>BOOK</span><i /><span>QUEUE</span><i /><span>CUT</span>
          </div>
        </aside>

        <section className={styles.formPanel} aria-labelledby="auth-title">
          <div className={styles.formHeader}>
            <p className={styles.audienceLabel}>{story.eyebrow}</p>
            <h1 id="auth-title" className={styles.formTitle}>{title}</h1>
            {subtitle && <p className={styles.formSubtitle}>{subtitle}</p>}
          </div>

          <div className={styles.formBody}>{children}</div>

          {showAudienceLinks && (
            <nav className={styles.audienceNav} aria-label="Choose sign-in type">
              <p>Signing in another way?</p>
              <div className={styles.audienceLinks}>
                {AUDIENCE_LINKS.map((link) => (
                  <Link
                    key={link.key}
                    href={link.href}
                    className={styles.audienceLink}
                    aria-current={audience === link.key ? "page" : undefined}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}

export function AuthPageFallback({ audience }: { audience: AuthAudience }) {
  return (
    <AuthCard
      audience={audience}
      title="Preparing sign in…"
      subtitle="FastQue is getting this secure sign-in route ready."
      showAudienceLinks={false}
    >
      <div className={styles.authLoading} role="status" aria-label="Preparing sign in">
        <span /><span /><span />
      </div>
    </AuthCard>
  );
}
