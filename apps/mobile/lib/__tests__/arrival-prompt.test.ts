import {
  parseArrivalCheckUrl,
  replayPendingOwnerArrivalPrompt,
  requestOwnerArrivalPrompt,
  subscribeToOwnerArrivalPrompt,
} from '../arrival-prompt';

describe('owner arrival prompt handoff', () => {
  it('queues a cold-start request until a listener can consume it', () => {
    requestOwnerArrivalPrompt({
      type: 'booking.arrival_check',
      salonId: 's1',
      bookingId: 'b1',
      initialAction: 'arrived',
    });

    const seen: unknown[] = [];
    const unsubscribe = subscribeToOwnerArrivalPrompt((request) => {
      seen.push(request);
      return true;
    });

    expect(seen).toEqual([
      {
        type: 'booking.arrival_check',
        salonId: 's1',
        bookingId: 'b1',
        initialAction: 'arrived',
      },
    ]);
    unsubscribe();
  });

  it('keeps the request pending while a listener is not ready, then replays it', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeToOwnerArrivalPrompt((request) => {
      seen.push(request.bookingId);
      return false;
    });

    requestOwnerArrivalPrompt({
      type: 'booking.arrival_check',
      salonId: 's2',
      bookingId: 'b2',
      initialAction: 'not-arrived',
    });
    expect(seen).toEqual(['b2']);

    unsubscribe();
    const ready = subscribeToOwnerArrivalPrompt((request) => {
      seen.push(`ready:${request.bookingId}:${request.initialAction}`);
      return true;
    });
    replayPendingOwnerArrivalPrompt();
    expect(seen).toContain('ready:b2:not-arrived');
    ready();
  });
});

describe('parseArrivalCheckUrl (native arrival alert deep link)', () => {
  const base = 'fastque://arrival-check?salonId=salon-1&bookingId=3f2a9c1e-0b6d-4c1a-9a55-1d2e3f4a5b6c';

  it('opens the prompt for the booking with no initial action', () => {
    expect(parseArrivalCheckUrl(`${base}&action=open`)).toEqual({
      type: 'booking.arrival_check',
      salonId: 'salon-1',
      bookingId: '3f2a9c1e-0b6d-4c1a-9a55-1d2e3f4a5b6c',
      initialAction: null,
    });
  });

  it('maps the notification buttons onto the existing two-step prompt actions', () => {
    expect(parseArrivalCheckUrl(`${base}&action=arrived`)?.initialAction).toBe('arrived');
    expect(parseArrivalCheckUrl(`${base}&action=not-arrived`)?.initialAction).toBe('not-arrived');
  });

  it('ignores an unknown action instead of guessing one', () => {
    expect(parseArrivalCheckUrl(`${base}&action=no-show`)?.initialAction).toBeNull();
    expect(parseArrivalCheckUrl(base)?.initialAction).toBeNull();
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['another scheme', 'https://example.com/arrival-check?salonId=a&bookingId=b'],
    ['another host', 'fastque://something-else?salonId=a&bookingId=b'],
    ['missing booking', 'fastque://arrival-check?salonId=a'],
    ['missing salon', 'fastque://arrival-check?bookingId=b'],
    ['path traversal in an id', 'fastque://arrival-check?salonId=..%2F..&bookingId=b'],
    ['script-ish id', 'fastque://arrival-check?salonId=a&bookingId=%3Cscript%3E'],
    ['oversized id', `fastque://arrival-check?salonId=a&bookingId=${'x'.repeat(65)}`],
    ['broken encoding', 'fastque://arrival-check?salonId=%E0%A4%A&bookingId=b'],
  ])('rejects %s', (_label, url) => {
    expect(parseArrivalCheckUrl(url as string | null)).toBeNull();
  });
});
