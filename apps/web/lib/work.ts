"use client";

import {
  formatPaise,
  WORK_PATHS,
  type WorkAssignmentStatus,
  type WorkJobStatus,
  type WorkOrgStatus,
  type WorkPayoutStatus,
  type WorkPayType,
} from "@barbercue/shared";
import { ApiError, apiFetch } from "./api";
import { newIdempotencyKey } from "./idempotency";

/** FastQue Work client helpers. The backend is the authority for every rule; nothing here decides money. */
export const W = WORK_PATHS.root;

export function workGet<T>(path: string): Promise<T> {
  return apiFetch<T>(`${W}/${path}`);
}

export function workSend<T>(path: string, body?: unknown, method: "POST" | "PUT" = "POST", idempotent = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (idempotent) headers["Idempotency-Key"] = newIdempotencyKey();
  return apiFetch<T>(`${W}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

export function workUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<T>(`${W}/${path}`, { method: "POST", body: form });
}

export function errorText(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiError) {
    const issues = (err.details as { issues?: { path: string; message: string }[] } | undefined)?.issues;
    if (issues?.length) return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join(" · ");
    return err.message || fallback;
  }
  return fallback;
}

export const money = formatPaise;

export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function timeRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sameDay = s.toDateString() === e.toDateString();
  const t = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return sameDay ? `${when(startIso)} – ${t(e)}` : `${when(startIso)} – ${when(endIso)}`;
}

export function hoursBetween(startIso: string, endIso: string): string {
  const h = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;
  return h < 1 ? `${Math.round(h * 60)} min` : `${Math.round(h * 10) / 10} h`;
}

export const PAY_TYPE_LABEL: Record<WorkPayType, string> = {
  FIXED: "fixed pay",
  PER_TASK: "per completed task",
  HOURLY: "for the shift (hourly rate)",
  DAILY: "for the day",
};

type Tone = "green" | "amber" | "red" | "navy" | "grey";

export const ASSIGNMENT_STATUS: Record<WorkAssignmentStatus, { label: string; tone: Tone }> = {
  ACCEPTED: { label: "Confirmed", tone: "navy" },
  CHECKED_IN: { label: "Checked in", tone: "navy" },
  SUBMITTED: { label: "Awaiting review", tone: "amber" },
  REWORK_REQUESTED: { label: "Changes requested", tone: "amber" },
  DISPUTED: { label: "In dispute", tone: "red" },
  PAYABLE: { label: "Approved — payout pending", tone: "green" },
  PAID: { label: "Paid", tone: "green" },
  NO_SHOW_REVIEW: { label: "No-show reported", tone: "red" },
  WITHDRAWN: { label: "Withdrawn", tone: "grey" },
  CANCELLED: { label: "Cancelled", tone: "grey" },
  CLOSED_UNPAID: { label: "Closed, unpaid", tone: "grey" },
};

export const JOB_STATUS: Record<WorkJobStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "grey" },
  PENDING_VERIFICATION: { label: "In moderation", tone: "amber" },
  FUNDING_REQUIRED: { label: "Awaiting funding", tone: "amber" },
  OPEN: { label: "Open", tone: "green" },
  PARTIALLY_FILLED: { label: "Filling", tone: "green" },
  FILLED: { label: "Filled", tone: "navy" },
  IN_PROGRESS: { label: "In progress", tone: "navy" },
  COMPLETED: { label: "Completed", tone: "navy" },
  CLOSED: { label: "Closed", tone: "grey" },
  PAUSED: { label: "Paused", tone: "amber" },
  CANCELLED: { label: "Cancelled", tone: "grey" },
  EXPIRED: { label: "Expired", tone: "grey" },
  REJECTED: { label: "Rejected", tone: "red" },
};

export const ORG_STATUS: Record<WorkOrgStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Not submitted", tone: "grey" },
  SUBMITTED: { label: "Submitted for verification", tone: "amber" },
  UNDER_REVIEW: { label: "Under review", tone: "amber" },
  VERIFIED: { label: "Verified", tone: "green" },
  REJECTED: { label: "Changes needed", tone: "red" },
  SUSPENDED: { label: "Suspended", tone: "red" },
};

export const PAYOUT_STATUS: Record<WorkPayoutStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Waiting to send", tone: "amber" },
  PROCESSING: { label: "Sent to bank", tone: "navy" },
  SUCCEEDED: { label: "Paid", tone: "green" },
  FAILED: { label: "Failed — will be retried", tone: "red" },
};
