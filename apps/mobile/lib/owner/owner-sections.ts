import type { UiStrings } from '@barbercue/shared';

/** Keys of UiStrings whose value is plain text (some strings are functions or lists). */
type TextKey = { [K in keyof UiStrings]: UiStrings[K] extends string ? K : never }[keyof UiStrings];

/**
 * The owner's shop-management sections — the same 13 the website's OwnerShopNav shows, in the same
 * order, so the two products can be compared line by line. Each maps to the native place that
 * handles it: either one of the existing owner tabs, or a screen inside the Shop tab's stack.
 */
export type OwnerSectionId =
  | 'queue'
  | 'settings'
  | 'bookings'
  | 'schedule'
  | 'customers'
  | 'analytics'
  | 'reviews'
  | 'verification'
  | 'services'
  | 'hours'
  | 'photos'
  | 'chairs'
  | 'staff';

export type OwnerSectionTarget =
  | { kind: 'tab'; tab: 'OwnerQueueTab' | 'OwnerBookingsTab' }
  | {
      kind: 'screen';
      screen:
        | 'OwnerSettings'
        | 'OwnerSchedule'
        | 'OwnerCustomers'
        | 'OwnerAnalytics'
        | 'OwnerReviews'
        | 'OwnerVerification'
        | 'OwnerServices'
        | 'OwnerHours'
        | 'OwnerPhotos'
        | 'OwnerChairs'
        | 'OwnerStaff';
    };

export interface OwnerSection {
  id: OwnerSectionId;
  labelKey: TextKey;
  hintKey: TextKey;
  target: OwnerSectionTarget;
}

export const OWNER_SECTIONS: readonly OwnerSection[] = [
  { id: 'queue', labelKey: 'ownerSectionQueue', hintKey: 'ownerSectionQueueHint', target: { kind: 'tab', tab: 'OwnerQueueTab' } },
  { id: 'settings', labelKey: 'ownerSectionSettings', hintKey: 'ownerSectionSettingsHint', target: { kind: 'screen', screen: 'OwnerSettings' } },
  { id: 'bookings', labelKey: 'ownerSectionBookings', hintKey: 'ownerSectionBookingsHint', target: { kind: 'tab', tab: 'OwnerBookingsTab' } },
  { id: 'schedule', labelKey: 'ownerSectionSchedule', hintKey: 'ownerSectionScheduleHint', target: { kind: 'screen', screen: 'OwnerSchedule' } },
  { id: 'customers', labelKey: 'ownerSectionCustomers', hintKey: 'ownerSectionCustomersHint', target: { kind: 'screen', screen: 'OwnerCustomers' } },
  { id: 'analytics', labelKey: 'ownerSectionAnalytics', hintKey: 'ownerSectionAnalyticsHint', target: { kind: 'screen', screen: 'OwnerAnalytics' } },
  { id: 'reviews', labelKey: 'ownerSectionReviews', hintKey: 'ownerSectionReviewsHint', target: { kind: 'screen', screen: 'OwnerReviews' } },
  { id: 'verification', labelKey: 'ownerSectionVerification', hintKey: 'ownerSectionVerificationHint', target: { kind: 'screen', screen: 'OwnerVerification' } },
  { id: 'services', labelKey: 'ownerSectionServices', hintKey: 'ownerSectionServicesHint', target: { kind: 'screen', screen: 'OwnerServices' } },
  { id: 'hours', labelKey: 'ownerSectionHours', hintKey: 'ownerSectionHoursHint', target: { kind: 'screen', screen: 'OwnerHours' } },
  { id: 'photos', labelKey: 'ownerSectionPhotos', hintKey: 'ownerSectionPhotosHint', target: { kind: 'screen', screen: 'OwnerPhotos' } },
  { id: 'chairs', labelKey: 'ownerSectionChairs', hintKey: 'ownerSectionChairsHint', target: { kind: 'screen', screen: 'OwnerChairs' } },
  { id: 'staff', labelKey: 'ownerSectionStaff', hintKey: 'ownerSectionStaffHint', target: { kind: 'screen', screen: 'OwnerStaff' } },
];

/** The website's section ids, in order — the parity test compares against this. */
export const WEBSITE_SECTION_IDS: readonly OwnerSectionId[] = [
  'queue',
  'settings',
  'bookings',
  'schedule',
  'customers',
  'analytics',
  'reviews',
  'verification',
  'services',
  'hours',
  'photos',
  'chairs',
  'staff',
];
