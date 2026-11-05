import { AssistantActionId, Role } from '@barbercue/shared';
import { parseAssistantText } from './assistant-parser';
import { romanize } from './assistant-transliterate';
import { normalizeText } from './assistant-parser';
import { helpTurn, notUnderstoodTurn } from './assistant-help';
import { ASSISTANT_ACTIONS } from './actions/catalog';

/**
 * Issue #368 regression set, from the owner's QA screenshots and failed commands on Handsome Center.
 * Each fixture is TEXT AS THE SPEECH RECOGNIZER PRODUCED IT (hi-IN often writes English words in
 * Devanagari). The "before" column is what master f0aa6acb returned, recorded before the fix.
 */
const shop = (t: string) => parseAssistantText(t, 'shop');

describe('owner QA fixtures (before -> after)', () => {
  const HELP = { action: AssistantActionId.HELP, greeting: false };
  it.each([
    // [recognized text, before (master), after]
    ['What can you do?', null, HELP],
    ['How can you help me?', null, HELP],
    ['व्हाट कैन यू डू', null, HELP],
    ['हाउ कैन यू हेल्प मी', null, HELP],
    ['व्हाट कैन यू डू?', null, HELP],
    ['Tum kya kar sakte ho?', null, HELP],
    ['Aap meri kaise help karoge?', null, HELP],
    ['क्या-क्या कर सकते हो?', null, HELP],
    ['आप मेरी कैसे मदद करोगे', null, HELP],
    ['help', null, HELP],
  ])('%s', (text, _before, after) => {
    expect(shop(text)).toEqual(after);
  });

  it('greetings get the help answer with a greeting', () => {
    for (const t of ['hello', 'Hi', 'नमस्ते', 'namaste ji', 'हेलो'])
      expect(shop(t)).toEqual({
        action: AssistantActionId.HELP,
        greeting: true,
      });
  });

  it.each([
    // before: null on master
    'चेक करो कितनी चेयर्स अवेलेबल हैं',
    'कितनी चेयर्स फ्री हैं',
    'चेयर्स अवेलेबल हैं क्या',
    // already worked; must keep working
    'kitni chairs free hain',
    'chair availability check karo',
    'kitni kursi khali hai',
  ])('chair availability: %s', (t) => {
    expect(shop(t)).toEqual({ action: AssistantActionId.CHAIRS_LIST });
  });

  it.each([
    ['Bookings kholo', 'bookings'], // before: schedule.view (a list in the drawer)
    ['Services page kholo', 'services'], // before: services.list
    ['Live queue kholo', 'queue'], // before: queue.status
    ['dashboard pe jao', 'dashboard'], // before: null
    ['open staff page', 'staff'],
    ['सर्विसेज पेज खोलो', 'services'],
    ['बुकिंग्स खोलो', 'bookings'],
    ['chairs page pe le chalo', 'chairs'],
    ['settings kholo', 'settings'],
    ['go to revenue', 'revenue'],
    ['booking sources kholo', 'bookingSources'],
  ])('navigate: %s -> %s', (t, page) => {
    expect(shop(t)).toEqual({ action: AssistantActionId.NAVIGATE, page });
  });

  it('an unknown page asks which one', () => {
    expect(shop('wo page kholo')).toEqual({
      action: AssistantActionId.NAVIGATE,
      page: null,
    });
  });

  it('go back no longer parses as RESTORE A SERVICE (a write)', () => {
    for (const t of ['wapas jao', 'go back', 'वापस जाओ', 'peeche jao'])
      expect(shop(t)).toEqual({ action: AssistantActionId.NAVIGATE_BACK });
  });

  it.each([
    ['Show services', AssistantActionId.SERVICE_LIST],
    ['Staff dikhao', AssistantActionId.STAFF_LIST],
    ['Aaj queue mein kitne log hain?', AssistantActionId.QUEUE_STATUS],
    ['आज queue में कितने लोग हैं', AssistantActionId.QUEUE_STATUS],
    ['आज क्यू में कितने लोग हैं', AssistantActionId.QUEUE_STATUS],
    ['आज की कमाई कितनी हुई', AssistantActionId.TODAY_INSIGHTS],
    ['रेवेन्यू दिखाओ', AssistantActionId.TODAY_INSIGHTS],
    ['aaj ki sales batao', AssistantActionId.TODAY_INSIGHTS],
    ['aaj ke appointments dikhao', AssistantActionId.SCHEDULE_VIEW],
    ['आज की बुकिंग्स दिखाओ', AssistantActionId.SCHEDULE_VIEW],
    ['स्टाफ दिखाओ', AssistantActionId.STAFF_LIST],
    ['सर्विसेज दिखाओ', AssistantActionId.SERVICE_LIST],
  ])('reads: %s', (t, action) => {
    expect(shop(t)?.action).toBe(action);
  });
});

describe('safety: the new phrases never become a write', () => {
  it('commands that change data are not navigation or help', () => {
    expect(shop('Haircut ka price 150 karo')?.action).toBe(
      AssistantActionId.SERVICE_SET_PRICE,
    );
    expect(shop('booking cancel karo')?.action).toBe(
      AssistantActionId.BOOKING_CANCEL_BY_SHOP,
    );
    expect(shop('Sunday ko shop kholo')?.action).not.toBe(
      AssistantActionId.NAVIGATE,
    );
    expect(shop('shop kholo')?.action).not.toBe(AssistantActionId.NAVIGATE);
    expect(shop('services page kholo aur haircut 100 karo')?.action).not.toBe(
      AssistantActionId.NAVIGATE,
    );
  });
  it('shop navigation exists only on the shop screens; back also on the admin screens', () => {
    expect(parseAssistantText('wapas jao', 'admin')?.action).toBe(
      AssistantActionId.NAVIGATE_BACK,
    );
    expect(parseAssistantText('Bookings kholo', 'admin')?.action).toBe(
      AssistantActionId.ADMIN_NAVIGATE,
    );
    for (const s of ['customer', 'employee'] as const) {
      expect(parseAssistantText('Bookings kholo', s)?.action).not.toBe(
        AssistantActionId.NAVIGATE,
      );
      expect(parseAssistantText('wapas jao', s)?.action).not.toBe(
        AssistantActionId.NAVIGATE_BACK,
      );
    }
  });
  it('help works on every screen', () => {
    for (const s of ['shop', 'customer', 'admin', 'employee'] as const)
      expect(parseAssistantText('What can you do?', s)?.action).toBe(
        AssistantActionId.HELP,
      );
  });
  it('all three new actions are READs', () => {
    for (const id of [
      AssistantActionId.HELP,
      AssistantActionId.NAVIGATE,
      AssistantActionId.NAVIGATE_BACK,
    ])
      expect(ASSISTANT_ACTIONS[id].kind).toBe('READ');
  });
});

describe('romanize', () => {
  it('maps known Devanagari tokens and keeps unknown ones', () => {
    expect(romanize(normalizeText('चेक करो कितनी चेयर्स अवेलेबल हैं'))).toBe(
      'check karo kitni chairs available hain',
    );
    expect(romanize(normalizeText('रमेश को हेयरकट'))).toBe('रमेश ko haircut');
    expect(romanize('only latin')).toBe('only latin');
  });
});

// Capabilities as AssistantService.capabilities() returns them for a shop owner.
function capsFor(roles: Role[], writesOn: boolean) {
  return (Object.keys(ASSISTANT_ACTIONS) as AssistantActionId[]).map((id) => {
    const d = ASSISTANT_ACTIONS[id];
    return {
      id,
      title: d.title,
      kind: d.kind,
      confirmation: d.confirm,
      state: (d.kind === 'WRITE' && !writesOn
        ? 'UNAVAILABLE'
        : d.roles.some((r) => roles.includes(r))
          ? 'SUPPORTED'
          : 'DENIED') as 'SUPPORTED' | 'DENIED' | 'UNAVAILABLE',
      examples: d.examples,
    };
  });
}

describe('help answer', () => {
  const owner = capsFor([Role.SALON_OWNER, Role.CUSTOMER], false);
  it('owner, writes off: real shop topics, says changes are off, offers only reads', () => {
    const t = helpTurn(owner, 'shop', false, false);
    expect(t.status).toBe('DONE');
    expect(t.message).toMatch(/chairs/);
    expect(t.message).toMatch(/queue/);
    expect(t.message).toMatch(/switched off/);
    expect(t.message).toMatch(/Bookings kholo/);
    const writeExamples = new Set(
      Object.values(ASSISTANT_ACTIONS)
        .filter((d) => d.kind === 'WRITE')
        .flatMap((d) => d.examples),
    );
    for (const o of t.options ?? [])
      expect(writeExamples.has(o.text)).toBe(false);
    // A shop owner who is also a customer is not offered customer self-service on the shop screen.
    expect(t.message).not.toMatch(/your bookings and queue/);
  });
  it('writes on: says previews need confirmation', () => {
    expect(
      helpTurn(capsFor([Role.SALON_OWNER], true), 'shop', true, true).message,
    ).toMatch(/Namaste.*confirmation on screen/);
  });
  it('a customer on the customer screen gets customer topics, no shop pages', () => {
    const t = helpTurn(
      capsFor([Role.CUSTOMER], false),
      'customer',
      false,
      false,
    );
    expect(t.message).toMatch(/your bookings/);
    expect(t.message).not.toMatch(/kholo/);
  });
});

describe('not understood', () => {
  const owner = capsFor([Role.SALON_OWNER], false);
  it('names what it heard and suggests the topic of the sentence', () => {
    const t = notUnderstoodTurn(owner, 'shop', 'chairs ka kuch batao yaar');
    expect(t.message).toContain('I heard "chairs ka kuch batao yaar"');
    expect(t.options?.map((o) => o.text)).toContain('Chairs dikhao');
    expect(t.options?.[(t.options?.length ?? 0) - 1]?.text).toBe('What can you do?');
  });
  it('different sentences do not all get the same chips', () => {
    const a = notUnderstoodTurn(owner, 'shop', 'xyz abc').options?.map(
      (o) => o.text,
    );
    const b = notUnderstoodTurn(
      owner,
      'shop',
      'something else entirely',
    ).options?.map((o) => o.text);
    expect(a?.[0]).toBe('What can you do?');
    expect(a).not.toEqual(b);
  });
});
