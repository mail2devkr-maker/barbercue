import type { NavigatorScreenParams } from '@react-navigation/native';
import type { OperatingHoursDto, ServiceDto } from '@barbercue/shared';

// Params are carried forward step-to-step rather than re-fetched, since the customer already
// loaded them on the salon profile screen — same data-flow shape as apps/web's BookingFlow.
export type SearchStackParamList = {
  // initialQuery/initialLat/initialLng let Home's search card and Popular Services chips hand off
  // a query (and, when the customer's location is already known, coordinates) into this screen's
  // own search state without duplicating the search engine itself — SalonSearchScreen still owns
  // `q`/`nearMe` and the one real request to DISCOVERY_PATHS.salons.
  SalonSearch: { selectedStyleName?: string; initialQuery?: string; initialLat?: number; initialLng?: number } | undefined;
  SalonProfile: {
    countryCode: string;
    citySlug: string;
    salonSlug: string;
    selectedStyleName?: string;
  };
  StaffSelect: {
    salonId: string;
    salonName: string;
    serviceId: string;
    serviceName: string;
    servicePrice: number;
    serviceDurationMinutes: number;
    operatingHours: OperatingHoursDto[];
    // Pre-confirmation timezone fix — the salon's resolved IANA zone (SalonProfileDto.
    // salonTimezone), carried forward step-to-step the same way operatingHours already is, so
    // every date/slot render from here through ConfirmBooking uses the salon's own local time
    // rather than the device's. Null degrades to the device zone, same convention as elsewhere.
    salonTimezone: string | null;
    selectedStyleName?: string;
  };
  DateSelect: {
    salonId: string;
    salonName: string;
    serviceId: string;
    serviceName: string;
    servicePrice: number;
    serviceDurationMinutes: number;
    operatingHours: OperatingHoursDto[];
    salonTimezone: string | null;
    preferredStaffId: string | null;
    preferredStaffName: string | null;
    selectedStyleName?: string;
  };
  SlotSelect: {
    salonId: string;
    salonName: string;
    serviceId: string;
    serviceName: string;
    servicePrice: number;
    salonTimezone: string | null;
    preferredStaffId: string | null;
    preferredStaffName: string | null;
    date: string;
    selectedStyleName?: string;
  };
  ConfirmBooking: {
    salonId: string;
    salonName: string;
    serviceId: string;
    serviceName: string;
    servicePrice: number;
    salonTimezone: string | null;
    preferredStaffId: string | null;
    preferredStaffName: string | null;
    slotStart: string;
    slotEnd: string;
    selectedStyleName?: string;
  };
  WalkInJoin: { salonId: string; salonName: string; services: ServiceDto[] };
};

export type HomeStackParamList = {
  Home: undefined;
  StyleAdvisor: undefined;
};

export type BookingsStackParamList = {
  MyBookings: undefined;
  BookingDetail: { bookingId: string };
};

export type QueueStackParamList = {
  QueueHome: undefined;
};

export type AccountStackParamList = {
  Account: undefined;
  StyleAdvisor: undefined;
  Notifications: undefined;
  CreditsHistory: undefined;
};

// Bottom-tab level — each tab owns its own native stack. NavigatorScreenParams lets a caller
// jump into a specific screen of another tab's stack (e.g. Home's "Find a salon" CTA opening
// SearchTab directly at SalonSearch) with full type-checking on the nested params.
export type TabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  SearchTab: NavigatorScreenParams<SearchStackParamList>;
  BookingsTab: NavigatorScreenParams<BookingsStackParamList>;
  QueueTab: NavigatorScreenParams<QueueStackParamList>;
  AccountTab: NavigatorScreenParams<AccountStackParamList>;
};
