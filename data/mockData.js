export const shops = [
  { id: '1', name: 'Fade & Line Barbershop', distance: '0.4 mi', chairs: 3, busyChairs: 1 },
  { id: '2', name: 'Kingsmen Cuts', distance: '0.9 mi', chairs: 2, busyChairs: 2 },
  { id: '3', name: 'Old School Razor Co.', distance: '1.2 mi', chairs: 4, busyChairs: 4 },
  { id: '4', name: 'Studio 12 Barbers', distance: '1.6 mi', chairs: 2, busyChairs: 0 },
];

export const slotsByShop = {
  1: ['10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', '2:00 PM', '2:30 PM', '3:00 PM'],
  2: ['9:30 AM', '10:00 AM', '1:00 PM', '1:30 PM', '4:00 PM'],
  3: ['11:00 AM', '11:30 AM', '3:30 PM'],
  4: ['9:00 AM', '9:30 AM', '10:00 AM', '12:00 PM', '12:30 PM', '5:00 PM'],
};

export function shopStatus(shop) {
  const free = shop.chairs - shop.busyChairs;
  if (free <= 0) return { label: 'Fully booked', color: '#E24B4A' };
  if (free === shop.chairs) return { label: 'Free now', color: '#3B6D11' };
  return { label: 'Short wait', color: '#BA7517' };
}
