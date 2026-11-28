import {
  DEFAULT_SERVICE_BUFFER_MINUTES,
  MAX_QUEUE_ADD_ONS,
  SERVICE_BUFFER_CHOICES,
  SERVICE_BUFFER_MAX_MINUTES,
  addQueueEntryAddOnSchema,
  serviceBufferSchema,
} from '../schemas';
import { DASHBOARD_PATHS } from '../constants';
import { QueueErrorCode } from '../enums';

// Live-visit add-on mission (17 Nov 2026).
describe('addQueueEntryAddOnSchema', () => {
  it('accepts exactly one service id', () => {
    expect(addQueueEntryAddOnSchema.safeParse({ serviceId: '22222222-2222-2222-2222-222222222222' }).success).toBe(true);
  });

  it('rejects a missing or malformed service id', () => {
    expect(addQueueEntryAddOnSchema.safeParse({}).success).toBe(false);
    expect(addQueueEntryAddOnSchema.safeParse({ serviceId: 'beard' }).success).toBe(false);
  });
});

describe('serviceBufferSchema', () => {
  it('accepts whole minutes from 0 to the maximum', () => {
    for (const minutes of [0, 5, 10, 15, SERVICE_BUFFER_MAX_MINUTES]) {
      expect(serviceBufferSchema.safeParse({ serviceBufferMinutes: minutes }).success).toBe(true);
    }
  });

  it('rejects negative, fractional, too large or non-numeric values', () => {
    for (const minutes of [-1, 2.5, SERVICE_BUFFER_MAX_MINUTES + 1, '10', null]) {
      expect(serviceBufferSchema.safeParse({ serviceBufferMinutes: minutes }).success).toBe(false);
    }
  });

  it('offers only valid choices, including the default and "none"', () => {
    for (const minutes of SERVICE_BUFFER_CHOICES) {
      expect(serviceBufferSchema.safeParse({ serviceBufferMinutes: minutes }).success).toBe(true);
    }
    expect(SERVICE_BUFFER_CHOICES).toContain(0);
    expect(SERVICE_BUFFER_CHOICES).toContain(DEFAULT_SERVICE_BUFFER_MINUTES);
  });
});

describe('live-visit add-on contract', () => {
  it('exposes stable paths, limits and error codes', () => {
    expect(DASHBOARD_PATHS.addOns).toBe('add-ons');
    expect(DASHBOARD_PATHS.serviceBuffer).toBe('service-buffer');
    expect(MAX_QUEUE_ADD_ONS).toBe(5);
    expect(QueueErrorCode.QUEUE_CLOSED).toBe('QUEUE_CLOSED');
    expect(QueueErrorCode.QUEUE_CLOSING).toBe('QUEUE_CLOSING');
    expect(QueueErrorCode.ADD_ON_NOT_ALLOWED).toBe('ADD_ON_NOT_ALLOWED');
    expect(QueueErrorCode.ADD_ON_DUPLICATE).toBe('ADD_ON_DUPLICATE');
    expect(QueueErrorCode.ADD_ON_LIMIT).toBe('ADD_ON_LIMIT');
  });
});
