
// Synthetic, stored (uncompressed) OOXML ZIP with two worksheets. No external workbook/PII.
function miniXlsx(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [filename, text] of Object.entries(entries)) {
    const name = Buffer.from(filename), body = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

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


  it('reads services from every worksheet including shared-string cells', async () => {
    const header = '<row r="1"><c r="A1" t="inlineStr"><is><t>Service</t></is></c><c r="B1" t="inlineStr"><is><t>Price</t></is></c><c r="C1" t="inlineStr"><is><t>Duration</t></is></c></row>';
    const first = '<row r="2"><c r="A2" t="inlineStr"><is><t>Hair Spa</t></is></c><c r="B2"><v>450</v></c><c r="C2"><v>45</v></c></row>';
    const second = '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><v>700</v></c><c r="C2"><v>60</v></c></row>';
    const book = miniXlsx({
      'xl/sharedStrings.xml': '<sst><si><t>Facial</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData>' + header + first + '</sheetData></worksheet>',
      'xl/worksheets/sheet2.xml': '<worksheet><sheetData>' + header + second + '</sheetData></worksheet>',
    });
    const preview = await subject.preview('actor', 'salon', file('salon.xlsx', book), false);
    expect(preview.services).toEqual([
      { name: 'Hair Spa', price: 450, durationMinutes: 45, category: '', description: '', source: 'salon.xlsx / sheet1.xml' },
      { name: 'Facial', price: 700, durationMinutes: 60, category: '', description: '', source: 'salon.xlsx / sheet2.xml' },
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects malformed XLSX safely', () => {
    expect(() => parseXlsxTables(Buffer.from('PK fake archive'))).toThrow();
  });
});
