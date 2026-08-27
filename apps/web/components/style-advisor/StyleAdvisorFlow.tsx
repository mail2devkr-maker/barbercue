"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PREMIUM_PATHS, STYLE_ADVISOR_PATHS } from "@barbercue/shared";
import type {
  AiCreditBalanceDto,
  HairstylePreviewDto,
  PremiumEntitlementDto,
  StyleAdvisorResultDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button, LinkButton } from "../ui/Button";
import styles from "./style-advisor.module.css";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

type Status = "idle" | "analyzing" | "results" | "error";
// "checking": entitlement/credit lookup in flight. "locked": not Premium. "no-credits": Premium
// but zero AI credits left this period. "ready": Premium with at least one credit available.
type PremiumStatus = "checking" | "locked" | "no-credits" | "ready";

// Upload -> analyze -> results grid -> "Try This Look" -> booking hand-off. Premium phase: the
// upload form itself is gated behind an active Premium subscription + available AI credit (see
// PremiumEntitlementService/AiCreditService on the backend) — a free or out-of-credits customer
// never sees the upload UI at all. The actual generation call still fails today even for a
// Premium customer with credits: Gemini (the only real provider implemented) requires paid
// billing we haven't enabled, and no verified free alternative was found (see
// style-advisor.module.ts / ARCHITECTURE.md §19) — disclosed via the AI_PROVIDER_NOT_CONFIGURED
// branch below, never hidden or faked. The results-grid rendering path is fully implemented and
// will start working the moment a real provider is wired in, with no UI changes needed.
export function StyleAdvisorFlow() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<HairstylePreviewDto[]>([]);
  const [premiumStatus, setPremiumStatus] = useState<PremiumStatus>("checking");
  const [credits, setCredits] = useState<AiCreditBalanceDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<PremiumEntitlementDto>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.me}`),
      apiFetch<AiCreditBalanceDto>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.credits}`),
    ])
      .then(([entitlement, balance]) => {
        if (cancelled) return;
        setCredits(balance);
        if (!entitlement.isPremium) setPremiumStatus("locked");
        else setPremiumStatus(balance.available > 0 ? "ready" : "no-credits");
      })
      .catch(() => {
        if (!cancelled) setPremiumStatus("locked");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    setError(null);
    setStatus("idle");
    if (!selected) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!ACCEPTED_TYPES.includes(selected.type) || selected.size > MAX_BYTES) {
      setFile(null);
      setPreviewUrl(null);
      setError("Please choose a JPEG, PNG, or WebP photo under 5MB.");
      return;
    }
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  async function handleAnalyze() {
    if (!file) return;
    setStatus("analyzing");
    setError(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const result = await apiFetch<StyleAdvisorResultDto>(
        `${STYLE_ADVISOR_PATHS.styleAdvisor}/${STYLE_ADVISOR_PATHS.generate}`,
        { method: "POST", body: form },
      );
      setResults(result.results);
      setStatus("results");
      // Reflect the just-spent credit immediately rather than showing a stale count — best-effort,
      // a failed refresh here doesn't affect the backend's authoritative balance.
      apiFetch<AiCreditBalanceDto>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.credits}`)
        .then((balance) => setCredits(balance))
        .catch(() => {});
    } catch (err) {
      // Defense in depth: the pre-check above already hides the upload form from a non-Premium or
      // out-of-credits customer, but the backend is the real authority — if entitlement changed
      // between page load and this request, reflect that instead of showing a generic error.
      if (err instanceof ApiError && err.code === "PREMIUM_REQUIRED") {
        setPremiumStatus("locked");
        return;
      }
      if (err instanceof ApiError && err.code === "AI_CREDITS_EXHAUSTED") {
        setPremiumStatus("no-credits");
        return;
      }
      if (err instanceof ApiError && err.code === "AI_PROVIDER_NOT_CONFIGURED") {
        setError("AI Style Preview is temporarily unavailable while we prepare the image-generation service. Your photo was not stored.");
      } else {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      }
      setStatus("error");
    }
  }

  function handleTryThisLook(styleName: string) {
    router.push(`/search?style=${encodeURIComponent(styleName)}`);
  }

  function handleStartOver() {
    setFile(null);
    setPreviewUrl(null);
    setResults([]);
    setError(null);
    setStatus("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (premiumStatus === "checking") {
    return <p className={styles.loadingText}>Checking your Premium status…</p>;
  }

  if (premiumStatus === "locked") {
    return (
      <div className={styles.gateCard}>
        <span className={styles.gateIcon} aria-hidden="true">🔒</span>
        <p className={styles.gateTitle}>AI Style Advisor is a Premium feature</p>
        <p className={styles.gateText}>
          Upgrade to Premium to preview hairstyles on your photo.
        </p>
        <LinkButton href="/account/premium" variant="secondary">
          View Premium Plans
        </LinkButton>
      </div>
    );
  }

  if (premiumStatus === "no-credits") {
    return (
      <div className={styles.gateCard}>
        <p className={styles.gateText} style={{ marginBottom: 20 }}>
          You&apos;ve used all your AI Style Credits for this subscription period.
        </p>
        <LinkButton href="/account/premium" variant="secondary">
          View Premium Plans
        </LinkButton>
      </div>
    );
  }

  if (status === "results") {
    return (
      <div>
        <p className={styles.resultsIntro}>
          Here are a few looks to consider. Each shows an AI Style Match — not a guarantee of how
          it will turn out on you.
        </p>
        <div className={styles.resultsGrid}>
          {results.map((r) => (
            <div key={r.styleId} className={styles.resultCard}>
              {/* eslint-disable-next-line @next/next/no-img-element -- provider-hosted preview URL, not a static/local asset next/image can optimize */}
              <img src={r.previewUrl} alt={`Preview of the ${r.styleName} style`} className={styles.resultImg} />
              <div className={styles.resultBody}>
                <p className={styles.resultName}>{r.styleName}</p>
                <p className={styles.resultMatch}>AI Style Match: {r.matchPercent}%</p>
                <Button type="button" variant="secondary" onClick={() => handleTryThisLook(r.styleName)}>
                  Try This Look
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className={styles.startOverWrap}>
          <Button type="button" variant="outline" onClick={handleStartOver}>
            Start over
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.uploadCard}>
      <input
        ref={fileInputRef}
        id="style-advisor-file"
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        onChange={handleFileChange}
        className={styles.fileInputWrap}
      />
      <label htmlFor="style-advisor-file" className={styles.chooseButton}>
        {file ? "Choose a different photo" : "+ Choose a photo"}
      </label>
      <p className={styles.hint}>JPEG, PNG, or WebP, up to 5MB.</p>

      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not an optimizable remote asset
        <img src={previewUrl} alt="Your uploaded photo" className={styles.previewImg} />
      )}

      {error && <p className={styles.errorBanner}>{error}</p>}

      {credits && (
        <p className={styles.creditsNote}>
          AI Credits remaining: <strong>{credits.available}</strong>
        </p>
      )}

      <Button type="button" variant="secondary" onClick={() => void handleAnalyze()} disabled={!file || status === "analyzing"}>
        {status === "analyzing" ? "Analyzing…" : "Analyze my photo"}
      </Button>

      <p className={styles.privacyNote}>
        Your photo is used only to generate these previews and is not stored.
      </p>
    </div>
  );
}
