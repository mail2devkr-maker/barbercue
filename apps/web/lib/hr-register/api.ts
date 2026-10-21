import { apiFetch } from "../api";
import { newIdempotencyKey } from "../idempotency";
import type {
  HrAuditPage,
  HrCreateOfferInput,
  HrCreateOfferResult,
  HrEmployeeOption,
  HrMatchQuery,
  HrMatchResult,
  HrOfferTransition,
  HrOfferVersion,
  HrPdfEvent,
  HrPersonDetail,
  HrReconciliationItem,
  HrReconciliationPage,
  HrReconciliationStatus,
  HrRegisterFilters,
  HrRegisterPage,
} from "./types";

/**
 * Every mutation takes an explicit idempotency key. The caller creates the key once per user action
 * and reuses it for retries and double clicks, so one action can never create two records.
 *
 * PROPOSED endpoints (issue #283); see types.ts. All paths live here so adopting Codex's published
 * contract is a one-file change.
 */
export const HR_PATHS = {
  base: "admin/hr",
  register: "admin/hr/register",
  matches: "admin/hr/identity/matches",
  offers: "admin/hr/offers",
  persons: "admin/hr/persons",
  episodes: "admin/hr/episodes",
  reconciliation: "admin/hr/reconciliation",
  employees: "admin/employees",
} as const;

export type HrJoiningInput = {
  joinedOn: string;
  territory?: string;
  temporaryPassword: string;
};

export type HrNotJoinedInput = { decidedOn: string; reason: string };
export type HrExitInput = { exitedOn: string; reason: string };

export interface HrRegisterApi {
  probe(): Promise<void>;
  search(filters: HrRegisterFilters, cursor?: string | null): Promise<HrRegisterPage>;
  getPerson(personId: string): Promise<HrPersonDetail>;
  matchIdentity(query: HrMatchQuery): Promise<HrMatchResult>;
  createOffer(input: HrCreateOfferInput, idempotencyKey: string): Promise<HrCreateOfferResult>;
  transitionOffer(offerId: string, to: HrOfferTransition, reason: string | null, idempotencyKey: string): Promise<HrOfferVersion>;
  recordJoining(offerId: string, input: HrJoiningInput, idempotencyKey: string): Promise<HrPersonDetail>;
  recordNotJoined(offerId: string, input: HrNotJoinedInput, idempotencyKey: string): Promise<HrPersonDetail>;
  recordExit(episodeId: string, input: HrExitInput, idempotencyKey: string): Promise<HrPersonDetail>;
  recordPdfEvent(offerId: string, input: { event: HrPdfEvent["event"]; sha256: string; byteLength: number }, idempotencyKey: string): Promise<HrPdfEvent>;
  /** Contact values for one saved version, needed only to regenerate that version's letter. */
  getLetterData(offerId: string): Promise<HrCreateOfferResult["letter"]>;
  listAudit(personId: string, cursor?: string | null): Promise<HrAuditPage>;
  listReconciliation(status: HrReconciliationStatus | "ALL", cursor?: string | null): Promise<HrReconciliationPage>;
  linkReconciliation(itemId: string, personId: string, idempotencyKey: string): Promise<HrReconciliationItem>;
  markReconciliationDuplicate(itemId: string, duplicateOfItemId: string, idempotencyKey: string): Promise<HrReconciliationItem>;
  createReconciliationIdentity(itemId: string, historyChecked: true, idempotencyKey: string): Promise<HrReconciliationItem>;
  listManagers(): Promise<HrEmployeeOption[]>;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function post<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

export const httpHrRegisterApi: HrRegisterApi = {
  async probe() {
    await apiFetch<HrRegisterPage>(`${HR_PATHS.register}${qs({ limit: 1 })}`);
  },

  search(filters, cursor) {
    return apiFetch<HrRegisterPage>(
      `${HR_PATHS.register}${qs({
        q: filters.q.trim(),
        employeeCode: filters.employeeCode.trim(),
        lifecycle: filters.lifecycle === "ALL" ? null : filters.lifecycle,
        offerStatus: filters.offerStatus === "ALL" ? null : filters.offerStatus,
        city: filters.city.trim(),
        managerId: filters.managerId,
        issuedFrom: filters.issuedFrom,
        issuedTo: filters.issuedTo,
        cursor,
        limit: 25,
      })}`,
    );
  },

  getPerson(personId) {
    return apiFetch<HrPersonDetail>(`${HR_PATHS.persons}/${encodeURIComponent(personId)}`);
  },

  matchIdentity(query) {
    // POST so contact values never appear in a URL, a proxy log or browser history.
    return apiFetch<HrMatchResult>(HR_PATHS.matches, { method: "POST", body: JSON.stringify(query) });
  },

  createOffer(input, idempotencyKey) {
    return post<HrCreateOfferResult>(HR_PATHS.offers, input, idempotencyKey);
  },

  transitionOffer(offerId, to, reason, idempotencyKey) {
    return post<HrOfferVersion>(`${HR_PATHS.offers}/${encodeURIComponent(offerId)}/status`, { to, reason }, idempotencyKey);
  },

  recordJoining(offerId, input, idempotencyKey) {
    return post<HrPersonDetail>(`${HR_PATHS.offers}/${encodeURIComponent(offerId)}/joining`, input, idempotencyKey);
  },

  recordNotJoined(offerId, input, idempotencyKey) {
    return post<HrPersonDetail>(`${HR_PATHS.offers}/${encodeURIComponent(offerId)}/not-joined`, input, idempotencyKey);
  },

  recordExit(episodeId, input, idempotencyKey) {
    return post<HrPersonDetail>(`${HR_PATHS.episodes}/${encodeURIComponent(episodeId)}/exit`, input, idempotencyKey);
  },

  recordPdfEvent(offerId, input, idempotencyKey) {
    return post<HrPdfEvent>(`${HR_PATHS.offers}/${encodeURIComponent(offerId)}/pdf-events`, input, idempotencyKey);
  },

  getLetterData(offerId) {
    return apiFetch<HrCreateOfferResult["letter"]>(`${HR_PATHS.offers}/${encodeURIComponent(offerId)}/letter-data`);
  },

  listAudit(personId, cursor) {
    return apiFetch<HrAuditPage>(`${HR_PATHS.persons}/${encodeURIComponent(personId)}/audit${qs({ cursor, limit: 25 })}`);
  },

  listReconciliation(status, cursor) {
    return apiFetch<HrReconciliationPage>(
      `${HR_PATHS.reconciliation}${qs({ status: status === "ALL" ? null : status, cursor, limit: 25 })}`,
    );
  },

  linkReconciliation(itemId, personId, idempotencyKey) {
    return post<HrReconciliationItem>(`${HR_PATHS.reconciliation}/${encodeURIComponent(itemId)}/link`, { personId }, idempotencyKey);
  },

  markReconciliationDuplicate(itemId, duplicateOfItemId, idempotencyKey) {
    return post<HrReconciliationItem>(`${HR_PATHS.reconciliation}/${encodeURIComponent(itemId)}/duplicate`, { duplicateOfItemId }, idempotencyKey);
  },

  createReconciliationIdentity(itemId, historyChecked, idempotencyKey) {
    return post<HrReconciliationItem>(`${HR_PATHS.reconciliation}/${encodeURIComponent(itemId)}/create-identity`, { historyChecked }, idempotencyKey);
  },

  async listManagers() {
    // Existing, already-deployed endpoint: active employee accounts can be reporting managers.
    const rows = await apiFetch<Array<{ id: string; fullName: string; employeeCode: string; status: string }>>(HR_PATHS.employees);
    return rows
      .filter((row) => row.status === "ACTIVE")
      .map((row) => ({ id: row.id, fullName: row.fullName, employeeCode: row.employeeCode }));
  },
};

export { newIdempotencyKey };
