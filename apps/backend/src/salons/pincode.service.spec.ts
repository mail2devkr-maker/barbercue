import type { PrismaService } from '../prisma/prisma.service';
import { PincodeService } from './pincode.service';

const offices = [
  { Name: 'Gomtinagar', District: 'Lucknow', State: 'Uttar Pradesh' },
];
const lucknow = {
  id: 'c1',
  name: 'Lucknow',
  slug: 'lucknow',
  countryCode: 'IN',
  state: 'Uttar Pradesh',
  population: 1,
  regionRef: { id: 'r', name: 'Uttar Pradesh', code: 'UP' },
};
function make(rows: unknown[], fetcher: jest.Mock) {
  const s = new PincodeService({
    city: { findMany: jest.fn().mockResolvedValue(rows) },
  } as unknown as PrismaService);
  s.fetcher = fetcher;
  return s;
}
const ok = (body: unknown) =>
  jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });

describe('PincodeService', () => {
  it('returns district, state and the FastQue city in the same state, and caches', async () => {
    const f = ok([{ PostOffice: offices }]);
    const s = make([{ ...lucknow, id: 'x', state: 'Other', regionRef: null }, lucknow], f);
    const r = await s.lookup('226010');
    expect(r).toMatchObject({
      district: 'Lucknow',
      state: 'Uttar Pradesh',
      city: { id: 'c1', region: { name: 'Uttar Pradesh' } },
    });
    await s.lookup('226010');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('never throws: bad PINs, unknown PINs and outages are just null', async () => {
    const f = jest.fn().mockRejectedValue(new Error('down'));
    const s = make([], f);
    expect(await s.lookup('../x')).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(await s.lookup('226010')).toBeNull();
    expect(await make([], ok([{ PostOffice: null }])).lookup('999999')).toBeNull();
  });
});
