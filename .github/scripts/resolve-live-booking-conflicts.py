from pathlib import Path

# Backend: preserve launch candidate's specific-staff availability guard and add explicit state.
p = Path('apps/backend/src/bookings/availability.service.ts')
s = p.read_text()
old = """      slots.push({
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        available,
      });"""
new = """      slots.push({
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        available,
        state: available ? 'AVAILABLE' : 'OCCUPIED',
      });"""
if old not in s:
    raise SystemExit('availability merge marker missing')
s = s.replace(old, new, 1)
p.write_text(s)

# Web reschedule: preserve salon-timezone formatting and add cinema-style occupied/selected states.
p = Path('apps/web/components/booking/RescheduleBookingDialog.tsx')
s = p.read_text()
old = """            {!slotsLoading && slots.length > 0 && (
              <div className={styles.slotGrid}>
                {slots.map((slot) => (
                  <button
                    key={slot.slotStart}
                    type=\"button\"
                    disabled={!slot.available}
                    onClick={() => setSelectedSlot(slot)}
                    className={`${styles.slotChip} ${selectedSlot?.slotStart === slot.slotStart ? styles.slotChipSelected : \"\"}`}
                  >
                    {booking.salonTimeZone
                      ? formatZonedTime(slot.slotStart, booking.salonTimeZone)
                      : new Date(slot.slotStart).toLocaleTimeString(undefined, { hour: \"2-digit\", minute: \"2-digit\" })}
                  </button>
                ))}
              </div>
            )}"""
new = """            {!slotsLoading && slots.length > 0 && (
              <>
                <div className={styles.slotLegend} aria-label=\"Time availability legend\">
                  <span><i className={`${styles.legendSwatch} ${styles.legendAvailable}`} aria-hidden=\"true\" /> Available</span>
                  <span><i className={`${styles.legendSwatch} ${styles.legendSelected}`} aria-hidden=\"true\" /> Your selection</span>
                  <span><i className={`${styles.legendSwatch} ${styles.legendOccupied}`} aria-hidden=\"true\" /> Occupied</span>
                </div>
                <div className={styles.slotGrid}>
                  {slots.map((slot) => {
                    const occupied = slot.state === \"OCCUPIED\" || !slot.available;
                    return (
                      <button
                        key={slot.slotStart}
                        type=\"button\"
                        disabled={occupied}
                        onClick={() => setSelectedSlot(slot)}
                        className={`${styles.slotChip} ${occupied ? styles.slotChipOccupied : \"\"} ${selectedSlot?.slotStart === slot.slotStart ? styles.slotChipSelected : \"\"}`}
                      >
                        {booking.salonTimeZone
                          ? formatZonedTime(slot.slotStart, booking.salonTimeZone)
                          : new Date(slot.slotStart).toLocaleTimeString(undefined, { hour: \"2-digit\", minute: \"2-digit\" })}
                      </button>
                    );
                  })}
                </div>
              </>
            )}"""
if old not in s:
    raise SystemExit('reschedule merge marker missing')
s = s.replace(old, new, 1)
p.write_text(s)
