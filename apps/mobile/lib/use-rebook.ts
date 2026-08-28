import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { DISCOVERY_PATHS } from '@barbercue/shared';
import type { BookingDetailDto, SalonProfileDto } from '@barbercue/shared';
import { apiFetch, ApiError } from './api';
import type { TabParamList } from '../navigation/types';

/**
 * "Book again" hand-off shared by MyBookingsScreen (the list) and BookingDetailScreen — the
 * DateSelect screen needs operatingHours, which BookingDetailDto doesn't carry (unlike
 * service/staff, already known from the past booking), so the full salon profile is fetched once
 * here rather than duplicating that data onto every booking DTO for a rarely-used action. Lands on
 * DateSelect, not ConfirmBooking — the customer still explicitly picks a new date/time, never
 * assuming the old slot is still available.
 */
export function useRebook() {
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const [rebookingId, setRebookingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rebook(booking: BookingDetailDto) {
    setRebookingId(booking.id);
    setError(null);
    try {
      const salon = await apiFetch<SalonProfileDto>(
        `${DISCOVERY_PATHS.salons}/${booking.salonCountryCode}/${booking.citySlug}/${booking.salonSlug}`,
      );
      navigation.navigate('SearchTab', {
        screen: 'DateSelect',
        params: {
          salonId: booking.salonId,
          salonName: booking.salonName,
          serviceId: booking.serviceId,
          serviceName: booking.serviceName,
          servicePrice: booking.servicePrice,
          serviceDurationMinutes: booking.serviceDurationMinutes,
          operatingHours: salon.operatingHours,
          preferredStaffId: booking.preferredStaffId,
          preferredStaffName: booking.preferredStaffName,
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start a new booking. Please try again.');
    } finally {
      setRebookingId(null);
    }
  }

  return { rebook, rebookingId, rebookError: error };
}
