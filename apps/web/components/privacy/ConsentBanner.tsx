"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { openCookiePreferences, readConsent, saveConsent, VI_OPEN_PREFERENCES_EVENT } from "../../lib/visitor-intel/consent";
import { isTrackablePath, visitorId } from "../../lib/visitor-intel/tracker";
import styles from "./consent-banner.module.css";
import { visitorIntelEnabled } from "../../lib/dashboard-flags";

/**
 * Cookie choice (DPDP-aligned: specific, informed, as easy to refuse as to accept). Shown once per policy
 * version on public pages; "Cookie preferences" in the footer reopens it at any time.
 */
export function ConsentBanner() {
  return visitorIntelEnabled() ? <ConsentBannerInner /> : null;
}

function ConsentBannerInner() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const c = readConsent();
      if (!c && isTrackablePath(pathname)) setOpen(true);
      if (c) {
        setAnalytics(c.analytics);
        setMarketing(c.marketing);
      }
    }, 0);
    const reopen = () => {
      const c = readConsent();
      setAnalytics(c?.analytics ?? true);
      setMarketing(c?.marketing ?? false);
      setCustom(true);
      setOpen(true);
    };
    window.addEventListener(VI_OPEN_PREFERENCES_EVENT, reopen);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(VI_OPEN_PREFERENCES_EVENT, reopen);
    };
  }, [pathname]);

  if (!open) return null;

  const decide = (a: boolean, m: boolean) => {
    saveConsent(a, m, visitorId(), custom ? "PREFERENCES" : "BANNER");
    setOpen(false);
    setCustom(false);
  };

  return (
    <section className={styles.banner} role="dialog" aria-modal="false" aria-labelledby="fq-consent-title">
      <h2 id="fq-consent-title">Your privacy choices</h2>
      <p>
        FastQue uses essential storage to run the site. With your permission we also measure visits and searches
        (first-party, pseudonymous, no keystrokes or form contents) and, separately, may use marketing cookies for ad
        measurement. <Link href="/privacy/analytics">How we measure visits</Link>
      </p>
      {custom && (
        <div className={styles.options}>
          <label className={styles.option}>
            <input type="checkbox" checked disabled />
            <span>Essential<small>Login, security and your cookie choice. Always on.</small></span>
          </label>
          <label className={styles.option}>
            <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
            <span>Analytics<small>Visits, pages, searches and bookings, to improve FastQue. Approximate city only.</small></span>
          </label>
          <label className={styles.option}>
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
            <span>Marketing<small>Ad measurement (Google, Meta) and offers based on your activity.</small></span>
          </label>
        </div>
      )}
      <div className={styles.actions}>
        {custom ? (
          <button type="button" className={styles.primary} onClick={() => decide(analytics, marketing)}>Save choices</button>
        ) : (
          <button type="button" className={styles.primary} onClick={() => decide(true, true)}>Accept all</button>
        )}
        <button type="button" className={styles.secondary} onClick={() => decide(false, false)}>Reject non-essential</button>
        {!custom && (
          <button type="button" className={styles.link} onClick={() => setCustom(true)}>Customise</button>
        )}
      </div>
    </section>
  );
}

export function CookiePreferencesLink() {
  if (!visitorIntelEnabled()) return null;
  return (
    <button type="button" className={styles.footerLink} onClick={() => openCookiePreferences()}>
      Cookie preferences
    </button>
  );
}
