import { ServiceCatalogImportService, parseXlsxTables } from './service-catalog-import.service';

describe('ServiceCatalogImportService', () => {
  const access = { assertOwnerOrAdminAccess: jest.fn().mockResolvedValue('OWNER') };
  const prisma = { $transaction: jest.fn() };
  let subject: ServiceCatalogImportService;
  beforeEach(() => {
    jest.clearAllMocks();
    access.assertOwnerOrAdminAccess.mockResolvedValue('OWNER');
    subject = new ServiceCatalogImportService(prisma as never, access as never);
  });
  const file = (name: string, data: string | Buffer) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return { originalname: name, buffer, size: buffer.length } as Express.Multer.File;
  };

  it('extracts CSV rows and never invents missing duration', async () => {
    const preview = await subject.preview('actor', 'salon', file(
      'menu.csv', 'Service,Price,Duration,Category\nHaircut,150,30 min,Hair\nFacial,500,,Face',
    ), false);
    expect(preview.services).toEqual([
      { name: 'Haircut', price: 150, durationMinutes: 30, category: 'Hair', description: '', source: 'menu.csv' },
      { name: 'Facial', price: 500, durationMinutes: null, category: 'Face', description: '', source: 'menu.csv' },
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects disguised image content before OCR and always checks salon access', async () => {
    await expect(subject.preview('actor', 'salon', file('menu.jpg', 'not a jpeg'), true))
      .rejects.toThrow(/Supported formats/);
    expect(access.assertOwnerOrAdminAccess).toHaveBeenCalledWith('actor', 'salon');
  });

  it('rejects photo extraction without explicit external AI consent', async () => {
    const jpg = file('menu.jpg', Buffer.from([255, 216, 255, 217]));
    await expect(subject.preview('actor', 'salon', jpg, false)).rejects.toThrow(/confirm/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid imports and duplicated candidates without mutating database', async () => {
    await expect(subject.saveReviewed('actor', 'salon', { services: [
      { name: 'Haircut', price: 150, durationMinutes: null },
    ] })).rejects.toThrow(/valid name, price and duration/);
    await expect(subject.saveReviewed('actor', 'salon', { services: [
      { name: 'Haircut', price: 150, durationMinutes: 30 },
      { name: 'Haircut', price: 200, durationMinutes: 40 },
    ] })).rejects.toThrow(/only one copy/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('atomically skips existing services while creating only new ones', async () => {
    const service = {
      findMany: jest.fn().mockResolvedValue([{ name: 'Haircut', category: null }]),
      create: jest.fn().mockResolvedValue({ id: 'new' }),
    };
    const auditLog = { create: jest.fn() };
    prisma.$transaction.mockImplementation(async (task: (tx: unknown) => Promise<unknown>) => task({
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      service,
      auditLog,
    }));
    const result = await subject.saveReviewed('actor', 'salon', { services: [
      { name: 'Haircut', price: 150, durationMinutes: 30 },
      { name: 'Facial', price: 500, durationMinutes: 45 },
    ] });
    expect(result).toMatchObject({ createdCount: 1, skippedCount: 1 });
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      salonId: 'salon', name: 'Facial', durationMinutes: 45, price: '500',
    }) });
  });

  it('rejects malformed XLSX safely', () => {
    expect(() => parseXlsxTables(Buffer.from('PK fake archive'))).toThrow();
  });
});
