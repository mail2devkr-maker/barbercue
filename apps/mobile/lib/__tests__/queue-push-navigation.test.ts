import {
  parseQueueArrivalPushData,
  requestQueueArrivalNavigation,
  subscribeQueueArrivalNavigation,
} from '../queue-push-navigation';

describe('Live Queue arrival OS push handling', () => {
  const queue = { type: 'queue.arrival_check' as const, salonId: 's1', queueEntryId: 'q1' };

  it('accepts only complete IDs-only queue notification payloads', () => {
    expect(parseQueueArrivalPushData(queue)).toEqual(queue);
    expect(parseQueueArrivalPushData({ ...queue, queueEntryId: '' })).toBeNull();
    expect(parseQueueArrivalPushData({ ...queue, salonId: '' })).toBeNull();
    expect(parseQueueArrivalPushData({ ...queue, type: 'booking.arrival_check' })).toBeNull();
    expect(parseQueueArrivalPushData(null)).toBeNull();
  });

  it('replays a cold-start owner push only to an owner listener', () => {
    requestQueueArrivalNavigation('owner', queue);
    const customer = jest.fn().mockReturnValue(true);
    const stopCustomer = subscribeQueueArrivalNavigation('customer', customer);
    expect(customer).not.toHaveBeenCalled();

    const owner = jest.fn().mockReturnValue(true);
    const stopOwner = subscribeQueueArrivalNavigation('owner', owner);
    expect(owner).toHaveBeenCalledWith(queue);
    stopOwner();
    stopCustomer();
  });

  it('does not consume a pending push before navigation is ready', () => {
    const notReady = jest.fn().mockReturnValue(false);
    const stopFirst = subscribeQueueArrivalNavigation('customer', notReady);
    requestQueueArrivalNavigation('customer', queue);
    expect(notReady).toHaveBeenCalledWith(queue);
    stopFirst();
    const ready = jest.fn().mockReturnValue(true);
    const stopReady = subscribeQueueArrivalNavigation('customer', ready);
    expect(ready).toHaveBeenCalledWith(queue);
    stopReady();
  });
});
