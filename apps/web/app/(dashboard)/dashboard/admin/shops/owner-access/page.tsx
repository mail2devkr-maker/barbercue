"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  ADMIN_PATHS,
  type OwnerAccessAuditPageDto,
  type OwnerAccessMutationResultDto,
  type OwnerAccessPreviewDto,
  type OwnerAccessShopDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { Button, LinkButton } from "../../../../../../components/ui/Button";
import styles from "./owner-access.module.css";

const BASE = `${ADMIN_PATHS.admin}/${ADMIN_PATHS.shops}/${ADMIN_PATHS.ownerAccess}`;

function message(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "The request could not be completed. Please retry.";
}

export default function OwnerAccessPage() {
  const [query, setQuery] = useState("");
  const [shops, setShops] = useState<OwnerAccessShopDto[]>([]);
  const [selected, setSelected] = useState<OwnerAccessShopDto | null>(null);
  const [email, setEmail] = useState("");
  const [preview, setPreview] = useState<OwnerAccessPreviewDto | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [working, setWorking] = useState(false);
  const [audit, setAudit] = useState<OwnerAccessAuditPageDto["items"]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("shop");
    if (!id) return;
    let active = true;
    void apiFetch<OwnerAccessShopDto>(`${BASE}/${encodeURIComponent(id)}`)
      .then((shop) => {
        if (active) setSelected(shop);
      })
      .catch((failure: unknown) => {
        if (active) setError(message(failure));
      });
    return () => {
      active = false;
    };
  }, []);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const results = await apiFetch<OwnerAccessShopDto[]>(
        `${BASE}?query=${encodeURIComponent(query.trim())}`,
      );
      setShops(results);
      if (!results.length)
        setNotice(
          "No shops matched. Search by full shop ID, public ID, or name and confirm the exact shop before changing access.",
        );
    } catch (failure) {
      setError(message(failure));
    } finally {
      setWorking(false);
    }
  }

  async function checkAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    try {
      const result = await apiFetch<OwnerAccessPreviewDto>(`${BASE}/preview`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setPreview(result);
      setConfirmed(false);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setWorking(false);
    }
  }

  async function changeOwner() {
    if (!selected || !preview || preview.action === "UNAVAILABLE") return;
    const replacement = selected.owner.id !== preview.account?.id;
    const removesExtraRoles = selected.extraOwnerRoleCount > 0;
    if ((replacement || removesExtraRoles) && !confirmed) {
      setError(
        "Confirm the owner change and removal of any extra shop-owner roles.",
      );
      return;
    }
    if (reason.trim().length < 10) {
      setError("Provide an audit reason of at least 10 characters.");
      return;
    }
    const verb =
      preview.action === "ASSIGN_VERIFIED"
        ? "assign this verified account"
        : "send a single-use email invitation";
    if (
      !window.confirm(
        `For ${selected.name} (${selected.publicId}), ${verb}? ${replacement ? "The current owner will lose this shop's owner access only after the assignment is completed." : removesExtraRoles ? "Extra owner roles for this shop will be removed; other shops remain unaffected." : "This will repair or confirm the existing owner's access."}`,
      )
    )
      return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const path =
        preview.action === "ASSIGN_VERIFIED" ? "assign" : "invitations";
      const result = await apiFetch<OwnerAccessMutationResultDto>(
        `${BASE}/${selected.id}/${path}`,
        {
          method: "POST",
          body: JSON.stringify({
            email: preview.email,
            expectedOwnerUserId: selected.owner.id,
            reason: reason.trim(),
            transferConfirmed: confirmed,
            totpCode,
          }),
        },
      );
      setSelected(result.shop);
      setAudit([]);
      setAuditLoaded(false);
      setAuditCursor(null);
      setPreview(null);
      setConfirmed(false);
      setTotpCode("");
      setNotice(
        result.outcome === "INVITATION_SENT"
          ? "Invitation accepted by the email provider. Owner access remains unchanged until the recipient accepts."
          : result.outcome === "INVITATION_CREATED"
            ? "Invitation recorded for local testing. No email was delivered."
            : result.outcome === "ALREADY_MAPPED"
              ? "This account already owns this shop."
              : "Owner access updated. The new owner must sign in again; previous shop access has been removed.",
      );
    } catch (failure) {
      setError(message(failure));
    } finally {
      setWorking(false);
    }
  }

  async function revokeInvitation() {
    if (
      !selected?.invitation ||
      !window.confirm(
        "Revoke this pending owner invitation? Its link will stop working.",
      )
    )
      return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const next = await apiFetch<OwnerAccessShopDto>(
        `${BASE}/${selected.id}/invitations/${selected.invitation.id}/revoke`,
        { method: "POST" },
      );
      setSelected(next);
      setNotice("Invitation revoked.");
      setAudit([]);
      setAuditLoaded(false);
      setAuditCursor(null);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setWorking(false);
    }
  }

  async function loadAudit(cursor?: string) {
    if (!selected) return;
    setWorking(true);
    setError(null);
    try {
      const page = await apiFetch<OwnerAccessAuditPageDto>(
        `${BASE}/${selected.id}/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      setAudit((items) => (cursor ? [...items, ...page.items] : page.items));
      setAuditCursor(page.nextCursor);
      setAuditLoaded(true);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setWorking(false);
    }
  }

  const replacing =
    !!selected && !!preview && selected.owner.id !== preview.account?.id;
  const requiresConfirmation = replacing || !!selected?.extraOwnerRoleCount;
  const canSubmit =
    !!selected &&
    !!preview &&
    preview.action !== "UNAVAILABLE" &&
    reason.trim().length >= 10 &&
    /^\d{6}$/.test(totpCode) &&
    (!requiresConfirmation || confirmed);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Super Admin · Shops</p>
          <h1>Manage Owner Access</h1>
          <p>
            Link a shop to its verified owner account. An invitation changes
            access only after the recipient accepts.
          </p>
        </div>
        <LinkButton href="/dashboard/admin" variant="outline">
          Platform operations
        </LinkButton>
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      <section className={styles.panel} aria-labelledby="owner-shop-search">
        <h2 id="owner-shop-search">Find the exact shop</h2>
        <form
          className={styles.inlineForm}
          onSubmit={(event) => void search(event)}
        >
          <label htmlFor="shop-query">
            Shop name, internal ID or public shop ID
          </label>
          <div>
            <input
              id="shop-query"
              type="search"
              minLength={2}
              maxLength={100}
              required
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search shops"
            />
            <Button type="submit" disabled={working}>
              Search
            </Button>
          </div>
        </form>
        {shops.length > 0 && (
          <ul className={styles.results}>
            {shops.map((shop) => (
              <li key={shop.id}>
                <div>
                  <strong>{shop.name}</strong>
                  <small>
                    {shop.publicId} · {shop.location} · {shop.status}
                  </small>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelected(shop);
                    setPreview(null);
                    setEmail("");
                    setConfirmed(false);
                    setNotice(null);
                    setAudit([]);
                    setAuditLoaded(false);
                    setAuditCursor(null);
                  }}
                >
                  Review shop
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <section className={styles.panel} aria-labelledby="selected-shop">
          <h2 id="selected-shop">{selected.name}</h2>
          <p className={styles.identity}>
            Public ID {selected.publicId} · Internal ID {selected.id} ·{" "}
            {selected.location} · {selected.status}
          </p>
          <dl className={styles.details}>
            <div>
              <dt>Current canonical owner</dt>
              <dd>
                {selected.owner.email ?? "No account email"} ·{" "}
                {selected.owner.status}
              </dd>
            </div>
            <div>
              <dt>Email verified</dt>
              <dd>{selected.owner.emailVerified ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Shop owner role</dt>
              <dd>
                {selected.owner.hasOwnerRole
                  ? "Present"
                  : "Missing — role repair available"}
              </dd>
            </div>
            <div>
              <dt>Other owner roles</dt>
              <dd>{selected.extraOwnerRoleCount} · review before transfer</dd>
            </div>
          </dl>
          {!selected.owner.emailVerified && (
            <p className={styles.warning}>
              The current owner account has no verified email. It may be an
              onboarding placeholder, but any replacement still requires a
              confirmed transfer.
            </p>
          )}
          {selected.invitation && (
            <div className={styles.invitation}>
              <div>
                <strong>Invitation: {selected.invitation.status}</strong>
                <small>
                  {selected.invitation.email} · expires{" "}
                  {new Date(selected.invitation.expiresAt).toLocaleString()}
                </small>
                <small>Resending a new invitation invalidates this link.</small>
              </div>
              {selected.invitation.status === "PENDING" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={working}
                  onClick={() => void revokeInvitation()}
                >
                  Revoke
                </Button>
              )}
            </div>
          )}

          <form
            className={styles.inlineForm}
            onSubmit={(event) => void checkAccount(event)}
          >
            <label htmlFor="owner-email">Proposed owner email</label>
            <div>
              <input
                id="owner-email"
                type="email"
                required
                maxLength={320}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setPreview(null);
                }}
                placeholder="owner@example.com"
                autoComplete="off"
              />
              <Button type="submit" variant="outline" disabled={working}>
                Check account
              </Button>
            </div>
          </form>
          {preview && (
            <div className={styles.preview}>
              <h3>Review proposed access</h3>
              <p>
                {preview.email} ·{" "}
                {preview.action === "ASSIGN_VERIFIED"
                  ? "Active, verified account — can be assigned now"
                  : preview.action === "INVITE_EXISTING"
                    ? "Existing account — must sign in and verify the invitation"
                    : preview.action === "INVITE_NEW"
                      ? "New account — must accept a single-use email invitation"
                      : "Account suspended or unavailable — cannot assign"}
              </p>
              {replacing ? (
                <p className={styles.warning}>
                  <strong>Ownership transfer:</strong>{" "}
                  {selected.owner.email ?? selected.owner.id} → {preview.email}.
                  The prior owner loses access to this shop after completion;
                  other shops remain theirs.
                </p>
              ) : selected.extraOwnerRoleCount > 0 ? (
                <p className={styles.warning}>
                  The canonical owner is unchanged, but{" "}
                  {selected.extraOwnerRoleCount} extra shop-owner role(s) will
                  be removed from this shop. Other shops remain unaffected.
                </p>
              ) : (
                <p className={styles.notice}>
                  Current canonical owner selected. Any missing scoped role will
                  be repaired.
                </p>
              )}
              <label className={styles.stack} htmlFor="owner-reason">
                Audit reason
                <textarea
                  id="owner-reason"
                  minLength={10}
                  maxLength={1000}
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why is this owner assignment authorized?"
                />
              </label>
              <label className={styles.stack} htmlFor="owner-totp">
                Current authenticator code
                <input
                  id="owner-totp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={totpCode}
                  onChange={(event) =>
                    setTotpCode(event.target.value.replace(/\D/g, ""))
                  }
                />
              </label>
              {requiresConfirmation && (
                <label className={styles.confirm}>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />{" "}
                  I reviewed the current and proposed owners and confirm this
                  access change, including removal of extra roles for this shop.
                </label>
              )}
              <Button
                type="button"
                disabled={working || !canSubmit}
                onClick={() => void changeOwner()}
              >
                {working
                  ? "Working…"
                  : preview.action === "ASSIGN_VERIFIED"
                    ? replacing
                      ? "Confirm transfer"
                      : "Repair owner access"
                    : "Send owner invitation"}
              </Button>
            </div>
          )}
          <div className={styles.audit}>
            <h3>Owner access audit history</h3>
            {!auditLoaded && (
              <Button
                type="button"
                variant="outline"
                disabled={working}
                onClick={() => void loadAudit()}
              >
                Load history
              </Button>
            )}
            {auditLoaded && audit.length === 0 && (
              <p>No owner access changes recorded for this shop.</p>
            )}
            {audit.length > 0 && (
              <ol>
                {audit.map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.action.replace(/_/g, " ")}</strong> ·{" "}
                    {new Date(entry.createdAt).toLocaleString()}
                    <small>
                      Actor {entry.actorUserId ?? "System"} ·{" "}
                      {entry.beforeOwnerUserId ?? "—"} →{" "}
                      {entry.afterOwnerUserId ?? "—"}
                    </small>
                    {entry.reason && <p>{entry.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
            {auditCursor && (
              <Button
                type="button"
                variant="outline"
                disabled={working}
                onClick={() => void loadAudit(auditCursor)}
              >
                Load more
              </Button>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
