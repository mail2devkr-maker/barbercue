import { AssistantActionId } from '@barbercue/shared';
import { ASSISTANT_ACTIONS } from './actions/catalog';
import { parseAssistantText } from './assistant-parser';
import {
  HIGH_RISK,
  PreviewMutationError,
  confirmationQuestion,
  consequenceFor,
  isBareYes,
  readOnly,
} from './assistant-write-policy';

describe('write policy (issue #372)', () => {
  const writes = Object.entries(ASSISTANT_ACTIONS).filter(
    ([, d]) => d.kind === 'WRITE',
  );

  it('every WRITE in the catalog requires an explicit confirmation (current and future)', () => {
    expect(writes.length).toBeGreaterThan(40);
    for (const [id, d] of writes) expect([id, d.confirm]).toEqual([id, true]);
  });

  it('every high-risk action is a real WRITE and has a consequence warning', () => {
    for (const id of HIGH_RISK) {
      expect(ASSISTANT_ACTIONS[id as AssistantActionId]?.kind).toBe('WRITE');
      expect(consequenceFor(id)).toBeTruthy();
    }
  });

  it('removing or deactivating is never described as a permanent delete', () => {
    for (const id of [
      AssistantActionId.CHAIRS_SET_STATUS,
      AssistantActionId.STAFF_SET_STATUS,
      AssistantActionId.SERVICE_ARCHIVE,
    ])
      expect(consequenceFor(id)).toMatch(/not (a )?permanent(ly)? delete/i);
  });

  describe('the confirmation question names the exact target and values', () => {
    it.each([
      [
        AssistantActionId.CHAIRS_SET_STATUS,
        [{ label: 'Chair 2 status', before: 'In use', after: 'Off' }],
        'Kya aap sach mein Chair 2 ko hatana (Off) chahte hain?',
      ],
      [
        AssistantActionId.STAFF_SET_STATUS,
        [{ label: 'Ramesh status', before: 'Active', after: 'Inactive' }],
        'Kya aap sach mein Ramesh ko hatana (Inactive) chahte hain?',
      ],
      [
        AssistantActionId.SERVICE_SET_PRICE,
        [{ label: 'Haircut price', before: '₹100', after: '₹150' }],
        'Kya aap Haircut ki price ₹100 se ₹150 karna chahte hain?',
      ],
      [
        AssistantActionId.CHAIRS_SET_STATUS,
        [{ label: 'Chair 2 status', before: 'Off', after: 'In use' }],
        'Kya aap sach mein Chair 2 ko wapas chalu (In use) karna chahte hain?',
      ],
      [
        AssistantActionId.SERVICE_RENAME,
        [{ label: 'Service name', before: 'Hair cut', after: 'Haircut' }],
        'Kya aap sach mein Service name ko Hair cut se Haircut karna chahte hain?',
      ],
      [
        AssistantActionId.CHAIRS_ADD,
        [{ label: 'New chair', before: null, after: 'Chair 6' }],
        'Kya aap sach mein New chair: Chair 6 karna chahte hain?',
      ],
    ])('%s', (id, rows, q) => {
      expect(confirmationQuestion(id, ASSISTANT_ACTIONS[id].title, rows)).toBe(
        q,
      );
    });
    it('falls back to the action title when there are no rows', () => {
      expect(
        confirmationQuestion(
          AssistantActionId.OFFERS_PAUSE,
          'Pause an offer',
          [],
        ),
      ).toBe('Kya aap sach mein yeh badlav karna chahte hain: Pause an offer?');
    });
  });

  describe('"haan / yes / ok" is never a confirmation', () => {
    it.each([
      'haan',
      'Haan!',
      'ha',
      'yes',
      'Yes.',
      'ok',
      'okay',
      'confirm',
      'kar do',
      'theek hai',
      'हाँ',
      'जी हाँ',
      'ओके',
      'ji haan',
    ])('%s', (t) => {
      expect(isBareYes(t)).toBe(true);
    });
    it('real commands are not swallowed', () => {
      for (const t of [
        'haan staff dikhao',
        'Haircut ka price 150 karo',
        'chair 2 band karo',
        'ok bookings kholo',
      ])
        expect(isBareYes(t)).toBe(false);
    });
    it('the parser maps none of them to an action', () => {
      for (const t of ['haan', 'yes', 'ok', 'confirm', 'kar do', 'हाँ']) {
        const p = parseAssistantText(t, 'shop');
        expect(
          p === null ||
            (p.action !== 'unreleased' &&
              ASSISTANT_ACTIONS[p.action].kind === 'READ'),
        ).toBe(true);
      }
    });
  });

  describe('read-only services while previewing a write', () => {
    const calls: string[] = [];
    const deps = readOnly({
      chairs: {
        list: () => {
          calls.push('list');
          return [{ id: 'c1' }];
        },
        setStatus: () => calls.push('setStatus'),
        create: () => calls.push('create'),
        bookingsFor: () => 'read',
      },
      prisma: {
        chair: {
          findMany: () => ['row'],
          update: () => calls.push('prisma.update'),
          deleteMany: () => calls.push('deleteMany'),
        },
        $transaction: () => calls.push('tx'),
        $queryRaw: () => 'read',
      },
    });
    it('reads work', () => {
      expect(deps.chairs.list()).toEqual([{ id: 'c1' }]);
      expect(deps.chairs.bookingsFor()).toBe('read');
      expect(deps.prisma.chair.findMany()).toEqual(['row']);
      expect(deps.prisma.$queryRaw()).toBe('read');
    });
    it('every data-changing call throws and never reaches the service', () => {
      expect(() => deps.chairs.setStatus()).toThrow(PreviewMutationError);
      expect(() => deps.chairs.create()).toThrow(PreviewMutationError);
      expect(() => deps.prisma.chair.update()).toThrow(PreviewMutationError);
      expect(() => deps.prisma.chair.deleteMany()).toThrow(
        PreviewMutationError,
      );
      expect(() => deps.prisma.$transaction()).toThrow(PreviewMutationError);
      expect(calls).toEqual(['list']);
    });
  });
});
