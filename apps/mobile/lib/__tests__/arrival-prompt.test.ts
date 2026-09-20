import {
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
