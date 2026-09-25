import { SiteMetricsService } from './site-metrics.service';

describe('SiteMetricsService', () => {
  const createMany = jest.fn();
  const prisma = { siteVisitor: { createMany } } as any;
  let service: SiteMetricsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SiteMetricsService(prisma);
  });

  it('records one hashed visitor key and never stores the raw browser UUID', async () => {
    createMany.mockResolvedValue({ count: 1 });
    const id = '8d9e8c2a-f3aa-4d02-a03b-cf7e0afc4e19';

    await expect(
      service.recordUniqueVisitor(
        id,
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0',
      ),
    ).resolves.toBe(true);

    expect(createMany).toHaveBeenCalledTimes(1);
    const call = createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data[0].visitorKey).toHaveLength(64);
    expect(call.data[0].visitorKey).not.toContain(id);
  });

  it('returns false when the browser was already counted', async () => {
    createMany.mockResolvedValue({ count: 0 });

    await expect(
      service.recordUniqueVisitor(
        '8d9e8c2a-f3aa-4d02-a03b-cf7e0afc4e19',
        'Mozilla/5.0 Safari/605.1.15',
      ),
    ).resolves.toBe(false);
  });

  it('does not count obvious bots', async () => {
    await expect(
      service.recordUniqueVisitor(
        '8d9e8c2a-f3aa-4d02-a03b-cf7e0afc4e19',
        'Googlebot/2.1',
      ),
    ).resolves.toBe(false);

    expect(createMany).not.toHaveBeenCalled();
  });
});
