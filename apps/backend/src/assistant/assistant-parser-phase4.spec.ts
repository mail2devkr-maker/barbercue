import { AssistantActionId } from '@barbercue/shared';
import { parseAssistantText } from './assistant-parser';

const shop = (t: string) => parseAssistantText(t, 'shop', 2026);
const customer = (t: string) => parseAssistantText(t, 'customer', 2026);

describe('assistant batch 4 intents', () => {
  it('seating and starting a queue customer', () => {
    expect(shop('token 5 Ravi Chair 1 assign karo')).toEqual({
      action: AssistantActionId.QUEUE_ASSIGN,
      token: 5,
    });
    expect(shop('token 5 ko Ravi ke paas baithao')).toEqual({
      action: AssistantActionId.QUEUE_ASSIGN,
      token: 5,
    });
    expect(shop('token 5 start karo')).toEqual({
      action: AssistantActionId.QUEUE_START,
      token: 5,
    });
    expect(shop('token 5 ki service shuru karo')).toEqual({
      action: AssistantActionId.QUEUE_START,
      token: 5,
    });
    // Earlier queue meanings are unchanged.
    expect(shop('token 5 no show')).toMatchObject({
      action: AssistantActionId.QUEUE_NO_SHOW,
    });
    expect(shop('agla customer bulao')).toEqual({
      action: AssistantActionId.QUEUE_CALL_NEXT,
    });
  });

  it('in-shop appointment: name, time, phone only with consent', () => {
    expect(
      shop('Amit ke liye kal 5 baje haircut appointment book karo'),
    ).toEqual({
      action: AssistantActionId.BOOKING_IN_SHOP,
      name: 'Amit',
      phone: null,
      consent: false,
      day: { kind: 'offset', days: 1 },
      time: '17:00',
    });
    expect(
      shop('Amit ka kal 5 baje haircut appointment book karo 98765 43210'),
    ).toMatchObject({ name: 'Amit', phone: '+919876543210', consent: false });
    expect(
      shop('Amit ke liye appointment book karo 9876543210 customer agreed'),
    ).toMatchObject({ phone: '+919876543210', consent: true });
    expect(shop('kal 5 baje appointment book karo')).toMatchObject({
      action: AssistantActionId.BOOKING_IN_SHOP,
      name: null,
    });
  });

  it('no-show correction needs a mistake or completed word', () => {
    expect(
      shop('5 baje wala appointment no show galat tha, completed karo'),
    ).toEqual({
      action: AssistantActionId.BOOKING_CORRECT_COMPLETED,
      day: null,
      time: '17:00',
    });
    expect(shop('aaj 5 baje wala appointment no show')).toMatchObject({
      action: AssistantActionId.BOOKING_NO_SHOW,
    });
  });

  it('none of this is reachable from a customer screen', () => {
    for (const t of [
      'token 5 Ravi Chair 1 assign karo',
      'token 5 start karo',
      'Amit ke liye kal 5 baje haircut appointment book karo',
      '5 baje wala appointment no show galat tha',
    ]) {
      const r = customer(t);
      expect(
        r === null ||
          String(r.action).startsWith('me.') ||
          r.action === AssistantActionId.SALON_SEARCH,
      ).toBe(true);
    }
  });
});
