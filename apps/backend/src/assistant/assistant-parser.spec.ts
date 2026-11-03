import { AssistantActionId } from '@barbercue/shared';
import { matchByName, parseAssistantText } from './assistant-parser';

describe('assistant parser (English / Hindi / Hinglish)', () => {
  it.each([
    ['Ravi ko staff mein add karo', { action: AssistantActionId.STAFF_ADD, name: 'Ravi', phone: null }],
    ['Add Ravi Kumar as staff 98765 43210', { action: AssistantActionId.STAFF_ADD, name: 'Ravi Kumar', phone: '+919876543210' }],
    ['रवि को स्टाफ में जोड़ो', { action: AssistantActionId.STAFF_ADD, name: 'रवि', phone: null }],
    ['staff dikhao', { action: AssistantActionId.STAFF_LIST }],
    ['Ravi staff ko deactivate karo', { action: AssistantActionId.STAFF_SET_STATUS, active: false }],
    ['activate staff Ravi', { action: AssistantActionId.STAFF_SET_STATUS, active: true }],
    ['Facial service hata do', { action: AssistantActionId.SERVICE_ARCHIVE }],
    ['remove facial', { action: AssistantActionId.SERVICE_ARCHIVE }],
    ['Facial service wapas chalu karo', { action: AssistantActionId.SERVICE_RESTORE }],
    ['services dikhao', { action: AssistantActionId.SERVICE_LIST }],
    ['Aaj ki queue dikhao', { action: AssistantActionId.QUEUE_STATUS }],
    ['आज की कतार दिखाओ', { action: AssistantActionId.QUEUE_STATUS }],
    ['Aaj ki sales batao', { action: AssistantActionId.TODAY_INSIGHTS, topic: 'revenue' }],
    ["today's summary", { action: AssistantActionId.TODAY_INSIGHTS, topic: 'summary' }],
    ['Inventory me shampoo 5 bottles add karo', { action: 'unreleased', feature: 'inventory' }],
    ['New salon registration ka status dikhao', { action: 'unreleased', feature: 'onboarding' }],
  ])('%s', (text, expected) => {
    expect(parseAssistantText(text)).toEqual(expected);
  });

  it('reads price changes in every phrasing', () => {
    expect(parseAssistantText('Haircut ₹200 se ₹150 karo')).toMatchObject({ action: AssistantActionId.SERVICE_SET_PRICE, from: 200, to: 150 });
    expect(parseAssistantText('change haircut price from 200 to 150')).toMatchObject({ from: 200, to: 150 });
    expect(parseAssistantText('Set facial price to 500')).toMatchObject({ to: 500, from: null });
    expect(parseAssistantText('Massage price 10% badha do')).toMatchObject({ percent: 10, direction: 'up' });
    expect(parseAssistantText('massage ka rate 15 percent kam karo')).toMatchObject({ percent: 15, direction: 'down' });
    expect(parseAssistantText('increase beard price by 50')).toMatchObject({ delta: 50, direction: 'up', to: null });
    expect(parseAssistantText('हेयरकट की कीमत 150 करो')).toMatchObject({ action: AssistantActionId.SERVICE_SET_PRICE, to: 150 });
  });

  it('reads a new service with price and duration', () => {
    expect(parseAssistantText('Beard trim service add karo ₹100 20 minute')).toEqual({
      action: AssistantActionId.SERVICE_ADD,
      name: 'Beard Trim',
      price: 100,
      durationMinutes: 20,
    });
  });

  it('reads a salon search', () => {
    expect(parseAssistantText('find salons for facial in Ghaziabad')).toEqual({
      action: AssistantActionId.SALON_SEARCH,
      serviceQuery: 'facial',
      city: 'ghaziabad',
    });
  });

  it('refuses to guess on unrelated text', () => {
    expect(parseAssistantText('what is the weather')).toBeNull();
    expect(parseAssistantText('   ')).toBeNull();
  });

  it('matches existing names by whole words, longest first, and reports ties', () => {
    const rows = [{ n: 'Haircut' }, { n: 'Haircut Kids' }, { n: 'Facial' }];
    expect(matchByName('haircut kids price 100 karo', rows, (r) => r.n)).toEqual([{ n: 'Haircut Kids' }]);
    expect(matchByName('haircut price 150', rows, (r) => r.n)).toEqual([{ n: 'Haircut' }]);
    expect(matchByName('facialist', rows, (r) => r.n)).toEqual([]);
    expect(matchByName('massage', [{ n: 'Head Massage' }, { n: 'Foot Massage' }], (r) => r.n)).toHaveLength(2);
  });
});
