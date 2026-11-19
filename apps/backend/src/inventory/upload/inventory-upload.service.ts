import { createHash } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  INVENTORY_UPLOAD_MAX_ROWS,
  INVENTORY_UPLOAD_PREVIEW_ROWS,
  INVENTORY_UPLOAD_TEMPLATE_HEADERS,
  InventoryUploadStatus,
  UPLOAD_FIELD_LABELS,
  csvSafeCell,
  detectUploadHeader,
  normalizeShopName,
  normalizeUploadRow,
  type InventoryMasterStatsDto,
  type InventoryUploadIssueDto,
  type InventoryUploadIssuesQuery,
  type InventoryUploadJobDto,
  type InventoryUploadListQuery,
  type InventoryUploadPreviewDto,
  type InventoryUploadPreviewInput,
  type InventoryUploadSummaryDto,
  type InventoryPageDto,
  type UploadIssue,
  type UploadRowAction,
  type UploadRowCandidate,
  type UploadRowPreviewDto,
} from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeProductName } from '../product-catalog.service';
import { readSpreadsheet } from './spreadsheet-reader';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lets Excel open the downloaded CSV as UTF-8 (₹, non-English names). */
const UTF8_BOM = String.fromCharCode(0xfeff);

type ExistingProduct = {
  id: string;
  name: string;
  normalizedName: string;
  visibility: 'GLOBAL' | 'SHOP';
  ownerSalonId: string | null;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  isTestData: boolean;
  externalRef: string | null;
  barcodeCodes: string[];
};
type ShopRef = { id: string; name: string };

/** One row's decision. `productKey` ties rows of the same product within the file together. */
export interface ResolvedRow {
  candidate: UploadRowCandidate;
  action: UploadRowAction;
  /** Also add the shop association (CREATE_GLOBAL from a shop row, LINK_SHOP). */
  linkShop: boolean;
  shop: ShopRef | null;
  existingProductId: string | null;
  productKey: string | null;
  issues: UploadIssue[];
}

interface ResolveContext {
  byCode: Map<string, ExistingProduct>;
  byRef: Map<string, ExistingProduct>;
  shopsById: Map<string, ShopRef>;
  shopsByName: Map<string, ShopRef[]>;
  /** `${salonId}|${globalProductId}` pairs that already have a salon inventory row. */
  associations: Set<string>;
  blockTestData: boolean;
}

function issue(
  severity: UploadIssue['severity'],
  code: string,
  message: string,
  field: UploadIssue['field'] = null,
  rawValue: string | null = null,
): UploadIssue {
  return { severity, code, message, field, rawValue };
}

/**
 * Pure decision step shared by preview and commit (commit re-runs it against the database as it is
 * at commit time, so a preview can never import stale decisions). Identity is the barcode (as a
 * normalized GTIN / code) or, without one, the file's product code — never the name.
 */
export function resolveUploadRows(
  candidates: UploadRowCandidate[],
  ctx: ResolveContext,
): ResolvedRow[] {
  const planned = new Map<
    string,
    {
      rowNumber: number;
      normalizedName: string;
      visibility: 'GLOBAL' | 'SHOP';
      ownerSalonId: string | null;
    }
  >();
  const seen = new Map<string, number>();
  return candidates.map((candidate): ResolvedRow => {
    const issues: UploadIssue[] = [...candidate.issues];
    const out = (
      action: UploadRowAction,
      extra: Partial<ResolvedRow> = {},
    ): ResolvedRow => ({
      candidate,
      action,
      linkShop: false,
      shop: null,
      existingProductId: null,
      productKey: null,
      issues,
      ...extra,
    });
    if (candidate.issues.some((i) => i.severity === 'ERROR'))
      return out('SKIP');

    // 1. Which shop (if any). Names must match exactly one existing salon; never auto-created.
    let shop: ShopRef | null = null;
    if (candidate.shopId || candidate.shopName) {
      const byId = candidate.shopId
        ? (ctx.shopsById.get(candidate.shopId) ??
          ctx.shopsById.get(candidate.shopId.toUpperCase()) ??
          ctx.shopsById.get(candidate.shopId.toLowerCase()))
        : undefined;
      const byName = candidate.shopName
        ? (ctx.shopsByName.get(normalizeShopName(candidate.shopName)) ?? [])
        : [];
      if (candidate.shopId && !byId) {
        issues.push(
          issue(
            'REVIEW',
            'SHOP_ID_UNKNOWN',
            `No FastQue shop has the ID "${candidate.shopId}". Shops are never created by an upload.`,
            'shop_id',
            candidate.shopId,
          ),
        );
        return out('REVIEW');
      }
      if (byId && candidate.shopName && !byName.some((s) => s.id === byId.id)) {
        issues.push(
          issue(
            'REVIEW',
            'SHOP_ID_NAME_MISMATCH',
            `Shop ID "${candidate.shopId}" belongs to "${byId.name}", not "${candidate.shopName}".`,
            'shop_name',
            candidate.shopName,
          ),
        );
        return out('REVIEW');
      }
      if (byId) shop = byId;
      else if (byName.length === 1) shop = byName[0];
      else if (byName.length > 1) {
        issues.push(
          issue(
            'REVIEW',
            'SHOP_NAME_AMBIGUOUS',
            `${byName.length} shops are called "${candidate.shopName}". Add a Shop ID column to say which one.`,
            'shop_name',
            candidate.shopName,
          ),
        );
        return out('REVIEW');
      } else {
        issues.push(
          issue(
            'REVIEW',
            'SHOP_NAME_UNKNOWN',
            `No FastQue shop is called "${candidate.shopName}". Check the spelling or add the Shop ID. Shops are never created by an upload.`,
            'shop_name',
            candidate.shopName,
          ),
        );
        return out('REVIEW');
      }
    }

    if (candidate.isTestData && ctx.blockTestData) {
      issues.push(
        issue(
          'REVIEW',
          'TEST_DATA_BLOCKED',
          'Test/sample rows are not imported in production without explicit approval (INVENTORY_ALLOW_TEST_DATA_IMPORT).',
        ),
      );
      return out('REVIEW', { shop });
    }

    // 2. Identity: barcode first, product code otherwise.
    const code = candidate.barcode?.code ?? null;
    const ref = candidate.productRef;
    const productKey = code ? `b:${code}` : `r:${ref!.toUpperCase()}`;
    const dupKey = `${productKey}|${shop?.id ?? 'GLOBAL'}`;
    const firstRow = seen.get(dupKey);
    if (firstRow !== undefined) {
      issues.push(
        issue(
          'WARNING',
          'DUPLICATE_IN_FILE',
          `Same product${shop ? ' and shop' : ''} as row ${firstRow}; this row is skipped.`,
          code ? 'barcode' : 'product_ref',
          candidate.barcode?.display ?? ref,
        ),
      );
      return out('SKIP', { shop, productKey });
    }
    seen.set(dupKey, candidate.rowNumber);

    const byCode = code ? ctx.byCode.get(code) : undefined;
    const byRef = ref ? ctx.byRef.get(ref.toUpperCase()) : undefined;
    if (byCode && byRef && byCode.id !== byRef.id) {
      issues.push(
        issue(
          'REVIEW',
          'PRODUCT_CODE_CONFLICT',
          `Barcode belongs to "${byCode.name}" but product code ${ref} belongs to "${byRef.name}".`,
          'product_ref',
          ref,
        ),
      );
      return out('REVIEW', { shop, productKey });
    }
    if (!byCode && byRef && code && !byRef.barcodeCodes.includes(code)) {
      issues.push(
        issue(
          'REVIEW',
          'PRODUCT_CODE_OTHER_BARCODE',
          `Product code ${ref} is already used by "${byRef.name}" with a different barcode. Variants need their own product code.`,
          'product_ref',
          ref,
        ),
      );
      return out('REVIEW', { shop, productKey });
    }
    const existing = byCode ?? (code ? undefined : byRef);
    const normalizedName = normalizeProductName(candidate.name ?? '');
    const wantsShopOnly = !!shop && candidate.visibility !== 'GLOBAL';

    if (existing) {
      if (existing.verificationStatus === 'REJECTED') {
        issues.push(
          issue(
            'REVIEW',
            'MASTER_REJECTED',
            `This barcode belongs to "${existing.name}", which was rejected in the catalog.`,
            'barcode',
          ),
        );
        return out('REVIEW', {
          shop,
          productKey,
          existingProductId: existing.id,
        });
      }
      if (existing.verificationStatus === 'PENDING') {
        issues.push(
          issue(
            'REVIEW',
            'MASTER_PENDING',
            `A salon submitted this barcode ("${existing.name}") and it awaits review in Product Catalog. Verify or reject it there first.`,
            'barcode',
          ),
        );
        return out('REVIEW', {
          shop,
          productKey,
          existingProductId: existing.id,
        });
      }
      if (candidate.isTestData && !existing.isTestData) {
        issues.push(
          issue(
            'REVIEW',
            'TEST_BARCODE_COLLIDES',
            `This test barcode is already used by the real catalog product "${existing.name}". Test data is never attached to real products.`,
            'barcode',
            candidate.barcode?.display ?? null,
          ),
        );
        return out('REVIEW', {
          shop,
          productKey,
          existingProductId: existing.id,
        });
      }
      if (
        existing.visibility === 'SHOP' &&
        (!shop || shop.id !== existing.ownerSalonId)
      ) {
        issues.push(
          issue(
            'REVIEW',
            'SHOP_PRODUCT_CONFLICT',
            `This barcode is a shop-only product of another shop ("${existing.name}"). An admin must decide whether to make it global.`,
            'barcode',
          ),
        );
        return out('REVIEW', {
          shop,
          productKey,
          existingProductId: existing.id,
        });
      }
      if (candidate.name && normalizedName !== existing.normalizedName)
        issues.push(
          issue(
            'WARNING',
            'NAME_DIFFERS',
            `The catalog already has this barcode as "${existing.name}"; the catalog name is kept (names never overwrite).`,
            'name',
            candidate.name,
          ),
        );
      if (shop) {
        if (ctx.associations.has(`${shop.id}|${existing.id}`)) {
          if (candidate.quantity)
            issues.push(
              issue(
                'WARNING',
                'STOCK_NOT_CHANGED',
                'The shop already has this product; re-imports never change stock quantities.',
                'quantity',
              ),
            );
          return out('UNCHANGED', {
            shop,
            productKey,
            existingProductId: existing.id,
          });
        }
        return out('LINK_SHOP', {
          shop,
          productKey,
          existingProductId: existing.id,
          linkShop: true,
        });
      }
      if (candidate.quantity)
        issues.push(
          issue(
            'WARNING',
            'QUANTITY_WITHOUT_SHOP',
            'Opening quantity is ignored for rows without a shop.',
            'quantity',
          ),
        );
      return out('UNCHANGED', { productKey, existingProductId: existing.id });
    }

    const earlier = planned.get(productKey);
    if (earlier) {
      if (earlier.normalizedName !== normalizedName) {
        issues.push(
          issue(
            'REVIEW',
            'BARCODE_NAME_CONFLICT',
            `Row ${earlier.rowNumber} uses the same ${code ? 'barcode' : 'product code'} for a different product name. Variants need their own barcode.`,
            code ? 'barcode' : 'product_ref',
          ),
        );
        return out('REVIEW', { shop, productKey });
      }
      if (
        earlier.visibility === 'SHOP' &&
        (!shop || shop.id !== earlier.ownerSalonId)
      ) {
        issues.push(
          issue(
            'REVIEW',
            'SHOP_PRODUCT_CONFLICT',
            `Row ${earlier.rowNumber} makes this a shop-only product of another shop.`,
            'barcode',
          ),
        );
        return out('REVIEW', { shop, productKey });
      }
      if (shop) return out('LINK_SHOP', { shop, productKey, linkShop: true });
      return out('UNCHANGED', { productKey });
    }

    planned.set(productKey, {
      rowNumber: candidate.rowNumber,
      normalizedName,
      visibility: wantsShopOnly ? 'SHOP' : 'GLOBAL',
      ownerSalonId: wantsShopOnly ? shop!.id : null,
    });
    if (!shop && candidate.quantity)
      issues.push(
        issue(
          'WARNING',
          'QUANTITY_WITHOUT_SHOP',
          'Opening quantity is ignored for rows without a shop.',
          'quantity',
        ),
      );
    return out(wantsShopOnly ? 'CREATE_SHOP' : 'CREATE_GLOBAL', {
      shop,
      productKey,
      linkShop: !!shop,
    });
  });
}

function summarize(
  rows: ResolvedRow[],
  embeddedImages: number,
): InventoryUploadSummaryDto {
  const count = (a: UploadRowAction) =>
    rows.filter((r) => r.action === a).length;
  return {
    totalRows: rows.length,
    createGlobal: count('CREATE_GLOBAL'),
    createShop: count('CREATE_SHOP'),
    linkShop: count('LINK_SHOP'),
    unchanged: count('UNCHANGED'),
    skipped: count('SKIP'),
    review: count('REVIEW'),
    errors: rows.filter((r) => r.issues.some((i) => i.severity === 'ERROR'))
      .length,
    warnings: rows.reduce(
      (n, r) => n + r.issues.filter((i) => i.severity === 'WARNING').length,
      0,
    ),
    globalRows: rows.filter((r) => !r.candidate.shopId && !r.candidate.shopName)
      .length,
    shopRows: rows.filter((r) => !!(r.candidate.shopId || r.candidate.shopName))
      .length,
    embeddedImages,
  };
}

function toRowPreview(r: ResolvedRow): UploadRowPreviewDto {
  const c = r.candidate;
  return {
    rowNumber: c.rowNumber,
    action: r.action,
    barcode: c.barcode?.display ?? null,
    symbology: c.barcode?.symbology ?? null,
    productRef: c.productRef,
    name: c.name,
    brand: c.brand,
    category: c.category,
    variant: c.variant,
    shop: r.shop,
    shopText: c.shopName ?? c.shopId,
    isTestData: c.isTestData,
    existingProductId: r.existingProductId,
    issues: r.issues,
  };
}

type JobWithUser = Prisma.InventoryUploadJobGetPayload<{
  include: { uploadedBy: { select: { id: true; email: true } } };
}>;

export function toJobDto(job: JobWithUser): InventoryUploadJobDto {
  return {
    id: job.id,
    fileName: job.fileName,
    fileType: job.fileType,
    fileSizeBytes: job.fileSizeBytes,
    sheetName: job.sheetName,
    status: job.status,
    uploadedBy: {
      id: job.uploadedBy.id,
      name: null,
      email: job.uploadedBy.email,
    },
    sourceReference: job.sourceReference,
    sourceLicense: job.sourceLicense,
    markAsTestData: job.markAsTestData,
    totalRows: job.totalRows,
    createdCount: job.createdCount,
    linkedCount: job.linkedCount,
    unchangedCount: job.unchangedCount,
    skippedCount: job.skippedCount,
    errorCount: job.errorCount,
    warningCount: job.warningCount,
    reviewCount: job.reviewCount,
    embeddedImageCount: job.embeddedImageCount,
    failureMessage: job.failureMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

const jobInclude = {
  uploadedBy: { select: { id: true, email: true } },
} as const;

/**
 * Admin inventory master upload: parse an .xlsx/.csv, preview what each row would do (stored as an
 * upload job), then commit exactly that job. Commit is idempotent: a re-imported file only adds what
 * is still missing, never overwrites a product by name, and never changes a salon's stock.
 */
@Injectable()
export class InventoryUploadService {
  constructor(private readonly prisma: PrismaService) {}

  private blockTestData(): boolean {
    return (
      process.env.NODE_ENV === 'production' &&
      process.env.INVENTORY_ALLOW_TEST_DATA_IMPORT !== 'true'
    );
  }

  private async context(
    candidates: UploadRowCandidate[],
  ): Promise<ResolveContext> {
    const codes = [
      ...new Set(
        candidates.map((c) => c.barcode?.code).filter((c): c is string => !!c),
      ),
    ];
    const refs = [
      ...new Set(
        candidates
          .map((c) => c.productRef?.toUpperCase())
          .filter((c): c is string => !!c),
      ),
    ];
    const select = {
      id: true,
      name: true,
      normalizedName: true,
      visibility: true,
      ownerSalonId: true,
      verificationStatus: true,
      isTestData: true,
      externalRef: true,
      barcodes: { select: { code: true } },
    } as const;
    const toExisting = (
      p: Prisma.GlobalProductGetPayload<{ select: typeof select }>,
    ): ExistingProduct => ({
      ...p,
      barcodeCodes: p.barcodes.map((b) => b.code),
    });
    const [barcodeRows, refRows] = await Promise.all([
      this.prisma.globalProductBarcode.findMany({
        where: { code: { in: codes } },
        select: { code: true, product: { select } },
      }),
      refs.length
        ? this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id" FROM "global_products" WHERE upper("externalRef") IN (${Prisma.join(refs)})`)
        : Promise.resolve([] as Array<{ id: string }>),
    ]);
    const refProducts = refRows.length
      ? await this.prisma.globalProduct.findMany({
          where: { id: { in: refRows.map((r) => r.id) } },
          select,
        })
      : [];

    const shopIds = [
      ...new Set(
        candidates.map((c) => c.shopId).filter((s): s is string => !!s),
      ),
    ];
    const shopNames = [
      ...new Set(
        candidates
          .map((c) => (c.shopName ? normalizeShopName(c.shopName) : null))
          .filter((s): s is string => !!s),
      ),
    ];
    const uuidIds = shopIds.filter((s) => UUID.test(s));
    const salons =
      shopIds.length || shopNames.length
        ? await this.prisma.$queryRaw<
            Array<{
              id: string;
              name: string;
              publicId: string;
              slug: string;
              norm: string;
            }>
          >(Prisma.sql`
          SELECT "id", "name", "publicId", "slug",
            btrim(regexp_replace(replace(lower("name"), '&', ' and '), '[^a-z0-9]+', ' ', 'g')) AS "norm"
          FROM "salons"
          WHERE ${uuidIds.length ? Prisma.sql`"id" IN (${Prisma.join(uuidIds)})` : Prisma.sql`false`}
            OR ${shopIds.length ? Prisma.sql`upper("publicId") IN (${Prisma.join(shopIds.map((s) => s.toUpperCase()))}) OR lower("slug") IN (${Prisma.join(shopIds.map((s) => s.toLowerCase()))})` : Prisma.sql`false`}
            OR ${shopNames.length ? Prisma.sql`btrim(regexp_replace(replace(lower("name"), '&', ' and '), '[^a-z0-9]+', ' ', 'g')) IN (${Prisma.join(shopNames)})` : Prisma.sql`false`}`)
        : [];
    const shopsById = new Map<string, ShopRef>();
    const shopsByName = new Map<string, ShopRef[]>();
    for (const s of salons) {
      const ref = { id: s.id, name: s.name };
      shopsById.set(s.id, ref);
      shopsById.set(s.id.toLowerCase(), ref);
      shopsById.set(s.publicId.toUpperCase(), ref);
      shopsById.set(s.slug.toLowerCase(), ref);
      shopsByName.set(s.norm, [...(shopsByName.get(s.norm) ?? []), ref]);
    }
    const productIds = [
      ...barcodeRows.map((b) => b.product.id),
      ...refProducts.map((p) => p.id),
    ];
    const associations = new Set<string>();
    if (productIds.length && salons.length) {
      const rows = await this.prisma.inventoryProduct.findMany({
        where: {
          globalProductId: { in: productIds },
          salonId: { in: salons.map((s) => s.id) },
        },
        select: { salonId: true, globalProductId: true },
      });
      for (const r of rows)
        associations.add(`${r.salonId}|${r.globalProductId}`);
    }
    return {
      byCode: new Map(barcodeRows.map((b) => [b.code, toExisting(b.product)])),
      byRef: new Map(
        refProducts
          .filter((p) => p.externalRef)
          .map((p) => [p.externalRef!.toUpperCase(), toExisting(p)]),
      ),
      shopsById,
      shopsByName,
      associations,
      blockTestData: this.blockTestData(),
    };
  }

  async preview(
    adminUserId: string,
    file: Express.Multer.File,
    input: InventoryUploadPreviewInput,
  ): Promise<InventoryUploadPreviewDto> {
    const fileName = (file.originalname || 'upload')
      .replace(/[^\w.\- ()]/g, '_')
      .slice(0, 255);
    const workbook = readSpreadsheet(file.buffer, fileName);
    const fileWarnings: string[] = [];

    // Sheet: the one asked for, else the first whose header can be found.
    let sheet = input.sheetName
      ? workbook.sheets.find((s) => s.name === input.sheetName)
      : undefined;
    if (input.sheetName && !sheet)
      throw new AppException(
        'INVENTORY_UPLOAD_SHEET_NOT_FOUND',
        `There is no sheet called "${input.sheetName}".`,
        HttpStatus.BAD_REQUEST,
      );
    const textRows = (s: (typeof workbook.sheets)[number]) =>
      s.rows.slice(0, 15).map((r) => r.map((c) => c.text));
    sheet ??= workbook.sheets.find((s) => detectUploadHeader(textRows(s)));
    if (!sheet)
      throw new AppException(
        'INVENTORY_UPLOAD_NO_HEADER',
        'No header row with a product name or barcode column was found in the first 15 rows.',
        HttpStatus.BAD_REQUEST,
      );
    const header = detectUploadHeader(textRows(sheet), input.mapping);
    if (!header)
      throw new AppException(
        'INVENTORY_UPLOAD_NO_HEADER',
        'No header row with a product name or barcode column was found in the first 15 rows.',
        HttpStatus.BAD_REQUEST,
      );
    if (input.mapping && input.mapping.length !== header.headers.length)
      throw new AppException(
        'INVENTORY_UPLOAD_MAPPING_INVALID',
        'The column mapping does not match the file’s columns.',
        HttpStatus.BAD_REQUEST,
      );
    if (!header.mapping.includes('name'))
      throw new AppException(
        'INVENTORY_UPLOAD_MAPPING_INVALID',
        'Map a column to “Product name”.',
        HttpStatus.BAD_REQUEST,
      );
    fileWarnings.push(...header.warnings);
    if (workbook.sheets.length > 1)
      fileWarnings.push(
        `Read sheet "${sheet.name}"; other sheets (${workbook.sheets
          .filter((s) => s !== sheet)
          .map((s) => s.name)
          .join(', ')}) were not imported.`,
      );

    // Data rows (blank rows skipped). Pictures are matched to the row they sit on.
    const imagesByRow = new Map<number, number>();
    for (const img of sheet.images)
      imagesByRow.set(img.row, (imagesByRow.get(img.row) ?? 0) + 1);
    const dataStart = header.headerRowIndex + 1;
    const candidates: UploadRowCandidate[] = [];
    let unplacedImages = 0;
    for (const [row, n] of imagesByRow) {
      const cells = sheet.rows[row];
      if (row < dataStart || !cells || cells.every((c) => !c.text.trim()))
        unplacedImages += n;
    }
    for (let r = dataStart; r < sheet.rows.length; r++) {
      const cells = sheet.rows[r] ?? [];
      if (cells.every((c) => !c.text.trim())) continue;
      candidates.push(
        normalizeUploadRow(cells, header.mapping, r + 1, {
          markAsTestData: input.markAsTestData,
          embeddedBarcodeImages: imagesByRow.get(r) ?? 0,
        }),
      );
      if (candidates.length > INVENTORY_UPLOAD_MAX_ROWS)
        throw new AppException(
          'INVENTORY_UPLOAD_TOO_MANY_ROWS',
          `At most ${INVENTORY_UPLOAD_MAX_ROWS} rows per file. Split the file and upload the parts.`,
          HttpStatus.BAD_REQUEST,
        );
    }
    if (!candidates.length)
      throw new AppException(
        'INVENTORY_UPLOAD_EMPTY',
        'The sheet has a header but no product rows.',
        HttpStatus.BAD_REQUEST,
      );
    const embeddedImages = sheet.images.length;
    if (embeddedImages) {
      fileWarnings.push(
        `${embeddedImages - unplacedImages} barcode picture${embeddedImages - unplacedImages === 1 ? '' : 's'} matched to product rows. Pictures are not stored: the typed barcode number is the source of truth and FastQue draws the barcode from it.`,
      );
      if (unplacedImages)
        fileWarnings.push(
          `${unplacedImages} picture(s) are not on a product row and were ignored.`,
        );
    }

    const resolved = resolveUploadRows(
      candidates,
      await this.context(candidates),
    );
    const summary = summarize(resolved, embeddedImages);
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    const previous = await this.prisma.inventoryUploadJob.findMany({
      where: {
        fileSha256: sha,
        status: { in: ['COMPLETED', 'COMPLETED_WITH_ERRORS'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, completedAt: true, status: true },
    });
    if (previous.length)
      fileWarnings.push(
        'This exact file was imported before. Importing it again is safe: only missing products and shop links are added.',
      );

    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryUploadJob.create({
        data: {
          uploadedByUserId: adminUserId,
          fileName,
          fileType: workbook.type,
          fileSizeBytes: file.size,
          fileSha256: sha,
          sheetName: workbook.type === 'XLSX' ? sheet.name.slice(0, 120) : null,
          headerRow: header.headerRowIndex + 1,
          columnMapping: header.mapping,
          parsedRows: candidates as unknown as Prisma.InputJsonValue,
          sourceReference: input.sourceReference || null,
          sourceLicense: input.sourceLicense || null,
          markAsTestData: !!input.markAsTestData,
          totalRows: summary.totalRows,
          errorCount: summary.errors,
          warningCount: summary.warnings,
          reviewCount: summary.review,
          embeddedImageCount: embeddedImages,
        },
      });
      await this.saveIssues(tx, created.id, 'PREVIEW', resolved);
      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'INVENTORY_UPLOAD_PREVIEWED',
          entityType: 'InventoryUploadJob',
          entityId: created.id,
          metadata: { fileName, sha256: sha, rows: summary.totalRows },
        },
      });
      return created;
    });

    return {
      jobId: job.id,
      fileName,
      fileType: workbook.type,
      sheetName: workbook.type === 'XLSX' ? sheet.name : null,
      sheets: workbook.sheets.map((s) => s.name),
      headerRow: header.headerRowIndex + 1,
      headers: header.headers,
      mapping: header.mapping,
      fieldLabels: UPLOAD_FIELD_LABELS,
      fileWarnings,
      summary,
      rows: resolved.slice(0, INVENTORY_UPLOAD_PREVIEW_ROWS).map(toRowPreview),
      previousImports: previous.map((p) => ({
        jobId: p.id,
        completedAt: p.completedAt?.toISOString() ?? null,
        status: p.status,
      })),
      testDataInProductionBlocked: this.blockTestData(),
    };
  }

  private async saveIssues(
    tx: Prisma.TransactionClient,
    jobId: string,
    phase: 'PREVIEW' | 'COMMIT',
    rows: ResolvedRow[],
  ) {
    const data = rows.flatMap((r) =>
      r.issues.map((i) => ({
        jobId,
        phase,
        rowNumber: r.candidate.rowNumber,
        severity: i.severity,
        code: i.code.slice(0, 60),
        field: i.field,
        message: i.message.slice(0, 500),
        rawValue: i.rawValue ? String(i.rawValue).slice(0, 300) : null,
      })),
    );
    for (let i = 0; i < data.length; i += 1000)
      await tx.inventoryUploadError.createMany({
        data: data.slice(i, i + 1000),
      });
  }

  async commit(
    adminUserId: string,
    jobId: string,
  ): Promise<InventoryUploadJobDto> {
    // Claim the job: only one commit can ever run for it.
    const claimed = await this.prisma.inventoryUploadJob.updateMany({
      where: { id: jobId, status: 'PREVIEWED' },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });
    if (claimed.count === 0) {
      const job = await this.prisma.inventoryUploadJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (!job)
        throw new AppException(
          'INVENTORY_UPLOAD_NOT_FOUND',
          'Upload not found.',
          HttpStatus.NOT_FOUND,
        );
      throw new AppException(
        'INVENTORY_UPLOAD_ALREADY_PROCESSED',
        `This upload is already ${job.status.toLowerCase().replace(/_/g, ' ')}. Upload the file again to import it again.`,
        HttpStatus.CONFLICT,
      );
    }
    const job = await this.prisma.inventoryUploadJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    try {
      const candidates = (job.parsedRows ??
        []) as unknown as UploadRowCandidate[];
      const resolved = resolveUploadRows(
        candidates,
        await this.context(candidates),
      );
      const createdByKey = new Map<string, string>();
      let created = 0;
      let linked = 0;
      let unchanged = 0;
      for (const row of resolved) {
        try {
          const result = await this.applyRow(
            adminUserId,
            job,
            row,
            createdByKey,
          );
          if (result.created) created += 1;
          if (result.linked) linked += 1;
          if (
            !result.created &&
            !result.linked &&
            (row.action === 'UNCHANGED' ||
              row.action === 'LINK_SHOP' ||
              row.action.startsWith('CREATE'))
          )
            unchanged += 1;
        } catch (error) {
          row.action = 'REVIEW';
          row.issues.push(
            issue(
              'ERROR',
              'IMPORT_FAILED',
              error instanceof AppException
                ? error.message
                : 'This row could not be saved (it conflicted with a change made at the same time). Upload the file again.',
            ),
          );
        }
      }
      const summary = summarize(resolved, job.embeddedImageCount);
      const finished = await this.prisma.$transaction(async (tx) => {
        await this.saveIssues(tx, jobId, 'COMMIT', resolved);
        const status: InventoryUploadStatus =
          summary.review || summary.errors
            ? 'COMPLETED_WITH_ERRORS'
            : 'COMPLETED';
        const row = await tx.inventoryUploadJob.update({
          where: { id: jobId },
          data: {
            status,
            completedAt: new Date(),
            createdCount: created,
            linkedCount: linked,
            unchangedCount: unchanged,
            skippedCount: summary.skipped,
            reviewCount: summary.review,
            errorCount: summary.errors,
            warningCount: summary.warnings,
          },
          include: jobInclude,
        });
        await tx.auditLog.create({
          data: {
            actorUserId: adminUserId,
            action: 'INVENTORY_UPLOAD_COMMITTED',
            entityType: 'InventoryUploadJob',
            entityId: jobId,
            metadata: {
              created,
              linked,
              unchanged,
              skipped: summary.skipped,
              review: summary.review,
              errors: summary.errors,
              fileName: job.fileName,
            },
          },
        });
        return row;
      });
      return toJobDto(finished);
    } catch (error) {
      await this.prisma.inventoryUploadJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          failureMessage: (error instanceof Error
            ? error.message
            : 'Import failed'
          ).slice(0, 500),
        },
      });
      throw error;
    }
  }

  /** Saves one row in its own transaction (one bad row never undoes the others). */
  private async applyRow(
    adminUserId: string,
    job: {
      id: string;
      sourceReference: string | null;
      sourceLicense: string | null;
    },
    row: ResolvedRow,
    createdByKey: Map<string, string>,
  ): Promise<{ created: boolean; linked: boolean }> {
    const c = row.candidate;
    if (row.action === 'SKIP' || row.action === 'REVIEW')
      return { created: false, linked: false };
    if (row.action === 'UNCHANGED' && !row.linkShop)
      return { created: false, linked: false };
    return this.prisma.$transaction(async (tx) => {
      let productId =
        row.existingProductId ??
        (row.productKey ? createdByKey.get(row.productKey) : undefined) ??
        null;
      let created = false;
      if (
        !productId &&
        (row.action === 'CREATE_GLOBAL' || row.action === 'CREATE_SHOP')
      ) {
        const shopOnly = row.action === 'CREATE_SHOP';
        const product = await tx.globalProduct.create({
          data: {
            name: c.name!,
            normalizedName: normalizeProductName(c.name!),
            brand: c.brand,
            manufacturer: c.manufacturer,
            category: c.category,
            subcategory: c.subcategory,
            description: c.description,
            variantText: c.variant,
            packSize: c.packSize?.toFixed(3) ?? null,
            packUnit: c.packUnit,
            mrp: c.mrp?.toFixed(2) ?? null,
            currency: c.mrp != null ? 'INR' : null,
            hsnCode: c.hsnCode,
            gstRatePercent: c.gstRatePercent?.toFixed(2) ?? null,
            productType: c.productType,
            dataSource: 'CSV_IMPORT',
            sourceReference:
              job.sourceReference ?? `Inventory upload ${job.id}`,
            sourceLicense: job.sourceLicense,
            verificationStatus: 'VERIFIED',
            createdByUserId: adminUserId,
            reviewedByUserId: adminUserId,
            reviewedAt: new Date(),
            visibility: shopOnly ? 'SHOP' : 'GLOBAL',
            ownerSalonId: shopOnly ? row.shop!.id : null,
            externalRef: c.productRef,
            isTestData: c.isTestData,
            uploadJobId: job.id,
            ...(c.barcode
              ? {
                  barcodes: {
                    create: {
                      code: c.barcode.code,
                      display: c.barcode.display,
                      format: c.barcode.format,
                    },
                  },
                }
              : {}),
            ...(c.imageUrl
              ? { images: { create: { url: c.imageUrl, sortOrder: 0 } } }
              : {}),
          },
          select: { id: true },
        });
        productId = product.id;
        created = true;
        if (row.productKey) createdByKey.set(row.productKey, product.id);
      }
      if (!productId) return { created: false, linked: false };
      let linked = false;
      if (row.linkShop && row.shop) {
        linked = await this.linkShop(tx, adminUserId, job.id, row, productId);
        if (!linked && c.quantity)
          row.issues.push(
            issue(
              'WARNING',
              'STOCK_NOT_CHANGED',
              'The shop already has this product; re-imports never change stock quantities.',
              'quantity',
            ),
          );
      }
      return { created, linked };
    });
  }

  /**
   * The shop's own inventory row for a master product (zero stock unless the row gives an opening
   * quantity, recorded through the stock ledger). An existing row is left exactly as it is.
   */
  private async linkShop(
    tx: Prisma.TransactionClient,
    adminUserId: string,
    jobId: string,
    row: ResolvedRow,
    globalProductId: string,
  ): Promise<boolean> {
    const c = row.candidate;
    const salonId = row.shop!.id;
    const usage = c.productType === 'RETAIL' ? 'RETAIL' : 'PROFESSIONAL';
    const existing = await tx.inventoryProduct.findFirst({
      where: { salonId, globalProductId },
      select: { id: true },
    });
    if (existing) return false;
    const contentFromPack =
      c.packSize &&
      c.packUnit &&
      ['GRAM', 'KILOGRAM', 'MILLILITER', 'LITER'].includes(c.packUnit) &&
      c.unit !== c.packUnit
        ? { contentSize: c.packSize.toFixed(3), contentUnit: c.packUnit }
        : {};
    const product = await tx.inventoryProduct.create({
      data: {
        salonId,
        globalProductId,
        usage,
        name: c.name!.slice(0, 120),
        normalizedName: normalizeProductName(c.name!).slice(0, 120),
        unit: c.unit,
        ...contentFromPack,
        reorderThreshold: (c.minStock ?? 0).toFixed(3),
        sellingPrice: c.sellingPrice?.toFixed(2) ?? null,
      },
      select: { id: true },
    });
    if (c.quantity && c.quantity > 0) {
      const idempotencyKey = `upload:${jobId}:${c.rowNumber}`;
      await tx.inventoryMovement.create({
        data: {
          salonId,
          productId: product.id,
          actorUserId: adminUserId,
          kind: 'OPENING',
          quantityDelta: c.quantity.toFixed(3),
          unitCost: (c.costPrice ?? 0).toFixed(2),
          reason: 'Opening stock from admin inventory upload',
          reference: `upload ${jobId.slice(0, 8)} row ${c.rowNumber}`,
          idempotencyKey,
          requestHash: createHash('sha256')
            .update(idempotencyKey)
            .digest('hex'),
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'INVENTORY_PRODUCT_ASSIGNED_BY_UPLOAD',
        entityType: 'InventoryProduct',
        entityId: product.id,
        metadata: {
          salonId,
          globalProductId,
          uploadJobId: jobId,
          row: c.rowNumber,
          openingQuantity: c.quantity ?? 0,
        },
      },
    });
    return true;
  }

  async cancel(
    adminUserId: string,
    jobId: string,
  ): Promise<InventoryUploadJobDto> {
    const { count } = await this.prisma.inventoryUploadJob.updateMany({
      where: { id: jobId, status: 'PREVIEWED' },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
        parsedRows: Prisma.DbNull,
      },
    });
    if (!count)
      throw new AppException(
        'INVENTORY_UPLOAD_ALREADY_PROCESSED',
        'Only an upload that has not been imported can be cancelled.',
        HttpStatus.CONFLICT,
      );
    await this.prisma.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'INVENTORY_UPLOAD_CANCELLED',
        entityType: 'InventoryUploadJob',
        entityId: jobId,
      },
    });
    return this.get(jobId);
  }

  async list(
    query: InventoryUploadListQuery,
  ): Promise<InventoryPageDto<InventoryUploadJobDto>> {
    const cursorRow = query.cursor
      ? await this.prisma.inventoryUploadJob.findUnique({
          where: { id: query.cursor },
          select: { createdAt: true, id: true },
        })
      : null;
    const rows = await this.prisma.inventoryUploadJob.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(cursorRow
          ? {
              OR: [
                { createdAt: { lt: cursorRow.createdAt } },
                { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: jobInclude,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toJobDto),
      nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
      hasMore: rows.length > query.limit,
    };
  }

  async get(jobId: string): Promise<InventoryUploadJobDto> {
    const job = await this.prisma.inventoryUploadJob.findUnique({
      where: { id: jobId },
      include: jobInclude,
    });
    if (!job)
      throw new AppException(
        'INVENTORY_UPLOAD_NOT_FOUND',
        'Upload not found.',
        HttpStatus.NOT_FOUND,
      );
    return toJobDto(job);
  }

  /** The issues of the latest phase (commit results once imported, otherwise the preview's). */
  async issues(
    jobId: string,
    query: InventoryUploadIssuesQuery,
  ): Promise<{
    items: InventoryUploadIssueDto[];
    total: number;
    page: number;
    phase: 'PREVIEW' | 'COMMIT';
  }> {
    const job = await this.get(jobId);
    const phase =
      query.phase ??
      (['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(job.status)
        ? 'COMMIT'
        : 'PREVIEW');
    const where = {
      jobId,
      phase,
      ...(query.severity ? { severity: query.severity } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.inventoryUploadError.count({ where }),
      this.prisma.inventoryUploadError.findMany({
        where,
        orderBy: [{ rowNumber: 'asc' }, { createdAt: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return {
      total,
      page: query.page,
      phase,
      items: items.map((i) => ({
        id: i.id,
        rowNumber: i.rowNumber,
        severity: i.severity,
        code: i.code,
        field: i.field,
        message: i.message,
        rawValue: i.rawValue,
        phase: i.phase as 'PREVIEW' | 'COMMIT',
      })),
    };
  }

  /** Downloadable row report; every cell is formula-safe. */
  async errorReportCsv(
    jobId: string,
  ): Promise<{ fileName: string; csv: string }> {
    const job = await this.get(jobId);
    const phase = ['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(job.status)
      ? 'COMMIT'
      : 'PREVIEW';
    const rows = await this.prisma.inventoryUploadError.findMany({
      where: { jobId, phase },
      orderBy: [{ rowNumber: 'asc' }, { createdAt: 'asc' }],
    });
    const lines = [
      ['Row', 'Severity', 'Code', 'Column', 'Value', 'Message']
        .map(csvSafeCell)
        .join(','),
      ...rows.map((r) =>
        [
          r.rowNumber,
          r.severity,
          r.code,
          r.field ?? '',
          r.rawValue ?? '',
          r.message,
        ]
          .map(csvSafeCell)
          .join(','),
      ),
    ];
    const base =
      job.fileName
        .replace(/\.[^.]+$/, '')
        .replace(/[^\w-]+/g, '_')
        .slice(0, 80) || 'upload';
    return {
      fileName: `${base}-row-report.csv`,
      csv: `${UTF8_BOM}${lines.join('\r\n')}\r\n`,
    };
  }

  templateCsv(): string {
    const example = [
      '8901234567890',
      'EAN-13',
      'SKU-001',
      'Example Shampoo',
      'Example Brand',
      'Hair Care',
      'Shampoo',
      '200 ml',
      'pcs',
      '350',
      '210',
      '320',
      '',
      '2',
      '',
      '',
      'global',
      'retail',
      '',
    ];
    return `${UTF8_BOM}${INVENTORY_UPLOAD_TEMPLATE_HEADERS.map(csvSafeCell).join(',')}\r\n${example.map(csvSafeCell).join(',')}\r\n`;
  }

  async stats(): Promise<InventoryMasterStatsDto> {
    const [counts, uploads, salonsUsing, recent, categories, openRequests] =
      await Promise.all([
        this.prisma.$queryRaw<
          Array<{
            total: bigint;
            global: bigint;
            shop: bigint;
            test: bigint;
            pending: bigint;
            missing: bigint;
            shopSalons: bigint;
          }>
        >(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE g."verificationStatus" <> 'REJECTED') AS "total",
          COUNT(*) FILTER (WHERE g."visibility" = 'GLOBAL' AND g."verificationStatus" = 'VERIFIED') AS "global",
          COUNT(*) FILTER (WHERE g."visibility" = 'SHOP' AND g."verificationStatus" <> 'REJECTED') AS "shop",
          COUNT(*) FILTER (WHERE g."isTestData") AS "test",
          COUNT(*) FILTER (WHERE g."verificationStatus" = 'PENDING') AS "pending",
          COUNT(*) FILTER (WHERE g."verificationStatus" <> 'REJECTED' AND NOT EXISTS (SELECT 1 FROM "global_product_barcodes" b WHERE b."productId" = g."id")) AS "missing",
          COUNT(DISTINCT g."ownerSalonId") AS "shopSalons"
        FROM "global_products" g`),
        this.prisma.inventoryUploadJob.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<Array<{ n: bigint }>>(
          Prisma.sql`SELECT COUNT(DISTINCT "salonId") AS "n" FROM "inventory_products" WHERE "isActive"`,
        ),
        this.prisma.inventoryUploadJob.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 5,
          include: jobInclude,
        }),
        this.prisma.$queryRaw<
          Array<{ category: string | null; n: bigint }>
        >(Prisma.sql`
        SELECT "category", COUNT(*) AS "n" FROM "global_products"
        WHERE "verificationStatus" <> 'REJECTED' GROUP BY "category" ORDER BY "n" DESC, "category" ASC LIMIT 15`),
        this.prisma.catalogChangeRequest.count({ where: { status: 'OPEN' } }),
      ]);
    const c = counts[0];
    const byStatus = (s: string) =>
      uploads.find((u) => u.status === s)?._count._all ?? 0;
    return {
      totalProducts: Number(c?.total ?? 0),
      globalProducts: Number(c?.global ?? 0),
      shopProducts: Number(c?.shop ?? 0),
      testDataProducts: Number(c?.test ?? 0),
      pendingReview: Number(c?.pending ?? 0),
      missingBarcodes: Number(c?.missing ?? 0),
      salonsUsingInventory: Number(salonsUsing[0]?.n ?? 0),
      salonsWithShopProducts: Number(c?.shopSalons ?? 0),
      failedUploads: byStatus('FAILED'),
      pendingUploads: byStatus('PREVIEWED') + byStatus('PROCESSING'),
      openChangeRequests: openRequests,
      recentImports: recent.map(toJobDto),
      categories: categories.map((r) => ({
        category: r.category ?? 'Uncategorised',
        products: Number(r.n),
      })),
    };
  }
}
