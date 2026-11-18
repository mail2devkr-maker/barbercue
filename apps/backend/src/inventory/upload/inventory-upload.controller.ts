import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  ADMIN_PATHS,
  CATALOG_PATHS,
  INVENTORY_PATHS,
  INVENTORY_UPLOAD_MAX_BYTES,
  INVENTORY_UPLOAD_PATHS as P,
  Role,
  catalogChangeRequestListQuerySchema,
  catalogChangeRequestSchema,
  inventoryUploadIssuesQuerySchema,
  inventoryUploadListQuerySchema,
  inventoryUploadPreviewSchema,
  ownerAddCatalogProductSchema,
  ownerCatalogBrowseQuerySchema,
  resolveCatalogChangeRequestSchema,
  type AuthenticatedUser,
  type CatalogChangeRequestInput,
  type CatalogChangeRequestListQuery,
  type InventoryUploadIssuesQuery,
  type InventoryUploadListQuery,
  type InventoryUploadPreviewInput,
  type OwnerAddCatalogProductInput,
  type OwnerCatalogBrowseQuery,
  type ResolveCatalogChangeRequestInput,
} from '@barbercue/shared';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InventoryUploadService } from './inventory-upload.service';
import { OwnerCatalogService } from './owner-catalog.service';

const VIEW = [Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.PLATFORM_VIEWER];
const MANAGE = [Role.PLATFORM_ADMIN, Role.CO_FOUNDER];
const UPLOADS = P.uploads;

const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel', // browsers often label .csv this way
  'application/octet-stream',
  '',
]);

const spreadsheetUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: INVENTORY_UPLOAD_MAX_BYTES, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    if (
      !ALLOWED_MIME.has(file.mimetype ?? '') ||
      !/\.(xlsx|csv|txt)$/i.test(file.originalname ?? '')
    )
      cb(
        new AppException(
          'INVENTORY_UPLOAD_INVALID_FILE',
          'Upload an .xlsx workbook or a .csv file.',
          HttpStatus.BAD_REQUEST,
        ),
        false,
      );
    else cb(null, true);
  },
});

/**
 * Admin inventory master upload (FastQue Inventory Management): preview → commit an Excel/CSV
 * product file, upload history with a downloadable row report, master statistics, and owners'
 * change requests. Viewing is open to every admin role; changing the master is admin/co-founder.
 */
@Controller(ADMIN_PATHS.admin)
export class InventoryUploadController {
  constructor(
    private readonly uploads: InventoryUploadService,
    private readonly ownerCatalog: OwnerCatalogService,
  ) {}

  @Post(`${UPLOADS}/${P.preview}`)
  @Roles(...MANAGE)
  @UseInterceptors(spreadsheetUpload)
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(inventoryUploadPreviewSchema))
    body: InventoryUploadPreviewInput,
  ) {
    if (!file?.buffer?.length)
      throw new AppException(
        'INVENTORY_UPLOAD_INVALID_FILE',
        'Choose an .xlsx or .csv file to upload.',
        HttpStatus.BAD_REQUEST,
      );
    return this.uploads.preview(user.id, file, body);
  }

  @Post(`${UPLOADS}/:jobId/${P.commit}`)
  @Roles(...MANAGE)
  @HttpCode(HttpStatus.OK)
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.uploads.commit(user.id, jobId);
  }

  @Post(`${UPLOADS}/:jobId/${P.cancel}`)
  @Roles(...MANAGE)
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.uploads.cancel(user.id, jobId);
  }

  @Get(`${UPLOADS}/${P.template}`)
  @Roles(...VIEW)
  template(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="fastque-inventory-template.csv"',
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(this.uploads.templateCsv());
  }

  @Get(UPLOADS)
  @Roles(...VIEW)
  @Header('Cache-Control', 'private, no-store')
  list(
    @Query(new ZodValidationPipe(inventoryUploadListQuerySchema))
    query: InventoryUploadListQuery,
  ) {
    return this.uploads.list(query);
  }

  @Get(`${UPLOADS}/:jobId`)
  @Roles(...VIEW)
  @Header('Cache-Control', 'private, no-store')
  get(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.uploads.get(jobId);
  }

  @Get(`${UPLOADS}/:jobId/${P.issues}`)
  @Roles(...VIEW)
  @Header('Cache-Control', 'private, no-store')
  issues(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Query(new ZodValidationPipe(inventoryUploadIssuesQuerySchema))
    query: InventoryUploadIssuesQuery,
  ) {
    return this.uploads.issues(jobId, query);
  }

  @Get(`${UPLOADS}/:jobId/${P.errorReport}`)
  @Roles(...VIEW)
  async errorReport(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Res() res: Response,
  ) {
    const { fileName, csv } = await this.uploads.errorReportCsv(jobId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(csv);
  }

  @Get(P.masterStats)
  @Roles(...VIEW)
  @Header('Cache-Control', 'private, no-store')
  stats() {
    return this.uploads.stats();
  }

  @Get(P.changeRequests)
  @Roles(...VIEW)
  @Header('Cache-Control', 'private, no-store')
  listChangeRequests(
    @Query(new ZodValidationPipe(catalogChangeRequestListQuerySchema))
    query: CatalogChangeRequestListQuery,
  ) {
    return this.ownerCatalog.listChangeRequests(query);
  }

  @Patch(`${P.changeRequests}/:id`)
  @Roles(...MANAGE)
  resolveChangeRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resolveCatalogChangeRequestSchema))
    body: ResolveCatalogChangeRequestInput,
  ) {
    return this.ownerCatalog.resolveChangeRequest(user.id, id, body);
  }
}

const OWNER_CATALOG = `dashboard/salons/:salonId/${INVENTORY_PATHS.root}/${CATALOG_PATHS.catalog}`;

/**
 * Owner side: browse the master catalog (global + this shop's own products), add one to the shop's
 * inventory with zero stock, ask FastQue to correct a master product, and the owner's inventory
 * summary. The salon is the URL's, verified against the caller's own owner role.
 */
@Controller()
@Roles(Role.SALON_OWNER, Role.PLATFORM_ADMIN, Role.CO_FOUNDER)
export class OwnerCatalogController {
  constructor(private readonly ownerCatalog: OwnerCatalogService) {}

  @Get(`${OWNER_CATALOG}/${P.browse}`)
  @Header('Cache-Control', 'private, no-store')
  browse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Query(new ZodValidationPipe(ownerCatalogBrowseQuerySchema))
    query: OwnerCatalogBrowseQuery,
  ) {
    return this.ownerCatalog.browse(user.id, salonId, query);
  }

  @Post(`${OWNER_CATALOG}/${P.add}`)
  async add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Body(new ZodValidationPipe(ownerAddCatalogProductSchema))
    body: OwnerAddCatalogProductInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.ownerCatalog.add(user.id, salonId, body);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Get(`${OWNER_CATALOG}/${P.ownerChangeRequests}`)
  @Header('Cache-Control', 'private, no-store')
  listChangeRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
  ) {
    return this.ownerCatalog.listOwnChangeRequests(user.id, salonId);
  }

  @Post(`${OWNER_CATALOG}/${P.ownerChangeRequests}`)
  createChangeRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Body(new ZodValidationPipe(catalogChangeRequestSchema))
    body: CatalogChangeRequestInput,
  ) {
    return this.ownerCatalog.createChangeRequest(user.id, salonId, body);
  }

  @Get(`dashboard/salons/:salonId/${INVENTORY_PATHS.root}/${P.ownerSummary}`)
  @Header('Cache-Control', 'private, no-store')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
  ) {
    return this.ownerCatalog.summary(user.id, salonId);
  }
}
