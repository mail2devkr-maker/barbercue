import type { OperatingHoursDto } from '@barbercue/shared';

// Params are carried forward step-to-step rather than re-fetched, since the customer already
// loaded them on the salon profile screen — same data-flow shape as apps/web's BookingFlow.
export type RootStackParamList = {
  Account: undefined;
  SalonSearch: undefined;
  SalonProfile: { citySlug: string; salonSlug: string };
  StaffSelect: {
    salonId: string;
    salonName: string;
    serviceId: string;
    serviceName: string;
    servicePrice: number;
    serviceDurationMinutes: number;
    operatingHours: OperatingHoursDto[];
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
  };
  MyBookings: undefined;
  BookingDetail: { bookingId: string };
};
