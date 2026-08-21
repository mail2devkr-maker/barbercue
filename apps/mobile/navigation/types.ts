import type { OperatingHoursDto, ServiceDto } from '@barbercue/shared';

// Params are carried forward step-to-step rather than re-fetched, since the customer already
// loaded them on the salon profile screen — same data-flow shape as apps/web's BookingFlow.
export type RootStackParamList = {
  Account: undefined;
  StyleAdvisor: undefined;
  // selectedStyleName is present only when arriving via the AI Style Advisor's "Try This Look" —
  // threaded through every step below the same way preferredStaffId already is, and included in
  // ConfirmBookingScreen's POST /bookings body when set.
  SalonSearch: { selectedStyleName?: string } | undefined;
  SalonProfile: { citySlug: string; salonSlug: string; selectedStyleName?: string };
  StaffSelect: {
    salonId: string;
    salonName: string;
    serviceId: string;
    serviceName: string;
    servicePrice: number;
    serviceDurationMinutes: number;
    operatingHours: OperatingHoursDto[];
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
    preferredStaffId: string | null;
    preferredStaffName: string | null;
    slotStart: string;
    slotEnd: string;
    selectedStyleName?: string;
  };
  MyBookings: undefined;
  BookingDetail: { bookingId: string };
  WalkInJoin: { salonId: string; salonName: string; services: ServiceDto[] };
};
