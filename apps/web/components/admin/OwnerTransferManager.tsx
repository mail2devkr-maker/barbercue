"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ADMIN_PATHS } from "@barbercue/shared";
import type { PlatformAdminOverviewDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import {
  ACTION_LABEL,
  EVIDENCE_OPTIONS,
  JUSTIFICATION_MIN,
  STATUS_LABEL,
  emailProblem,
  formatWhen,
  isOpen,
  nextStep,
  verifyProblem,
  type EvidenceKind,
  type OwnerTransfer,
} from "../../lib/owner-transfer";
import { Button } from "../ui/Button";
import styles from "../../app/(dashboard)/dashboard/admin/admin.module.css";

type Shop = PlatformAdminOverviewDto["shops"][number];

const BASE = ADMIN_PATHS.admin;
const field = { width: "100%", margin: "4px 0 8px", padding: 8, borderRadius: 6, border: "1px solid #3a3a48", background: "#0d0d12", color: "#f7f7fb", fontSize: 13 } as const;
const STATUS_COLOR: Record<string, string> = { PREPARED: "#f0c36b", VERIFIED: "#6bb8f0", INVITED: "#b48cf0", COMPLETED: "#6bd49a", CANCELLED: "#9a9aa8" };

/**
 * Administrator screen for handing a shop to a different owner. Every action is an existing authenticated Platform Admin
 * API call; the server enforces independence, evidence and rate limits and its message is shown as it is. Administrators
 * never see an invitation token or a password - only the recipient's inbox ever holds the token.
 */
export function OwnerTransferManager() {
  const { user } = useAuth();
  const me = user?.id ?? null;
  const [shops, setShops] = useState<Shop[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Shop | null>(null);
  const [transfers, setTransfers] = useState<OwnerTransfer[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [evidence, setEvidence] = useState<EvidenceKind[]>([]);
  const [reference, setReference] = useState("");
  const [justification, setJustification] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      try {
        const overview = await apiFetch<PlatformAdminOverviewDto>(`${BASE}/${ADMIN_PATHS.overview}`);
        if (active) setShops(overview.shops);
      } catch (err) {
        if (active) setLoadError(err instanceof ApiError ? err.message : "Could not load the shops.");
      }
    });
    return () => { active = false; };
  }, []);

  const loadTransfers = useCallback(async (shopId: string) => {
    setListError(null);
    try {
      setTransfers(await apiFetch<OwnerTransfer[]>(`${BASE}/salons/${shopId}/owner-transfers`));
    } catch (err) {
      setTransfers(null);
      setListError(err instanceof ApiError ? err.message : "Could not load the transfers for this shop.");
    }
  }, []);

  function choose(shop: Shop) {
    setSelected(shop);
    setTransfers(null);
    setError(null);
    setNotice(null);
    setEmail(""); setEmailConfirm(""); setEvidence([]); setReference(""); setJustification(""); setReason("");
    void loadTransfers(shop.id);
  }

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? shops.filter((s) => `${s.name} ${s.publicId} ${s.ownerEmail ?? ""}`.toLowerCase().includes(q)).slice(0, 8) : []),
    [shops, q],
  );

  const open = transfers?.find(isOpen) ?? null;

  async function act(path: string, body: unknown, done: string, confirmText?: string) {
    if (!selected || busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
      setNotice(done);
      setReason("");
      await loadTransfers(selected.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  function prepare() {
    const problem = emailProblem(email, emailConfirm);
    if (problem) { setError(problem); return; }
    void act(`${BASE}/salons/${selected!.id}/owner-transfers`, { newEmail: email.trim().toLowerCase() }, "Transfer prepared. Nothing has moved. A different administrator must now verify the owner.").then(() => {
      setEmail(""); setEmailConfirm("");
    });
  }

  function verify(t: OwnerTransfer) {
    const needsBreakGlass = me !== null && t.preparedByAdminId === me;
    const problem = verifyProblem({ evidence, reference, breakGlassJustification: justification, needsBreakGlass });
    if (problem) { setError(problem); return; }
    void act(
      `${BASE}/owner-transfers/${t.id}/verify`,
      { evidence, reference: reference.trim(), ...(needsBreakGlass ? { breakGlassJustification: justification.trim() } : {}) },
      needsBreakGlass ? "Verified under the break-glass exception. The invitation can be sent after the cool-down." : "Verified. You can now send the invitation.",
      "Record that you personally checked this evidence outside FastQue?",
    );
  }

  const step = open ? nextStep(open) : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Platform administration</p>
          <h1>Owner transfers</h1>
          <p>Hand a shop to a different owner without deleting it. The recipient proves control of the destination e-mail by accepting a single-use link; nothing moves before that. You never see the link or any password.</p>
        </div>
      </header>

      {loadError && <p role="alert" style={{ color: "#ffb7c9" }}>{loadError}</p>}

      <section aria-label="Find a shop">
        <label htmlFor="transfer-shop-search">Find a shop (name, public id or owner e-mail)</label>
        <input id="transfer-shop-search" value={query} onChange={(e) => setQuery(e.target.value)} style={field} autoComplete="off" />
        {q && matches.length === 0 && <p>No shop matches that.</p>}
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {matches.map((shop) => (
            <li key={shop.id} style={{ marginBottom: 6 }}>
              <Button type="button" variant={selected?.id === shop.id ? "primary" : "outline"} onClick={() => choose(shop)}>
                {shop.name} - {shop.publicId} - {shop.status}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {selected && (
        <section aria-label="Selected shop" style={{ marginTop: 16 }}>
          <h2>{selected.name} <small>({selected.publicId})</small></h2>
          <p data-testid="current-owner">Shop status: <strong>{selected.status}</strong>. Current owner account: <strong>{selected.ownerEmail ?? "no e-mail on file"}</strong>.</p>

          {error && <p role="alert" style={{ color: "#ffb7c9" }}>{error}</p>}
          {notice && <p role="status" style={{ color: "#6bd49a" }}>{notice}</p>}
          {listError && <p role="alert" style={{ color: "#ffb7c9" }}>{listError}</p>}

          {transfers && !open && (
            <div aria-label="Prepare a transfer">
              <h3>Prepare a transfer</h3>
              <label htmlFor="transfer-email">Destination e-mail (the new owner&apos;s own address)</label>
              <input id="transfer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} autoComplete="off" />
              <label htmlFor="transfer-email-confirm">Type the address again</label>
              <input id="transfer-email-confirm" type="email" value={emailConfirm} onChange={(e) => setEmailConfirm(e.target.value)} style={field} autoComplete="off" />
              <p style={{ fontSize: 12 }}>An address that already has a FastQue account is accepted only if that account&apos;s e-mail was verified.</p>
              <Button type="button" onClick={prepare} disabled={busy}>{busy ? "Working..." : "Prepare transfer"}</Button>
            </div>
          )}

          {open && step && (
            <div aria-label="Open transfer" style={{ border: "1px solid #3a3a48", borderRadius: 8, padding: 12, margin: "12px 0" }}>
              <h3>
                <span data-testid="open-status" style={{ color: STATUS_COLOR[open.status] }}>{STATUS_LABEL[open.status]}</span>
              </h3>
              <p>Destination: <strong>{open.newEmail}</strong>. Prepared {formatWhen(open.preparedAt)}.{open.breakGlass ? " Break-glass exception in use." : ""}</p>
              {open.verifiedAt && <p>Verified {formatWhen(open.verifiedAt)} with: {open.verificationEvidence.map((k) => EVIDENCE_OPTIONS.find((o) => o.kind === k)?.label ?? k).join("; ")}.</p>}
              {open.status === "INVITED" && <p data-testid="expiry">Invitation {open.invitationCount} of 3 - expires {formatWhen(open.invitationExpiresAt)}.</p>}
              <p data-testid="next-step">{step.note}</p>

              {step.kind === "verify" && (
                <div>
                  {me !== null && open.preparedByAdminId === me && (
                    <p role="note" style={{ color: "#f0c36b" }}>You prepared this transfer. Another administrator should verify it. You may verify it yourself only if no other administrator exists, with a written break-glass justification and a 24-hour wait.</p>
                  )}
                  <fieldset style={{ border: "none", padding: 0 }}>
                    <legend>Evidence you checked outside FastQue</legend>
                    {EVIDENCE_OPTIONS.map((o) => (
                      <label key={o.kind} style={{ display: "block", marginBottom: 4 }}>
                        <input
                          type="checkbox"
                          checked={evidence.includes(o.kind)}
                          onChange={(e) => setEvidence((cur) => (e.target.checked ? [...cur, o.kind] : cur.filter((k) => k !== o.kind)))}
                        />{" "}
                        {o.label} <small>- {o.hint}</small>
                      </label>
                    ))}
                  </fieldset>
                  <label htmlFor="transfer-reference">Who checked what, when and how (no document numbers)</label>
                  <textarea id="transfer-reference" rows={3} value={reference} onChange={(e) => setReference(e.target.value)} style={field} maxLength={300} />
                  {me !== null && open.preparedByAdminId === me && (
                    <>
                      <label htmlFor="transfer-justification">Break-glass justification (at least {JUSTIFICATION_MIN} characters)</label>
                      <textarea id="transfer-justification" rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} style={field} maxLength={500} />
                    </>
                  )}
                  <Button type="button" onClick={() => verify(open)} disabled={busy}>{busy ? "Working..." : "Record verification"}</Button>
                </div>
              )}

              {step.kind === "invite" && (
                <Button type="button" onClick={() => void act(`${BASE}/owner-transfers/${open.id}/invite`, {}, `Invitation sent to ${open.newEmail}. Nothing has moved yet.`, `Send the single-use invitation to ${open.newEmail}?`)} disabled={busy}>
                  {busy ? "Sending..." : "Send invitation"}
                </Button>
              )}

              {step.kind === "reinvite" && (
                <div>
                  <label htmlFor="transfer-reason">Why the recipient is still the right person (at least 10 characters)</label>
                  <textarea id="transfer-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} style={field} maxLength={300} />
                  <Button
                    type="button"
                    onClick={() => (reason.trim().length < 10 ? setError("Write a reason of at least 10 characters.") : void act(`${BASE}/owner-transfers/${open.id}/invite`, { reference: reason.trim() }, `A new invitation was sent to ${open.newEmail}. The previous link no longer works.`, `Send a new invitation to ${open.newEmail}? Any earlier link stops working.`))}
                    disabled={busy}
                  >
                    {busy ? "Sending..." : "Send a new invitation"}
                  </Button>
                </div>
              )}

              <div style={{ marginTop: 8 }}>
                <Button type="button" variant="outline" onClick={() => void act(`${BASE}/owner-transfers/${open.id}/cancel`, {}, "Transfer cancelled. Any link already sent no longer works.", "Cancel this transfer? Any invitation link already sent will stop working.")} disabled={busy}>
                  Cancel transfer
                </Button>
              </div>
            </div>
          )}

          {transfers && transfers.length > 0 && (
            <div aria-label="Transfer history">
              <h3>History</h3>
              {transfers.map((t) => (
                <div key={t.id} data-testid="transfer-row" style={{ borderTop: "1px solid #2a2a36", padding: "8px 0" }}>
                  <strong style={{ color: STATUS_COLOR[t.status] }}>{STATUS_LABEL[t.status]}</strong> - to {t.newEmail}
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12 }}>
                    {(t.history ?? []).map((h, i) => (
                      <li key={`${h.action}-${i}`}>{ACTION_LABEL[h.action] ?? h.action} - {formatWhen(h.at)}{h.actorEmail ? ` - ${h.actorEmail}` : ""}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
