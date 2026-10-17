"use client";

import { useCallback, useEffect, useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { isSandbox, isUsable, unavailableMessage } from "../../lib/capabilities";
import { newIdempotencyKey } from "../../lib/idempotency";
import { useCapabilities } from "../../lib/use-capabilities";
import {
  DELETE_CONFIRMATION,
  confirmationMatches,
  countRows,
  deleteBody,
  parseDeletePreview,
  parseDemoStatus,
  previewExpired,
  type DeletePreview,
  type DemoStatus,
} from "../../lib/demo-workspace";
import { Banner, Btn, Card, EmptyState, Field, Skeleton } from "./parts";
import ui from "./owner.module.css";

/**
 * Demo Workspace: sample data for trying FastQue, kept in a private workspace that is separate from the shop's real
 * records. This screen only imports, shows and deletes that workspace. It never edits real data, and it says so.
 *
 * It appears only when the server reports the `demoData` capability as usable. Opening demo data inside the dashboard
 * (workspace-scoped read screens with an always-on DEMO banner) is not part of this screen, and it says that too.
 */
export function DemoWorkspace({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/demo`;
  const capabilities = useCapabilities(salonId);
  const usable = isUsable(capabilities.features, "demoData");

  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"loading" | "import" | "preview" | "delete" | null>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [typed, setTyped] = useState("");

  const loadStatus = useCallback(async () => {
    setLoadError(null);
    try {
      const raw = await apiFetch<unknown>(`${base}/status`);
      setStatus(parseDemoStatus(raw));
    } catch (err) {
      setStatus(null);
      setLoadError(err instanceof ApiError ? err.message : "Could not check your demo data.");
    } finally {
      setBusy(null);
    }
  }, [base]);

  useEffect(() => {
    if (!usable) return;
    void Promise.resolve().then(() => loadStatus());
  }, [usable, loadStatus]);

  if (capabilities.phase === "loading") return <Skeleton height={160} />;
  if (!usable) {
    return (
      <EmptyState title="Demo data is not available yet">
        {unavailableMessage(capabilities.phase === "ready" ? capabilities.features : null, "demoData")} Nothing about your real shop is affected.
      </EmptyState>
    );
  }

  async function importDemo() {
    setBusy("import");
    setError(null);
    setNotice(null);
    try {
      // One key per click: a repeated click is the same intent, so the server can safely replay the first result.
      const raw = await apiFetch<unknown>(`${base}/import`, { method: "POST", headers: { "Idempotency-Key": newIdempotencyKey() } });
      const next = parseDemoStatus(raw);
      if (!next.active) {
        setError("The server did not confirm that demo data was added. Check again in a moment.");
        await loadStatus();
      } else {
        setStatus(next);
        setNotice("Demo data added to a separate private workspace. Your real shop was not changed.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add demo data.");
    } finally {
      setBusy(null);
    }
  }

  async function startDelete() {
    setBusy("preview");
    setError(null);
    setNotice(null);
    try {
      const raw = await apiFetch<unknown>(`${base}/delete-preview`, { method: "POST" });
      const next = parseDeletePreview(raw);
      if (!next) setError("The server did not return a confirmation. Nothing was deleted.");
      else {
        setPreview(next);
        setTyped("");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not prepare the deletion. Nothing was deleted.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!status?.workspaceId || !preview) return;
    if (previewExpired(preview)) {
      setPreview(null);
      setError("That confirmation has expired. Start again to delete the demo data.");
      return;
    }
    setBusy("delete");
    setError(null);
    try {
      await apiFetch<unknown>(base, { method: "DELETE", body: JSON.stringify(deleteBody(status.workspaceId, preview.confirmationToken)) });
      setPreview(null);
      setTyped("");
      await loadStatus();
      setNotice("Demo data deleted. Your real shop data was not changed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the demo data.");
    } finally {
      setBusy(null);
    }
  }

  const rows = countRows(status?.counts ?? null);
  const working = busy !== null;

  return (
    <div className={ui.mt16}>
      {isSandbox(capabilities.features, "demoData") && <Banner tone="info">This feature is in test mode for your shop.</Banner>}
      <Card
        title="Demo data"
        sub="Try FastQue with sample customers, staff, services and bookings. Demo data lives in a separate private workspace. It never mixes with your real customers, bookings, revenue or reports, and it is never shown to the public."
      >
        {busy === "loading" && <Skeleton height={90} />}
        {loadError && <Banner tone="error">{loadError}</Banner>}
        {error && <div className={ui.mt12}><Banner tone="error">{error}</Banner></div>}
        <div role="status" aria-live="polite">{notice && <div className={ui.mt12}><Banner tone="ok">{notice}</Banner></div>}</div>

        {status && !status.active && busy !== "loading" && (
          <div className={ui.mt12}>
            <p className={ui.cardSub}>You have no demo data right now.</p>
            <Btn variant="primary" onClick={() => void importDemo()} disabled={working}>{busy === "import" ? "Adding…" : "Add demo data"}</Btn>
          </div>
        )}

        {status?.active && (
          <div className={ui.mt12}>
            <Banner tone="warn"><strong>{status.label}</strong></Banner>
            {rows.length > 0 && (
              <div className={ui.tableWrap}>
                <table className={ui.table}>
                  <caption className={ui.cardSub}>What is in your demo workspace</caption>
                  <thead><tr><th>Item</th><th className={ui.num}>Count</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key}><td>{r.label}</td><td className={ui.num}>{r.value}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={ui.cardSub}>Browsing demo data inside the dashboard is not available yet. Deleting it removes only this demo workspace.</p>

            {!preview && (
              <Btn variant="danger" onClick={() => void startDelete()} disabled={working}>{busy === "preview" ? "Preparing…" : "Delete demo data"}</Btn>
            )}

            {preview && (
              <div className={ui.mt12} role="region" aria-label="Confirm demo data deletion">
                <Banner tone="warn">
                  This deletes the demo workspace and everything in it. Your real customers, bookings, revenue and reports are not touched. To confirm, type <strong>{DELETE_CONFIRMATION}</strong>.
                </Banner>
                <div className={ui.mt12}>
                  <Field label="Type the phrase to confirm" htmlFor="demo-confirm">
                    <input id="demo-confirm" className={ui.input} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
                  </Field>
                </div>
                <div className={`${ui.rowWrap} ${ui.mt12}`}>
                  <Btn variant="danger" onClick={() => void confirmDelete()} disabled={working || !confirmationMatches(typed)}>{busy === "delete" ? "Deleting…" : "Delete demo data"}</Btn>
                  <Btn variant="quiet" onClick={() => { setPreview(null); setTyped(""); }} disabled={busy === "delete"}>Cancel</Btn>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
