import { AssistantActionId } from '@barbercue/shared';
import { parseAssistantText } from './assistant-parser';
import { daySpecIn, resolveDay, timesIn, tokenIn } from './assistant-when';

const shop = (t: string) => parseAssistantText(t, 'shop', 2026);
const customer = (t: string) => parseAssistantText(t, 'customer', 2026);

describe('assistant days and times', () => {
  it.each([
    ['kal shaam 5 baje', ['17:00']],
    ['tomorrow at 5 pm', ['17:00']],
    ['subah 10 baje', ['10:00']],
    ['17:30 par', ['17:30']],
    ['5:30 baje', ['17:30']],
    ['12 pm', ['12:00']],
    ['10 am', ['10:00']],
    ['5 बजे', ['17:00']],
    ['raat 8 baje', ['20:00']],
    ['shaam 8:30 baje', ['20:30']],
    ['subah 8 baje', ['08:00']],
  ])('%s', (text, expected) => {
    expect(timesIn(text)).toEqual(expected);
  });

  it('needs a marker for clock times except in opening-hours phrases', () => {
    expect(timesIn('haircut 200')).toEqual([]);
    expect(timesIn('monday 10 se 8', true)).toEqual(['10:00', '20:00']);
  });

  it('reads days and resolves them from the shop-local today', () => {
    expect(daySpecIn('aaj', 2026)).toEqual({ kind: 'offset', days: 0 });
    expect(daySpecIn('kal ke appointments', 2026)).toEqual({ kind: 'offset', days: 1 });
    expect(daySpecIn('parso', 2026)).toEqual({ kind: 'offset', days: 2 });
    expect(daySpecIn('शुक्रवार', 2026)).toEqual({ kind: 'weekday', dow: 5 });
    expect(daySpecIn('12 nov', 2026)).toEqual({ kind: 'date', iso: '2026-11-12' });
    // Tuesday 3 Nov 2026: next Friday is the 6th, "kal" is the 4th, today's weekday is today.
    expect(resolveDay({ kind: 'weekday', dow: 5 }, '2026-11-03', 2)).toBe('2026-11-06');
    expect(resolveDay({ kind: 'offset', days: 1 }, '2026-11-30', 1)).toBe('2026-12-01');
    expect(resolveDay({ kind: 'weekday', dow: 2 }, '2026-11-03', 2)).toBe('2026-11-03');
  });

  it('reads queue token numbers', () => {
    expect(tokenIn('token 12 aa gaya')).toBe(12);
    expect(tokenIn('#7 no show')).toBe(7);
    expect(tokenIn('haircut 200')).toBeNull();
  });
});

describe('assistant phase 2 intents (shop)', () => {
  it('opening hours', () => {
    expect(shop('dukan ki timing dikhao')).toEqual({ action: AssistantActionId.HOURS_VIEW });
    expect(shop('Sunday band rakho')).toEqual({ action: AssistantActionId.HOURS_SET, days: [0], open: null, close: null, closed: true });
    expect(shop('Monday 10 se 8 baje khulega')).toEqual({ action: AssistantActionId.HOURS_SET, days: [1], open: '10:00', close: '20:00', closed: false });
    expect(shop('har din 9 se 9 baje khulega')).toEqual({ action: AssistantActionId.HOURS_SET, days: 'all', open: '09:00', close: '21:00', closed: false });
    expect(shop('set saturday hours 10:30 to 18:00')).toMatchObject({ days: [6], open: '10:30', close: '18:00' });
  });

  it('live queue operations', () => {
    expect(shop('agla customer bulao')).toEqual({ action: AssistantActionId.QUEUE_CALL_NEXT });
    expect(shop('call next customer')).toEqual({ action: AssistantActionId.QUEUE_CALL_NEXT });
    expect(shop('token 12 aa gaya')).toEqual({ action: AssistantActionId.QUEUE_MARK_ARRIVED, token: 12 });
    expect(shop('token 12 no show')).toEqual({ action: AssistantActionId.QUEUE_NO_SHOW, token: 12 });
    expect(shop('token 4 cancel karo')).toEqual({ action: AssistantActionId.QUEUE_CANCEL, token: 4 });
    expect(shop('token 4 ho gaya')).toEqual({ action: AssistantActionId.QUEUE_COMPLETE, token: 4 });
    expect(shop('walk-in add karo Amit haircut')).toEqual({ action: AssistantActionId.QUEUE_ADD_WALK_IN, name: 'Amit Haircut', phoneMentioned: false });
    // Phase 1 queue view still works.
    expect(shop('aaj ki queue dikhao')).toEqual({ action: AssistantActionId.QUEUE_STATUS });
  });

  it('appointment schedule', () => {
    expect(shop('aaj ke appointments dikhao')).toEqual({ action: AssistantActionId.SCHEDULE_VIEW, day: { kind: 'offset', days: 0 } });
    expect(shop('kal ki bookings')).toEqual({ action: AssistantActionId.SCHEDULE_VIEW, day: { kind: 'offset', days: 1 } });
    expect(shop('aaj 5 baje ka appointment cancel karo')).toEqual({
      action: AssistantActionId.BOOKING_CANCEL_BY_SHOP,
      day: { kind: 'offset', days: 0 },
      time: '17:00',
    });
    expect(shop('kal 5 baje wala appointment 6 baje kar do')).toEqual({
      action: AssistantActionId.BOOKING_RESCHEDULE_BY_SHOP,
      day: { kind: 'offset', days: 1 },
      from: '17:00',
      to: '18:00',
    });
  });

  it('keeps a moved appointment in the same half of the day unless am/pm is said', () => {
    expect(shop('kal 7 baje wala appointment 8 baje kar do')).toMatchObject({ from: '19:00', to: '20:00' });
    expect(shop('kal 7 baje wala appointment subah 10 baje kar do')).toMatchObject({ from: '07:00', to: '10:00' });
    expect(shop('appointment 6 pm se 9 am kar do')).toMatchObject({ from: '18:00', to: '09:00' });
  });

  it('customers, renames and durations', () => {
    expect(shop('customer Amit dhundo')).toEqual({ action: AssistantActionId.CUSTOMERS_FIND, query: 'amit' });
    expect(shop('customers dikhao')).toEqual({ action: AssistantActionId.CUSTOMERS_FIND, query: null });
    expect(shop('rename staff Ravi to Ravi Kumar')).toEqual({ action: AssistantActionId.STAFF_RENAME, target: 'staff ravi', newName: 'Ravi Kumar' });
    expect(shop('Ravi staff ka naam Ravi Kumar karo')).toEqual({ action: AssistantActionId.STAFF_RENAME, target: 'ravi staff', newName: 'Ravi Kumar' });
    expect(shop('rename service Facial to Gold Facial')).toEqual({ action: AssistantActionId.SERVICE_RENAME, target: 'service facial', newName: 'Gold Facial' });
    expect(shop('haircut 45 minute karo')).toEqual({ action: AssistantActionId.SERVICE_SET_DURATION, minutes: 45 });
  });

  it('keeps the Phase 1 meanings when times are not involved', () => {
    expect(shop('Haircut ₹200 se ₹150 kar do')).toMatchObject({ action: AssistantActionId.SERVICE_SET_PRICE, from: 200, to: 150 });
    expect(shop('Beard trim service add karo ₹100 20 minute')).toMatchObject({ action: AssistantActionId.SERVICE_ADD, durationMinutes: 20 });
    expect(shop('Ravi ko staff mein add karo')).toMatchObject({ action: AssistantActionId.STAFF_ADD, name: 'Ravi' });
  });
});

describe('assistant phase 2 intents (customer)', () => {
  it('self-service', () => {
    expect(customer('meri bookings dikhao')).toEqual({ action: AssistantActionId.MY_BOOKINGS });
    expect(customer('mera appointment cancel karo')).toEqual({ action: AssistantActionId.MY_BOOKING_CANCEL });
    expect(customer('mera appointment kal 6 baje kar do')).toMatchObject({ action: AssistantActionId.MY_BOOKING_RESCHEDULE, day: { kind: 'offset', days: 1 }, time: '18:00' });
    expect(customer('meri queue ka status batao')).toEqual({ action: AssistantActionId.MY_QUEUE_STATUS });
    expect(customer('queue chhod do')).toEqual({ action: AssistantActionId.MY_QUEUE_LEAVE });
    expect(customer('kal shaam 5 baje haircut book karo')).toEqual({ action: AssistantActionId.BOOK_APPOINTMENT, day: { kind: 'offset', days: 1 }, time: '17:00' });
    expect(customer('haircut salon dhoondo')).toMatchObject({ action: AssistantActionId.SALON_SEARCH });
  });

  it('never yields a shop-management intent on the customer surface', () => {
    for (const t of ['Haircut ₹200 se ₹150 kar do', 'Facial service hata do', 'Ravi ko staff mein add karo', 'Sunday band rakho', 'token 12 no show', 'staff dikhao']) {
      // Customer-own actions (me.*) and salon search are the only things a customer phrase can reach.
      const r = customer(t);
      expect(r === null || r.action === AssistantActionId.SALON_SEARCH || String(r.action).startsWith('me.')).toBe(true);
    }
  });

  it('on the shop surface, "my" queue phrasing without staff words is self-service', () => {
    expect(shop('meri queue ka status batao')).toEqual({ action: AssistantActionId.MY_QUEUE_STATUS });
  });
});
