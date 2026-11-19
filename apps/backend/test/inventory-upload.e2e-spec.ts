import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { strToU8, zipSync } from 'fflate';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
  gtinCheckDigit,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';

process.env.JWT_ACCESS_SECRET ??= 'inventory-upload-e2e-only-jwt-secret';
process.env.TOTP_ENCRYPTION_KEY ??=
  'inventory-upload-e2e-only-encryption-secret';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
let disposable = false;
try {
  const parsed = new URL(DATABASE_URL);
  disposable =
    ['127.0.0.1', 'localhost'].includes(parsed.hostname) &&
    ['owner_ops_chain', 'inventory_certification'].includes(
      parsed.pathname.replace(/^\//, ''),
    );
} catch {
  disposable = false;
}
const maybe = disposable ? describe : describe.skip;

/** A valid EAN-13 in the GS1 restricted-circulation range 2xx (never a real retail product). */
const run = Math.floor(Math.random() * 1e6)
  .toString()
  .padStart(6, '0');
let serial = 0;
function ean(): string {
  serial += 1;
  const body = `29${run}${String(serial).padStart(4, '0')}`;
  return `${body}${gtinCheckDigit(body)}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
/**
 * A minimal .xlsx built in the test (namespace-prefixed like OpenXML-SDK files, inline strings,
 * one picture per data row anchored in the "Barcode Image" column).
 */
function xlsx(rows: string[][], imageCol = -1): Buffer {
  const ns =
    'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><x:worksheet ${ns}><x:sheetData>${rows
    .map(
      (r, ri) =>
        `<x:row r="${ri + 1}">${r.map((v, ci) => (v === '' ? '' : `<x:c r="${col(ci)}${ri + 1}" t="inlineStr"><x:is><x:t>${esc(v)}</x:t></x:is></x:c>`)).join('')}</x:row>`,
    )
    .join(
      '',
    )}</x:sheetData>${imageCol >= 0 ? '<x:drawing r:id="rIdD"/>' : ''}</x:worksheet>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><x:workbook ${ns}><x:sheets><x:sheet name="Products" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  if (imageCol >= 0) {
    files['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdD" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    );
    const anchors = rows
      .slice(1)
      .map(
        (_, i) =>
          `<xdr:oneCellAnchor><xdr:from><xdr:col>${imageCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${i + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="1" cy="1"/><xdr:pic/><xdr:clientData/></xdr:oneCellAnchor>`,
      )
      .join('');
    files['xl/drawings/drawing1.xml'] = strToU8(
      `<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">${anchors}</xdr:wsDr>`,
    );
  }
  return Buffer.from(zipSync(files));
}
const csv = (rows: string[][]) =>
  Buffer.from(
    rows
      .map((r) =>
        r
          .map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
          .join(','),
      )
      .join('\n'),
  );

maybe('Inventory master upload (authenticated, disposable PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const names: Record<string, string> = {};

  const api = (
    method: 'get' | 'post' | 'patch',
    path: string,
    token: string,
    key?: string,
  ) => {
    const r = request(app.getHttpServer())
      [method](`/api/v1/${path}`)
      .set('Authorization', `Bearer ${token}`);
    if (key) r.set('Idempotency-Key', key);
    return r;
  };
  const preview = (
    file: Buffer,
    name: string,
    fields: Record<string, string> = {},
  ) => {
    const r = api('post', 'admin/inventory-uploads/preview', tok.admin);
    for (const [k, v] of Object.entries(fields)) r.field(k, v);
    return r.attach('file', file, name);
  };
  const commit = (jobId: string) =>
    api('post', `admin/inventory-uploads/${jobId}/commit`, tok.admin);
  const upload = async (
    file: Buffer,
    name: string,
    fields: Record<string, string> = {},
  ) => {
    const p = await preview(file, name, fields).expect(201);
    const c = await commit(p.body.jobId).expect(200);
    return { preview: p.body, job: c.body };
  };
  const inv = (salon: string) => `dashboard/salons/${ids[salon]}/inventory`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    const city = await prisma.city.findFirstOrThrow({
      where: { slug: 'jharsuguda' },
    });

    const admin = await prisma.user.create({
      data: {
        email: `upload-${run}-admin@example.test`,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.create({
      data: { userId: admin.id, role: Role.PLATFORM_ADMIN },
    });
    tok.admin = tokens.signAccessToken(
      admin.id,
      [Role.PLATFORM_ADMIN],
      SessionAudience.ADMIN,
    );
    const viewer = await prisma.user.create({
      data: {
        email: `upload-${run}-viewer@example.test`,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.create({
      data: { userId: viewer.id, role: Role.PLATFORM_VIEWER },
    });
    tok.viewer = tokens.signAccessToken(
      viewer.id,
      [Role.PLATFORM_VIEWER],
      SessionAudience.ADMIN,
    );

    // Two owners (A, B), plus two shops that share one name (for the ambiguity check).
    for (const [label, name] of [
      ['A', `Upload Alpha ${run}`],
      ['B', `Upload Beta ${run}`],
      ['D1', `Twin Salon ${run}`],
      ['D2', `Twin Salon ${run}`],
    ] as const) {
      const owner = await prisma.user.create({
        data: {
          email: `upload-${run}-${label}@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name,
          slug: `upload-${label.toLowerCase()}-${run}`,
          cityId: city.id,
          addressLine: 'Disposable',
          status: SalonStatus.ACTIVE,
          timezone: 'Asia/Kolkata',
          currency: 'INR',
        },
      });
      await prisma.userRole.create({
        data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id },
      });
      ids[label] = salon.id;
      names[label] = name;
      tok[label] = tokens.signAccessToken(
        owner.id,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const HEAD = [
    'Product ID',
    'Category',
    'Product Name',
    'Fictional Brand',
    'Variant / Size',
    'Unit',
    'EAN-13 Test Number',
    'Barcode Image',
    'Barcode Type',
    'Data Status',
  ];
  const g1 = ean();
  const g2 = ean();

  it('1. global upload (xlsx, namespaced, embedded barcode pictures): products created, no shop gets stock', async () => {
    const file = xlsx(
      [
        HEAD,
        [
          `T${run}-1`,
          'Hair Care',
          'Daily Shampoo',
          'Studio Sample',
          '100 ml',
          'unit',
          g1,
          '',
          'EAN-13',
          'FAKE / TEST ONLY',
        ],
        [
          `T${run}-2`,
          'Hair Care',
          'Keratin Shampoo',
          'BeautyMock',
          '250 ml',
          'pcs',
          g2,
          '',
          'EAN-13',
          'FAKE / TEST ONLY',
        ],
      ],
      7,
    );
    const { preview: p, job } = await upload(file, 'global.xlsx');
    expect(p.summary).toMatchObject({
      totalRows: 2,
      createGlobal: 2,
      errors: 0,
      embeddedImages: 2,
    });
    expect(p.rows[0]).toMatchObject({
      barcode: g1,
      symbology: 'EAN-13',
      isTestData: true,
      action: 'CREATE_GLOBAL',
    });
    expect(job).toMatchObject({
      status: 'COMPLETED',
      createdCount: 2,
      linkedCount: 0,
    });
    const product = await prisma.globalProduct.findFirstOrThrow({
      where: { barcodes: { some: { display: g1 } } },
      include: { barcodes: true },
    });
    expect(product).toMatchObject({
      visibility: 'GLOBAL',
      ownerSalonId: null,
      isTestData: true,
      externalRef: `T${run}-1`,
      variantText: '100 ml',
      verificationStatus: 'VERIFIED',
    });
    expect(product.barcodes[0].code).toBe(`0${g1}`);
    expect(
      await prisma.inventoryProduct.count({
        where: { globalProductId: product.id },
      }),
    ).toBe(0);
    // Every owner sees it in the catalog, none has it in stock.
    const browse = await api(
      'get',
      `${inv('B')}/catalog/browse?q=${g1}`,
      tok.B,
    ).expect(200);
    expect(browse.body.items).toHaveLength(1);
    expect(browse.body.items[0].inMyInventory).toEqual([]);
  });

  const s1 = ean();
  it('2. shop-specific upload: private to that shop', async () => {
    const { preview: p, job } = await upload(
      csv([
        ['Barcode', 'Product Name', 'Shop Name', 'Min Stock', 'Selling Price'],
        [s1, 'Alpha House Serum', names.A, '2', '450'],
      ]),
      'shop.csv',
    );
    expect(p.rows[0]).toMatchObject({
      action: 'CREATE_SHOP',
      shop: { id: ids.A },
    });
    expect(job).toMatchObject({ createdCount: 1, linkedCount: 1 });
    const gp = await prisma.globalProduct.findFirstOrThrow({
      where: { barcodes: { some: { display: s1 } } },
    });
    expect(gp).toMatchObject({ visibility: 'SHOP', ownerSalonId: ids.A });
    const assoc = await prisma.inventoryProduct.findFirstOrThrow({
      where: { salonId: ids.A, globalProductId: gp.id },
    });
    expect(assoc.stockOnHand.toFixed(3)).toBe('0.000');
    expect(assoc.reorderThreshold.toFixed(3)).toBe('2.000');
    expect(assoc.sellingPrice?.toFixed(2)).toBe('450.00');
    expect(
      (
        await api('get', `${inv('A')}/catalog/browse?q=${s1}`, tok.A).expect(
          200,
        )
      ).body.items,
    ).toHaveLength(1);
  });

  it('3. mixed file: global + shop rows, unknown / ambiguous / mismatched shops go to review, nothing auto-created', async () => {
    const m1 = ean();
    const m2 = ean();
    const m3 = ean();
    const m4 = ean();
    const salonsBefore = await prisma.salon.count();
    const { preview: p, job } = await upload(
      csv([
        ['EAN', 'Item Name', 'Salon Name', 'Shop ID'],
        [m1, 'Mixed Global Gel', '', ''],
        [m2, 'Mixed Beta Wax', names.B, ''],
        [m3, 'Mixed Unknown', `No Such Salon ${run}`, ''],
        [m4, 'Mixed Twin', names.D1, ''],
        [ean(), 'Mixed Mismatch', names.A, ids.B],
        ['2000000000016', 'Bad Check Digit', '', ''],
      ]),
      'mixed.csv',
    );
    expect(p.rows.map((r: { action: string }) => r.action)).toEqual([
      'CREATE_GLOBAL',
      'CREATE_SHOP',
      'REVIEW',
      'REVIEW',
      'REVIEW',
      'SKIP',
    ]);
    const codes = p.rows.map((r: { issues: Array<{ code: string }> }) =>
      r.issues.map((i) => i.code).join(','),
    );
    expect(codes.slice(2)).toEqual([
      'SHOP_NAME_UNKNOWN',
      'SHOP_NAME_AMBIGUOUS',
      'SHOP_ID_NAME_MISMATCH',
      'BARCODE_INVALID',
    ]);
    expect(job).toMatchObject({
      status: 'COMPLETED_WITH_ERRORS',
      createdCount: 2,
      reviewCount: 3,
      errorCount: 1,
    });
    expect(await prisma.salon.count()).toBe(salonsBefore);
    // Downloadable row report is formula-safe CSV.
    const report = await api(
      'get',
      `admin/inventory-uploads/${job.id}/errors.csv`,
      tok.admin,
    ).expect(200);
    expect(report.headers['content-type']).toMatch(/text\/csv/);
    expect(report.text).toContain('SHOP_NAME_UNKNOWN');
  });

  it('4. duplicate upload: re-import is a no-op, in-file duplicates are skipped, a job commits once', async () => {
    const file = xlsx([
      HEAD,
      [
        `T${run}-1`,
        'Hair Care',
        'Daily Shampoo',
        'Studio Sample',
        '100 ml',
        'unit',
        g1,
        '',
        'EAN-13',
        'FAKE / TEST ONLY',
      ],
      [
        `T${run}-1b`,
        'Hair Care',
        'Daily Shampoo',
        'Studio Sample',
        '100 ml',
        'unit',
        g1,
        '',
        'EAN-13',
        'FAKE / TEST ONLY',
      ],
    ]);
    const before = await prisma.globalProduct.count();
    const p = await preview(file, 'again.xlsx').expect(201);
    expect(p.body.rows.map((r: { action: string }) => r.action)).toEqual([
      'UNCHANGED',
      'SKIP',
    ]);
    expect(p.body.rows[1].issues[0].code).toBe('DUPLICATE_IN_FILE');
    await commit(p.body.jobId).expect(200);
    await commit(p.body.jobId).expect(409);
    expect(await prisma.globalProduct.count()).toBe(before);
    // A different name for an existing barcode never overwrites the master.
    const renamed = await preview(
      csv([
        ['Barcode', 'Name'],
        [g1, 'Totally Different Name'],
      ]),
      'rename.csv',
    ).expect(201);
    expect(renamed.body.rows[0].issues[0].code).toBe('NAME_DIFFERS');
    await commit(renamed.body.jobId).expect(200);
    expect(
      (
        await prisma.globalProduct.findFirstOrThrow({
          where: { barcodes: { some: { display: g1 } } },
        })
      ).name,
    ).toBe('Daily Shampoo');
  });

  it('5. barcode scan + QR: lookup by barcode finds the product; QR carries the product id', async () => {
    const look = await api(
      'get',
      `${inv('A')}/catalog/lookup?barcode=${g1}`,
      tok.A,
    ).expect(200);
    expect(look.body).toMatchObject({
      status: 'FOUND',
      product: { name: 'Daily Shampoo' },
    });
    const byQr = await api(
      'get',
      `${inv('A')}/catalog/browse?q=${encodeURIComponent(`fastque:product:${look.body.product.id}`)}`,
      tok.A,
    ).expect(200);
    expect(byQr.body.items.map((i: { id: string }) => i.id)).toEqual([
      look.body.product.id,
    ]);
  });

  it('6. unknown barcode: NOT_FOUND, and the salon can submit it for review', async () => {
    const unknown = ean();
    const look = await api(
      'get',
      `${inv('A')}/catalog/lookup?barcode=${unknown}`,
      tok.A,
    ).expect(200);
    expect(look.body.status).toBe('NOT_FOUND');
    await api('post', `${inv('A')}/catalog/change-requests`, tok.A)
      .send({ barcode: unknown, message: 'Please add this conditioner.' })
      .expect(201);
    const queue = await api(
      'get',
      'admin/catalog-change-requests?status=OPEN',
      tok.admin,
    ).expect(200);
    expect(
      queue.body.items.some((r: { barcode: string }) => r.barcode === unknown),
    ).toBe(true);
    await api(
      'get',
      `${inv('A')}/catalog/lookup?barcode=1234567890123`,
      tok.A,
    ).expect(400); // bad check digit
  });

  it('7. shop isolation: owner B never sees or uses owner A’s shop products', async () => {
    const browseB = await api(
      'get',
      `${inv('B')}/catalog/browse?q=${s1}`,
      tok.B,
    ).expect(200);
    expect(browseB.body.items).toHaveLength(0);
    const lookB = await api(
      'get',
      `${inv('B')}/catalog/lookup?barcode=${s1}`,
      tok.B,
    ).expect(200);
    expect(lookB.body.status).toBe('PENDING_ELSEWHERE');
    expect(lookB.body.product).toBeNull();
    const gp = await prisma.globalProduct.findFirstOrThrow({
      where: { barcodes: { some: { display: s1 } } },
    });
    await api('post', `${inv('B')}/catalog/add`, tok.B)
      .send({ globalProductId: gp.id })
      .expect(404);
    await api('get', `${inv('A')}/catalog/browse`, tok.B).expect(403);
    await api('get', `${inv('A')}/summary`, tok.B).expect(403);
    // A shop id in the body is not accepted (strict schemas) — the URL's salon, checked against the caller, is used.
    await api('post', `${inv('B')}/catalog/add`, tok.B)
      .send({ globalProductId: gp.id, salonId: ids.A })
      .expect(400);
    // Owners cannot reach admin upload routes; viewers can read but not upload.
    await api('get', 'admin/inventory-uploads', tok.B).expect(403);
    await api('get', 'admin/inventory-uploads', tok.viewer).expect(200);
    await api('post', 'admin/inventory-uploads/preview', tok.viewer)
      .attach(
        'file',
        csv([
          ['Barcode', 'Name'],
          [ean(), 'X'],
        ]),
        'x.csv',
      )
      .expect(403);
  });

  it('8. existing global product assigned to a shop: reuse it, add only that shop’s row; re-imports never change stock', async () => {
    const before = await prisma.globalProduct.count();
    const { preview: p, job } = await upload(
      csv([
        [
          'Barcode',
          'Product Name',
          'Shop Name',
          'Opening Quantity',
          'Cost Price',
        ],
        [g2, 'Keratin Shampoo', names.B, '6', '120'],
      ]),
      'assign.csv',
    );
    expect(p.rows[0]).toMatchObject({
      action: 'LINK_SHOP',
      shop: { id: ids.B },
    });
    expect(job).toMatchObject({ createdCount: 0, linkedCount: 1 });
    expect(await prisma.globalProduct.count()).toBe(before);
    const gp = await prisma.globalProduct.findFirstOrThrow({
      where: { barcodes: { some: { display: g2 } } },
    });
    expect(gp.visibility).toBe('GLOBAL');
    const row = await prisma.inventoryProduct.findFirstOrThrow({
      where: { salonId: ids.B, globalProductId: gp.id },
    });
    expect(row.stockOnHand.toFixed(3)).toBe('6.000');
    expect(row.averageUnitCost.toFixed(2)).toBe('120.00');
    expect(
      await prisma.inventoryProduct.count({
        where: { salonId: ids.A, globalProductId: gp.id },
      }),
    ).toBe(0);
    const again = await upload(
      csv([
        ['Barcode', 'Product Name', 'Shop Name', 'Opening Quantity'],
        [g2, 'Keratin Shampoo', names.B, '50'],
      ]),
      'assign-again.csv',
    );
    expect(again.preview.rows[0]).toMatchObject({ action: 'UNCHANGED' });
    expect(again.preview.rows[0].issues[0].code).toBe('STOCK_NOT_CHANGED');
    expect(
      (
        await prisma.inventoryProduct.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).stockOnHand.toFixed(3),
    ).toBe('6.000');
  });

  it('9. malformed files are rejected with a clear message and nothing is saved', async () => {
    const jobsBefore = await prisma.inventoryUploadJob.count();
    const bad = async (file: Buffer, name: string, code: string) => {
      const r = await preview(file, name).expect(400);
      expect(r.body.error.code).toBe(code);
    };
    await bad(
      Buffer.from('PK\u0003\u0004 this is not really a zip'),
      'broken.xlsx',
      'INVENTORY_UPLOAD_INVALID_FILE',
    );
    await bad(
      Buffer.from(zipSync({ 'hello.txt': strToU8('hi') })),
      'nobook.xlsx',
      'INVENTORY_UPLOAD_INVALID_FILE',
    );
    await bad(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]),
      'old.xls',
      'INVENTORY_UPLOAD_INVALID_FILE',
    );
    await bad(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]),
      'renamed.xlsx',
      'INVENTORY_UPLOAD_INVALID_FILE',
    );
    await bad(
      xlsx([
        ['foo', 'bar'],
        ['1', '2'],
      ]),
      'noheader.xlsx',
      'INVENTORY_UPLOAD_NO_HEADER',
    );
    await bad(
      csv([['Barcode', 'Name']]),
      'empty.csv',
      'INVENTORY_UPLOAD_EMPTY',
    );
    await bad(Buffer.from('x'), 'notes.pdf', 'INVENTORY_UPLOAD_INVALID_FILE');
    expect(await prisma.inventoryUploadJob.count()).toBe(jobsBefore);
    // Row-level problems (numbers Excel rounded, bad barcodes) are reported per row, not fatal.
    const rows = await preview(
      csv([
        ['Barcode', 'Name', 'MRP'],
        ['8.90123E+12', 'Rounded', '10'],
        [ean(), 'Price text', 'abc'],
      ]),
      'rows.csv',
    ).expect(201);
    expect(rows.body.summary.errors).toBe(2);
    await api(
      'post',
      `admin/inventory-uploads/${rows.body.jobId}/cancel`,
      tok.admin,
    ).expect(200);
  });

  it('10. concurrent stock deductions never go negative', async () => {
    const gp = await prisma.globalProduct.findFirstOrThrow({
      where: { barcodes: { some: { display: g1 } } },
    });
    const added = await api('post', `${inv('A')}/catalog/add`, tok.A)
      .send({ globalProductId: gp.id })
      .expect(201);
    const productId = added.body.product.id as string;
    await api('post', `${inv('A')}/catalog/add`, tok.A)
      .send({ globalProductId: gp.id })
      .expect(200); // idempotent
    await api(
      'post',
      `${inv('A')}/products/${productId}/movements`,
      tok.A,
      randomUUID(),
    )
      .send({ kind: 'OPENING', quantity: 5, unitCost: 10 })
      .expect(201);
    const race = await Promise.all(
      Array.from({ length: 8 }, () =>
        api(
          'post',
          `${inv('A')}/products/${productId}/movements`,
          tok.A,
          randomUUID(),
        ).send({ kind: 'CONSUMPTION', quantity: 1 }),
      ),
    );
    const statuses = race.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    // Rejected deductions are refused (409 insufficient stock) — or, under a burst larger than the
    // connection pool, fail to start a transaction at all. Either way nothing is written.
    expect(
      statuses.filter((s) => s !== 201).every((s) => s === 409 || s === 500),
    ).toBe(true);
    expect(statuses.filter((s) => s === 409).length).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.inventoryMovement.count({
        where: { productId, kind: 'CONSUMPTION' },
      }),
    ).toBe(5);
    console.log(`concurrent deduction statuses: ${statuses.join(',')}`);
    const state = await prisma.inventoryProduct.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(state.stockOnHand.toFixed(3)).toBe('0.000');
    const summary = await api('get', `${inv('A')}/summary`, tok.A).expect(200);
    expect(summary.body).toMatchObject({ outOfStock: expect.any(Number) });
    expect(summary.body.recentTransactions[0].transactionType).toBe(
      'SERVICE_CONSUMPTION',
    );
    const stats = await api(
      'get',
      'admin/inventory-master/stats',
      tok.viewer,
    ).expect(200);
    expect(stats.body.shopProducts).toBeGreaterThanOrEqual(2);
    expect(stats.body.testDataProducts).toBeGreaterThanOrEqual(2);
  });
});
