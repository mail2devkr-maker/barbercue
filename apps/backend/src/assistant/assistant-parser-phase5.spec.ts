import { AssistantActionId } from '@barbercue/shared';
import { parseAssistantText } from './assistant-parser';

const shop = (t: string) => parseAssistantText(t, 'shop', 2026);
const customer = (t: string) => parseAssistantText(t, 'customer', 2026);
const admin = (t: string) => parseAssistantText(t, 'admin', 2026);

describe('assistant batch 5 intents', () => {
  it('creates an offer draft with title, discount and validity', () => {
    expect(shop('Diwali offer banao 20% off 10 din ke liye')).toMatchObject({
      action: AssistantActionId.OFFERS_CREATE, title: 'Diwali', discountType: 'PERCENT', discountValue: 20, days: 10,
    });
    expect(shop('naya "Weekend Special" offer banao ₹50 off')).toMatchObject({ title: 'Weekend Special', discountType: 'FLAT', discountValue: 50 });
    expect(shop('offer banao')).toMatchObject({ action: AssistantActionId.OFFERS_CREATE, title: null, discountValue: null });
  });

  it('edits an existing offer only when there is something to change', () => {
    expect(shop('Diwali offer 25% karo')).toMatchObject({ action: AssistantActionId.OFFERS_EDIT, discountType: 'PERCENT', discountValue: 25 });
    expect(shop('Diwali offer 30 nov tak badhao')).toMatchObject({ action: AssistantActionId.OFFERS_EDIT, until: expect.anything() });
    expect(shop('Diwali offer karo')?.action).not.toBe(AssistantActionId.OFFERS_EDIT);
  });

  it('shop profile: view, and set one field from the text after a colon', () => {
    expect(shop('dukaan ki profile dikhao')).toEqual({ action: AssistantActionId.SALON_PROFILE_VIEW });
    expect(shop('Dukaan ka description badlo: Best haircuts in town')).toEqual({
      action: AssistantActionId.SALON_PROFILE_SET, field: 'description', value: 'Best haircuts in town',
    });
    expect(shop('shop ka phone 98765 43210 karo')).toMatchObject({ field: 'phone', value: '9876543210' });
    expect(shop('salon ka email hello@shop.in karo')).toMatchObject({ field: 'email', value: 'hello@shop.in' });
  });

  it('customer review with stars and comment', () => {
    expect(customer('Haircut ko 5 star review do: bahut badiya')).toEqual({ action: AssistantActionId.REVIEW_WRITE, rating: 5, comment: 'bahut badiya' });
    expect(customer('review dena hai')).toMatchObject({ action: AssistantActionId.REVIEW_WRITE, rating: null });
  });

  it('language for everyone, on every surface', () => {
    expect(shop('meri language Hindi karo')).toEqual({ action: AssistantActionId.LANGUAGE_SET, language: 'HI' });
    expect(customer('bhasha english karo')).toEqual({ action: AssistantActionId.LANGUAGE_SET, language: 'EN' });
    expect(admin('language hindi karo')).toEqual({ action: AssistantActionId.LANGUAGE_SET, language: 'HI' });
  });

  it('shop-only intents are not reachable from customer or admin screens', () => {
    for (const t of ['Diwali offer banao 20% off 10 din ke liye', 'Dukaan ka description badlo: hi', 'dukaan ki profile dikhao']) {
      for (const r of [customer(t), admin(t)]) {
        expect([AssistantActionId.OFFERS_CREATE, AssistantActionId.OFFERS_EDIT, AssistantActionId.SALON_PROFILE_SET, AssistantActionId.SALON_PROFILE_VIEW]).not.toContain(r?.action);
      }
    }
  });
});
