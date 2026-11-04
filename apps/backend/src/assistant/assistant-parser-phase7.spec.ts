import { AssistantActionId } from '@barbercue/shared';
import { parseAssistantText } from './assistant-parser';

const shop = (t: string) => parseAssistantText(t, 'shop', 2026);
const customer = (t: string) => parseAssistantText(t, 'customer', 2026);

describe('assistant batch 12 intents (reads)', () => {
  it("a barber's own day", () => {
    expect(shop('mera aaj ka kaam dikhao')).toEqual({ action: AssistantActionId.STAFF_MY_WORK });
    expect(shop('my work today')).toEqual({ action: AssistantActionId.STAFF_MY_WORK });
  });

  it('cancellation figures with a range, but never a booking-level cancel', () => {
    expect(shop('is mahine kitne cancel hue')).toEqual({ action: AssistantActionId.CANCELLATION_ANALYTICS, range: '30d' });
    expect(shop('is hafte ki cancellations')).toEqual({ action: AssistantActionId.CANCELLATION_ANALYTICS, range: '7d' });
    expect(shop('3 mahine ki cancellation report')).toEqual({ action: AssistantActionId.CANCELLATION_ANALYTICS, range: '90d' });
    expect(shop('aaj 5 baje wala appointment cancel karo')?.action).not.toBe(AssistantActionId.CANCELLATION_ANALYTICS);
  });

  it('customer credits; shop phrases unchanged', () => {
    expect(customer('mere credits kitne hain')).toEqual({ action: AssistantActionId.MY_CREDITS });
    expect(customer('wallet balance batao')).toEqual({ action: AssistantActionId.MY_CREDITS });
    expect(shop('mere credits kitne hain')?.action).not.toBe(AssistantActionId.MY_CREDITS);
    expect(customer('mera aaj ka kaam dikhao')?.action).not.toBe(AssistantActionId.STAFF_MY_WORK);
  });
});
