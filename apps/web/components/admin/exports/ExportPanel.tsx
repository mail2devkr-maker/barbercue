"use client";

import { useState } from "react";
import { hasAdminPermission, type AdminPermission } from "@barbercue/shared";
import { apiFetchBlob, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { Icon } from "../../owner/icons";
import ui from "../../owner/owner.module.css";
import { downloadBlob } from "../charts/export";
import css from "./export-panel.module.css";

export interface ExportOption {
  id: string;
  label: string;
  description: string;
  path: string;
  permission: AdminPermission;
  /** Contains personal contact data: needs an explicit confirmation before download. */
  personal?: boolean;
}

/**
 * Server-generated exports. A button is shown only to roles that hold its permission, but the
 * server is what decides: each export is a separate route with its own role check, and every
 * download (or failed attempt) is written to the audit log with the requester.
 */
export function ExportPanel({ id, title, options, from, to }: { id?: string; title: string; options: ExportOption[]; from: string; to: string }) {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const allowed = options.filter((o) => hasAdminPermission(roles, o.permission));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function download(option: ExportOption) {
    setBusy(option.id);
    setMessage(null);
    try {
      const { blob, filename } = await apiFetchBlob(`${option.path}?${new URLSearchParams({ from, to })}`);
      downloadBlob(blob, filename ?? `${option.id}-${from}-to-${to}.csv`);
      setMessage({ ok: true, text: `${option.label} downloaded. This download is recorded in the audit log.` });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof ApiError ? error.message : "The export could not be created." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={ui.card} aria-labelledby={`${id ?? "exports"}-title`} id={id}>
      <div className={ui.cardHead}>
        <div>
          <h2 id={`${id ?? "exports"}-title`} className={ui.cardTitle}>{title}</h2>
          <p className={ui.cardSub}>Files are generated on the server for the selected period. Every download is logged with your account.</p>
        </div>
      </div>
      {allowed.length === 0 ? (
        <p className={ui.empty}>Your role cannot download these files.</p>
      ) : (
        <div className={css.options}>
          {allowed.map((option) => {
            const needsConfirm = Boolean(option.personal) && !confirmed;
            return (
              <div key={option.id} className={`${css.option} ${option.personal ? css.personal : ""}`}>
                <div>
                  <div className={css.label}>
                    {option.label}
                    {option.personal && <span className={`${ui.badge} ${ui.badgeWarn}`}>Personal data</span>}
                  </div>
                  <p className={css.description}>{option.description}</p>
                </div>
                <button
                  type="button"
                  className={`${ui.btn} ${option.personal ? ui.btnSecondary : ui.btnPrimary} ${ui.btnSm}`}
                  disabled={busy !== null || needsConfirm}
                  onClick={() => void download(option)}
                >
                  <Icon name="download" size={16} /> {busy === option.id ? "Preparing…" : "Download CSV"}
                </button>
              </div>
            );
          })}
          {allowed.some((o) => o.personal) && (
            <label className={css.confirm}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I need these contact details for an authorised FastQue purpose, will store them securely and will not share them.
            </label>
          )}
        </div>
      )}
      {message && (
        <p className={`${ui.banner} ${message.ok ? ui.bannerOk : ui.bannerError}`} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      )}
    </section>
  );
}
