
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

import { CATALOG_IMPORT_ADVISORY_LOCK_SQL, ServiceCatalogImportService, parseXlsxTables } from './service-catalog-import.service';

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
      'menu.csv', 'Service,Price,Duration,Category,Subcategory\nHaircut,150,30 min,Hair,Haircut\nFacial,500,,Face,Facial treatment',
    ), false);
    expect(preview.services).toEqual([
      { name: 'Haircut', price: 150, durationMinutes: 30, category: 'Hair', subcategory: 'Haircut', description: '', source: 'menu.csv' },
      { name: 'Facial', price: 500, durationMinutes: null, category: 'Face', subcategory: 'Facial treatment', description: '', source: 'menu.csv' },
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('recognizes a subcategory-only CSV column without treating its header as a service', async () => {
    const preview = await subject.preview('actor', 'salon', file(
      'taxonomy.csv', 'Service,Subcategory\nBeard Trim,Shaping',
    ), false);
    expect(preview.services).toEqual([expect.objectContaining({
      name: 'Beard Trim', category: '', subcategory: 'Shaping',
      price: null, durationMinutes: null,
    })]);
  });

  it('preserves reviewed subcategory data during catalog import', async () => {
    const service = {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'new' }),
    };
    const salonServiceCategory = {
      upsert: jest.fn().mockImplementation(({ create }) => ({ id: 'category-hair', name: create.name })),
    };
    const salonServiceSubcategory = {
      upsert: jest.fn().mockImplementation(({ create }) => ({ id: 'subcategory-' + create.normalizedName, name: create.name })),
    };
    prisma.$transaction.mockImplementation(async (task: (tx: unknown) => Promise<unknown>) => task({
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      service,
      salonServiceCategory,
      salonServiceSubcategory,
      auditLog: { create: jest.fn() },
    }));
    await subject.saveReviewed('actor', 'salon', { services: [
      { name: 'Balayage', category: 'Hair', subcategory: 'Coloring', price: 1200, durationMinutes: 90 },
      { name: 'Haircut', category: 'Hair', subcategory: '', price: 250, durationMinutes: 30 },
    ] });
    expect(service.create).toHaveBeenCalledTimes(2);
    expect(service.create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({
      category: 'Hair', subcategory: 'Coloring',
      categoryId: 'category-hair', subcategoryId: 'subcategory-coloring',
    }) });
    expect(service.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({
      category: 'Hair', subcategory: null, categoryId: 'category-hair', subcategoryId: null,
    }) });
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
    const acquireLock = jest.fn().mockResolvedValue(1);
    prisma.$transaction.mockImplementation(async (task: (tx: unknown) => Promise<unknown>) => task({
      $executeRawUnsafe: acquireLock,
      service,
      auditLog,
    }));
    const result = await subject.saveReviewed('actor', 'salon', { services: [
      { name: 'Haircut', price: 150, durationMinutes: 30 },
      { name: 'Facial', price: 500, durationMinutes: 45 },
    ] });
    expect(result).toMatchObject({ createdCount: 1, skippedCount: 1 });
    expect(service.create).toHaveBeenCalledTimes(1);
    // Real pg_advisory_xact_lock returns void. The backend must not use Prisma
    // queryRaw to decode its result; executeRaw invokes it without deserializing.
    expect(acquireLock).toHaveBeenCalledTimes(1);
    expect(acquireLock).toHaveBeenCalledWith(CATALOG_IMPORT_ADVISORY_LOCK_SQL, 'salon');
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
      { name: 'Hair Spa', price: 450, durationMinutes: 45, category: '', subcategory: '', description: '', source: 'salon.xlsx / sheet1.xml' },
      { name: 'Facial', price: 700, durationMinutes: 60, category: '', subcategory: '', description: '', source: 'salon.xlsx / sheet2.xml' },
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reads prefixed Excel XML while ignoring cover sheets, title rows and identical review duplicates', async () => {
    // Mirrors an exported FastQue review workbook: XML namespace prefixes, a cover
    // worksheet, an editable review worksheet and a canonical upload preview.
    const txt = (ref: string, value: string) =>
      `<x:c r="${ref}" t="inlineStr"><x:is><x:t>${value}</x:t></x:is></x:c>`;
    const num = (ref: string, value: number) =>
      `<x:c r="${ref}"><x:v>${value}</x:v></x:c>`;
    const row = (index: number, ...cells: string[]) =>
      `<x:row r="${index}">${cells.join('')}</x:row>`;
    const sheet = (...rows: string[]) =>
      `<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${rows.join('')}</x:sheetData></x:worksheet>`;
    const book = miniXlsx({
      'xl/worksheets/sheet1.xml': sheet(
        row(1, txt('A1', 'FastQue Catalog Mapping - Review Only')),
        row(4, txt('A4', 'Salon (printed)'), txt('B4', 'Glow and Gaze')),
      ),
      'xl/worksheets/sheet2.xml': sheet(
        row(1, txt('A1', 'PHOTO-TRANSCRIBED SERVICES - EDIT BEFORE IMPORT')),
        row(3, txt('A3', '#'), txt('B3', 'Category'), txt('C3', 'Service name'),
          txt('D3', 'Catalog min ₹'), txt('E3', 'Catalog max ₹'),
          txt('F3', 'Exact import ₹'), txt('G3', 'Duration min')),
        row(4, num('A4', 1), txt('B4', 'Facial Treatment'),
          txt('C4', 'Hydra Facial Advance'), num('D4', 4999), num('F4', 4999)),
        row(5, num('A5', 2), txt('B5', 'Facial Treatment'),
          txt('C5', 'Kanpeki Facial'), num('D5', 2499), num('E5', 3999)),
      ),
      'xl/worksheets/sheet3.xml': sheet(
        row(1, txt('A1', 'Name'), txt('B1', 'Price'),
          txt('C1', 'Duration Minutes'), txt('D1', 'Category'),
          txt('E1', 'Description')),
        row(2, txt('A2', 'Hydra Facial Advance'), num('B2', 4999),
          txt('D2', 'Facial Treatment')),
        row(3, txt('A3', 'Kanpeki Facial'), txt('D3', 'Facial Treatment'),
          txt('E3', 'Range ₹2499-₹3999: exact price not approved')),
      ),
    });
    const preview = await subject.preview('actor', 'salon', file('report.xlsx', book), false);
    expect(preview.services.map((item) => ({
      name: item.name, price: item.price,
      durationMinutes: item.durationMinutes, category: item.category,
    }))).toEqual([
      { name: 'Hydra Facial Advance', price: 4999, durationMinutes: null, category: 'Facial Treatment' },
      { name: 'Kanpeki Facial', price: null, durationMinutes: null, category: 'Facial Treatment' },
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to invent service rows from a summary-only Excel workbook', async () => {
    const book = miniXlsx({
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Salon name</t></is></c>' +
        '<c r="B1" t="inlineStr"><is><t>Example salon</t></is></c></row></sheetData></worksheet>',
    });
    await expect(subject.preview('actor', 'salon', file('summary.xlsx', book), false))
      .rejects.toThrow(/No Excel service table found/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects malformed XLSX safely', () => {
    expect(() => parseXlsxTables(Buffer.from('PK fake archive'))).toThrow();
  });

  it('checks per-salon access and reports OCR availability without exposing credentials', async () => {
    const previous = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      await expect(subject.capabilities('actor', 'salon')).resolves.toEqual({
        pdfPhotoOcrAvailable: false,
      });
      process.env.GEMINI_API_KEY = 'synthetic-key-not-real';
      await expect(subject.capabilities('actor', 'salon')).resolves.toEqual({
        pdfPhotoOcrAvailable: true,
      });
      expect(access.assertOwnerOrAdminAccess).toHaveBeenCalledWith('actor', 'salon');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });

  it('does not disclose OCR status to unauthorized salon users', async () => {
    access.assertOwnerOrAdminAccess.mockRejectedValueOnce(new Error('Access denied'));
    await expect(subject.capabilities('outsider', 'salon')).rejects.toThrow('Access denied');
  });
});
