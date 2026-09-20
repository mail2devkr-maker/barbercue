/// <reference types="jest" />
import { uiStringsFor } from '@barbercue/shared';
import { friendlyQueueActionError, liveQueuePaths } from '../live-queue-actions';

const t = uiStringsFor('EN');

describe('liveQueuePaths - every operator action uses the authoritative /dashboard/... route', () => {
  it.each([
    ['call', liveQueuePaths.call('q1'), 'dashboard/queue-entries/q1/call'],
    ['arrive', liveQueuePaths.arrive('q1'), 'dashboard/queue-entries/q1/arrive'],
    ['assign', liveQueuePaths.assign('q1'), 'dashboard/queue-entries/q1/assign'],
    ['no-show', liveQueuePaths.noShow('q1'), 'dashboard/queue-entries/q1/no-show'],
    ['cancel', liveQueuePaths.cancel('q1'), 'dashboard/queue-entries/q1/cancel'],
    ['complete', liveQueuePaths.complete('s1'), 'dashboard/service-sessions/s1/complete'],
  ])('%s', (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it('never produces the un-prefixed route that returned "Cannot POST /api/v1/queue-entries/:id/call"', () => {
    for (const path of Object.values(liveQueuePaths).map((build) => build('id'))) {
      expect(path.startsWith('dashboard/')).toBe(true);
    }
  });
});

describe('friendlyQueueActionError', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('never shows raw router text such as "Cannot POST /api/v1/..."', () => {
    const err = Object.assign(new Error('Cannot POST /api/v1/queue-entries/abc/call'), {
      status: 404,
      code: 'UNKNOWN_ERROR',
    });
    const text = friendlyQueueActionError(err, t, 'call');
    expect(text).toBe(t.couldNotCompleteAction);
    expect(text).not.toContain('Cannot POST');
  });

  it('keeps the raw failure diagnosable in logs without any customer data', () => {
    const err = Object.assign(new Error('Cannot POST /x'), { status: 404, code: 'UNKNOWN_ERROR' });
    friendlyQueueActionError(err, t, 'cancel');
    expect(warn).toHaveBeenCalledWith('[live-queue] action failed', {
      action: 'cancel',
      status: 404,
      code: 'UNKNOWN_ERROR',
    });
  });

  it('reports offline clearly', () => {
    expect(friendlyQueueActionError(Object.assign(new Error('x'), { status: 0, code: 'NETWORK_OFFLINE' }), t)).toBe(
      t.queueNetworkError,
    );
  });

  it('reports a permission problem clearly', () => {
    expect(friendlyQueueActionError(Object.assign(new Error('x'), { status: 403, code: 'SALON_ACCESS_DENIED' }), t)).toBe(
      t.queueActionNotAllowedError,
    );
  });

  it('explains a stale entry (someone else acted first) instead of showing a state-machine error', () => {
    const err = Object.assign(new Error('This entry can no longer be assigned.'), {
      status: 409,
      code: 'INVALID_QUEUE_TRANSITION',
    });
    expect(friendlyQueueActionError(err, t)).toBe(t.queueEntryChangedError);
  });

  it("shows the backend's own message only for curated queue error codes", () => {
    const err = Object.assign(new Error('This chair is already occupied.'), { status: 409, code: 'CHAIR_ALREADY_OCCUPIED' });
    expect(friendlyQueueActionError(err, t)).toBe('This chair is already occupied.');
  });

  it('falls back to generic copy for anything unrecognised, including non-error throws', () => {
    expect(friendlyQueueActionError(new Error('boom'), t)).toBe(t.couldNotCompleteAction);
    expect(friendlyQueueActionError('weird', t)).toBe(t.couldNotCompleteAction);
    expect(friendlyQueueActionError(undefined, t)).toBe(t.couldNotCompleteAction);
  });

  it('localizes to Hindi', () => {
    const hi = uiStringsFor('HI');
    expect(friendlyQueueActionError(Object.assign(new Error('x'), { status: 0, code: 'NETWORK_OFFLINE' }), hi)).toBe(
      hi.queueNetworkError,
    );
    expect(hi.queueNetworkError).not.toBe(t.queueNetworkError);
  });
});
