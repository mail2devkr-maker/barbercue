import { AssistantActionId } from '@barbercue/shared';
import { parseAssistantText } from './assistant-parser';

const shop = (t: string) => parseAssistantText(t, 'shop', 2026);
const customer = (t: string) => parseAssistantText(t, 'customer', 2026);

describe('assistant batch 12 intents (reads)', () => {
  it("a barber's own day", () => {
    expect(shop('mera aaj ka kaam dikhao')).toEqual({
      action: AssistantActionId.STAFF_MY_WORK,
    });
    expect(shop('my work today')).toEqual({
      action: AssistantActionId.STAFF_MY_WORK,
    });
  });

  it('cancellation figures with a range, but never a booking-level cancel', () => {
    expect(shop('is mahine kitne cancel hue')).toEqual({
      action: AssistantActionId.CANCELLATION_ANALYTICS,
      range: '30d',
    });
    expect(shop('is hafte ki cancellations')).toEqual({
      action: AssistantActionId.CANCELLATION_ANALYTICS,
      range: '7d',
    });
    expect(shop('3 mahine ki cancellation report')).toEqual({
      action: AssistantActionId.CANCELLATION_ANALYTICS,
      range: '90d',
    });
    expect(shop('aaj 5 baje wala appointment cancel karo')?.action).not.toBe(
      AssistantActionId.CANCELLATION_ANALYTICS,
    );
  });

  it('customer credits; shop phrases unchanged', () => {
    expect(customer('mere credits kitne hain')).toEqual({
      action: AssistantActionId.MY_CREDITS,
    });
    expect(customer('wallet balance batao')).toEqual({
      action: AssistantActionId.MY_CREDITS,
    });
    expect(shop('mere credits kitne hain')?.action).not.toBe(
      AssistantActionId.MY_CREDITS,
    );
    expect(customer('mera aaj ka kaam dikhao')?.action).not.toBe(
      AssistantActionId.STAFF_MY_WORK,
    );
  });
});

describe('assistant batch 13 intents', () => {
  it('booking sources with a range; only shop surface', () => {
    expect(shop('is mahine bookings kahan se aayi')).toEqual({
      action: AssistantActionId.BOOKING_SOURCES,
      range: '30d',
    });
    expect(shop('aaj ki booking sources dikhao')).toEqual({
      action: AssistantActionId.BOOKING_SOURCES,
      range: 'today',
    });
    expect(shop('where did bookings come from this week')).toEqual({
      action: AssistantActionId.BOOKING_SOURCES,
      range: '7d',
    });
    expect(customer('booking sources dikhao')?.action).not.toBe(
      AssistantActionId.BOOKING_SOURCES,
    );
  });

  it('auto-assign: questions read, commands write', () => {
    expect(shop('auto assign on hai kya')).toEqual({
      action: AssistantActionId.AUTO_ASSIGN_VIEW,
    });
    expect(shop('auto-assign band hai kya?')).toEqual({
      action: AssistantActionId.AUTO_ASSIGN_VIEW,
    });
    expect(shop('automatic staff assignment status')).toEqual({
      action: AssistantActionId.AUTO_ASSIGN_VIEW,
    });
    expect(shop('auto assign band karo')).toEqual({
      action: AssistantActionId.AUTO_ASSIGN_SET,
      enabled: false,
    });
    expect(shop('turn off auto assignment')).toEqual({
      action: AssistantActionId.AUTO_ASSIGN_SET,
      enabled: false,
    });
    expect(shop('auto assign chalu karo')).toEqual({
      action: AssistantActionId.AUTO_ASSIGN_SET,
      enabled: true,
    });
    expect(customer('auto assign band karo')?.action).not.toBe(
      AssistantActionId.AUTO_ASSIGN_SET,
    );
  });

  it('existing queue phrases are unchanged', () => {
    expect(shop('queue kaisi hai')?.action).not.toBe(
      AssistantActionId.AUTO_ASSIGN_VIEW,
    );
    expect(shop('mera aaj ka kaam dikhao')).toEqual({
      action: AssistantActionId.STAFF_MY_WORK,
    });
  });
});
