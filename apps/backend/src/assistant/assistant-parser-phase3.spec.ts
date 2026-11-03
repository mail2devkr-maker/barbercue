import { AssistantActionId } from '@barbercue/shared';
import { parseAssistantText } from './assistant-parser';

const shop = (t: string) => parseAssistantText(t, 'shop', 2026);
const customer = (t: string) => parseAssistantText(t, 'customer', 2026);
const admin = (t: string) => parseAssistantText(t, 'admin', 2026);

describe('assistant batch 3 intents', () => {
  it('chairs', () => {
    expect(shop('chairs dikhao')).toEqual({ action: AssistantActionId.CHAIRS_LIST });
    expect(shop('naya chair add karo Chair 3')).toEqual({ action: AssistantActionId.CHAIRS_ADD, label: 'Chair 3' });
    expect(shop('chair 2 maintenance mein daalo')).toEqual({ action: AssistantActionId.CHAIRS_SET_STATUS, status: 'MAINTENANCE' });
    expect(shop('chair 2 band karo')).toEqual({ action: AssistantActionId.CHAIRS_SET_STATUS, status: 'INACTIVE' });
    expect(shop('chair 2 chalu karo')).toEqual({ action: AssistantActionId.CHAIRS_SET_STATUS, status: 'ACTIVE' });
  });

  it('staff weekly hours need a staff word; shop hours keep their meaning', () => {
    expect(shop('Ravi staff ka Sunday off karo')).toEqual({ action: AssistantActionId.STAFF_HOURS_SET, days: [0], open: null, close: null, closed: true });
    expect(shop('barber Ravi Monday 10 se 6 baje kaam karega')).toEqual({
      action: AssistantActionId.STAFF_HOURS_SET,
      days: [1],
      open: '10:00',
      close: '18:00',
      closed: false,
    });
    expect(shop('Ravi staff ki timing dikhao')).toEqual({ action: AssistantActionId.STAFF_HOURS_VIEW });
    expect(shop('Sunday band rakho')).toMatchObject({ action: AssistantActionId.HOURS_SET });
    // Adding staff is still adding staff.
    expect(shop('Ravi ko staff mein add karo')).toMatchObject({ action: AssistantActionId.STAFF_ADD });
  });

  it('appointment no-show vs queue no-show', () => {
    expect(shop('aaj 5 baje wala appointment no show')).toEqual({ action: AssistantActionId.BOOKING_NO_SHOW, day: { kind: 'offset', days: 0 }, time: '17:00' });
    expect(shop('token 12 no show')).toMatchObject({ action: AssistantActionId.QUEUE_NO_SHOW, token: 12 });
  });

  it('offers, reviews, invoices and revenue report', () => {
    expect(shop('offers dikhao')).toEqual({ action: AssistantActionId.OFFERS_LIST });
    expect(shop('Diwali offer pause karo')).toEqual({ action: AssistantActionId.OFFERS_PAUSE });
    expect(shop('Diwali offer live karo')).toEqual({ action: AssistantActionId.OFFERS_PUBLISH });
    expect(shop('reviews dikhao')).toEqual({ action: AssistantActionId.REVIEWS_LIST });
    expect(shop('Review ka jawab do: Thank you, phir aaiye!')).toEqual({ action: AssistantActionId.REVIEWS_REPLY, reply: 'Thank you, phir aaiye!' });
    expect(shop('review reply karo')).toEqual({ action: AssistantActionId.REVIEWS_REPLY, reply: null });
    expect(shop('invoices dikhao')).toEqual({ action: AssistantActionId.INVOICES_LIST });
    expect(shop('is hafte ki sales report')).toEqual({ action: AssistantActionId.REVENUE_REPORT, range: 'week' });
    expect(shop('is mahine ki kamai report')).toEqual({ action: AssistantActionId.REVENUE_REPORT, range: 'month' });
    // "Today's sales" stays the quick figure, not the report.
    expect(shop('aaj ki sales batao')).toMatchObject({ action: AssistantActionId.TODAY_INSIGHTS });
  });

  it('notifications on every surface', () => {
    for (const parse of [shop, customer, admin]) {
      expect(parse('notifications dikhao')).toEqual({ action: AssistantActionId.NOTIFICATIONS_LIST });
      expect(parse('sab notifications read karo')).toEqual({ action: AssistantActionId.NOTIFICATIONS_READ_ALL });
    }
  });

  it('customer queue join, favorites and bills', () => {
    expect(customer('mujhe queue mein lagao haircut')).toEqual({ action: AssistantActionId.MY_QUEUE_JOIN });
    expect(customer('meri queue ka status batao')).toEqual({ action: AssistantActionId.MY_QUEUE_STATUS });
    expect(customer('meri favorite salons dikhao')).toEqual({ action: AssistantActionId.MY_FAVORITES });
    expect(customer('is salon ko favorite karo')).toEqual({ action: AssistantActionId.MY_FAVORITE_ADD });
    expect(customer('favorite se hatao')).toEqual({ action: AssistantActionId.MY_FAVORITE_REMOVE });
    expect(customer('mere bills dikhao')).toEqual({ action: AssistantActionId.MY_INVOICES });
  });

  it('platform screens only offer platform reads', () => {
    expect(admin('platform overview dikhao')).toEqual({ action: AssistantActionId.ADMIN_OVERVIEW });
    expect(admin('kitni shops open hain')).toEqual({ action: AssistantActionId.ADMIN_SHOP_STATUS });
    for (const t of ['Haircut ₹200 se ₹150 kar do', 'Sunday band rakho', 'token 12 no show', 'mera appointment cancel karo']) {
      expect(admin(t)).toBeNull();
    }
    // Platform actions are not reachable from shop or customer screens.
    expect(shop('platform overview dikhao')).not.toEqual({ action: AssistantActionId.ADMIN_OVERVIEW });
    expect(customer('kitni shops open hain')).not.toEqual({ action: AssistantActionId.ADMIN_SHOP_STATUS });
  });
});
