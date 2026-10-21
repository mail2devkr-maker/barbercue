/**
 * HR Offer Register — web-side types.
 *
 * The contract now comes from `@barbercue/shared` (packages/shared/src/hr-register.ts), the same file the
 * backend (apps/backend/src/hr-register) validates against. This module only re-exports it under the names the
 * UI already uses and adds the two shapes that exist only in the browser (filter state, manager picker option).
 *
 * Invariants the UI relies on (issue #283):
 *  - one permanent `FQ-FE-xxxxx` employee code per person, allocated by the server on the first persisted offer,
 *    never typed by HR, never reused for a second person;
 *  - offer versions and employment episodes are append-only; the UI never edits history;
 *  - offer status and employment status are separate axes;
 *  - all timestamps are ISO-8601 UTC strings, calendar dates are `YYYY-MM-DD`.
 */
export {
  EMPLOYEE_CODE_PATTERN,
  HR_EPISODE_STATUSES as EPISODE_STATUSES,
  HR_MATCH_REASONS as MATCH_REASONS,
  HR_OFFER_STATUSES as OFFER_STATUSES,
} from "@barbercue/shared";

export type {
  HrActorRef,
  HrAuditEntry,
  HrAuditPage,
  HrCreateOfferInput,
  HrCreateOfferResult,
  HrEmploymentEpisode,
  HrEpisodeStatus,
  HrIdentityInput,
  HrLetterData,
  HrLifecycleFilter,
  HrManagerHistoryEntry,
  HrManagerRef,
  HrMatchCandidate,
  HrMatchQuery,
  HrMatchReason,
  HrMatchResult,
  HrOfferDelivery,
  HrOfferKind,
  HrOfferStatus,
  HrOfferTerms,
  HrOfferTermsInput,
  HrOfferTransition,
  HrOfferVersion,
  HrPdfEvent,
  HrPersonDetail,
  HrPersonSummary,
  HrReconciliationItem,
  HrReconciliationPage,
  HrReconciliationStatus,
  HrRegisterPage,
  HrSalaryHistoryEntry,
} from "@barbercue/shared";

import type { HrLifecycleFilter, HrOfferStatus } from "@barbercue/shared";

export type HrRegisterFilters = {
  q: string;
  employeeCode: string;
  lifecycle: HrLifecycleFilter;
  offerStatus: HrOfferStatus | "ALL";
  city: string;
  managerId: string;
  issuedFrom: string;
  issuedTo: string;
};

export type HrEmployeeOption = {
  id: string;
  fullName: string;
  employeeCode: string;
};
