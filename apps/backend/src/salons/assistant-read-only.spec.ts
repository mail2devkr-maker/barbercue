import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Owner issue #16: neither assistant may book, pay, message or otherwise change anything. They search/report and
 * point the person at the normal confirmation flow. (The customer search is a POST only because it carries a body.) This is a source-level guard: if someone adds a write to either
 * service, this fails and the change has to be argued for deliberately.
 */
const FILES = [
  join(__dirname, 'customer-assistant-search.service.ts'),
  join(__dirname, 'customer-assistant-search.controller.ts'),
  join(__dirname, '..', 'owner-ops', 'owner-assistant.service.ts'),
];

const WRITES = [
  /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
  /\$executeRaw/,
  /\$transaction/,
  /BookingsService|PaymentsService|NotificationsService|QueueService/,
];

describe('assistants never change data (owner issue #16)', () => {
  it.each(FILES)('%s has no write, payment, notification or booking dependency', (file) => {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const pattern of WRITES) expect(source).not.toMatch(pattern);
  });

  it('the guard can fail: it recognises a write when one is present', () => {
    const sample = 'await this.prisma.booking.create({ data })';
    expect(WRITES.some((p) => p.test(sample))).toBe(true);
  });
});
