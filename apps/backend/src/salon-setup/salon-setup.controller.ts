import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  DASHBOARD_PATHS,
  Role,
  createSalonChairSchema,
  createSalonServiceSchema,
  createSalonPhotoSchema,
  salonPhotoUploadMetaSchema,
  SALON_PHOTO_UPLOAD,
  createSalonStaffSchema,
  setOperatingHoursSchema,
  setSalonPaymentQrSchema,
  setStaffWorkingHoursSchema,
  updateSalonChairSchema,
  updateSalonServiceSchema,
  updateSalonStaffSchema,
  updateSalonStatusSchema,
  updateSalonTimezoneSchema,
  type AuthenticatedUser,
  type CreateSalonChairInput,
  type CreateSalonServiceInput,
  type CreateSalonPhotoInput,
  type SalonPhotoUploadMetaInput,
  type CreateSalonStaffInput,
  type SetOperatingHoursInput,
  type SetSalonPaymentQrInput,
  type SetStaffWorkingHoursInput,
  type UpdateSalonChairInput,
  type UpdateSalonServiceInput,
  type UpdateSalonStaffInput,
  type UpdateSalonStatusInput,
  type UpdateSalonTimezoneInput,
} from '@barbercue/shared';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SalonServicesService } from './salon-services.service';
import { SalonChairsService } from './salon-chairs.service';
import { SalonStaffService } from './salon-staff.service';
import { SalonActivationService } from './salon-activation.service';
import { SalonOperatingHoursService } from './salon-operating-hours.service';
import { SalonPhotosService } from './salon-photos.service';
import { StaffWorkingHoursService } from './staff-working-hours.service';
import { SalonTimezoneService } from './salon-timezone.service';
import { SalonPaymentQrService } from './salon-payment-qr.service';

const SALON_SCOPE = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/:salonId`;

/**
 * Salon owner setup (Phase 11): service catalog, chairs, barber roster, and shop activation.
 *
 * SALON_OWNER-only at the controller level — staff/barbers use the live-queue dashboard, they do
 * not configure the shop. That role check is only the outer gate: every service method also calls
 * SalonAccessService.assertOwnerAccess(userId, salonId), which is what actually prevents one owner
 * from managing another owner's salon. Both layers are required — the role alone says "an owner",
 * assertOwnerAccess says "an owner *of this salon*".
 *
 * PLATFORM_ADMIN (Part 2, admin delegated shop management) was added to the class-level role list
 * below so this file needs zero route/DTO duplication for the handful of methods that support it.
 * It is NOT a blanket grant: an admin only actually gets past a given method if that method's own
 * service was explicitly switched from assertOwnerAccess to assertOwnerOrAdminAccess (currently:
 * timezone, services.list/update, operatingHours.list/set, paymentQr.get/setLink/setFromUpload/
 * remove — see each service's own comments). Every other method here still calls the original
 * assertOwnerAccess, which has no admin branch at all, so an admin hitting e.g. chairs or staff
 * passes this controller's guard but is then correctly rejected with 403 inside the service —
 * admin access is opt-in per mutation, reviewed and audit-logged one at a time, never implicit.
 *
 * Routes live under the existing `dashboard/salons/:salonId/...` shape. Note DashboardQueueController
 * separately owns `dashboard/staff/:id/status` (clock in/out for an existing barber) — a different
 * path from this controller's `dashboard/salons/:salonId/staff/:staffId`, so the two never collide.
 */
@Controller()
@Roles(Role.SALON_OWNER, Role.PLATFORM_ADMIN)
export class SalonSetupController {
  constructor(
    private readonly services: SalonServicesService,
    private readonly chairs: SalonChairsService,
    private readonly staff: SalonStaffService,
    private readonly activation: SalonActivationService,
    private readonly operatingHours: SalonOperatingHoursService,
    private readonly photos: SalonPhotosService,
    private readonly staffWorkingHours: StaffWorkingHoursService,
    private readonly timezone: SalonTimezoneService,
    private readonly paymentQr: SalonPaymentQrService,
  ) {}

  // ---------- Shop activation ----------

  @Patch(`${SALON_SCOPE}/${DASHBOARD_PATHS.status}`)
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(updateSalonStatusSchema))
    body: UpdateSalonStatusInput,
  ) {
    return this.activation.updateStatus(user.id, salonId, body);
  }

  // ---------- Timezone ----------

  @Get(`${SALON_SCOPE}/${DASHBOARD_PATHS.timezone}`)
  getTimezone(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.timezone.getTimezone(user.id, salonId);
  }

  @Patch(`${SALON_SCOPE}/${DASHBOARD_PATHS.timezone}`)
  updateTimezone(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(updateSalonTimezoneSchema))
    body: UpdateSalonTimezoneInput,
  ) {
    return this.timezone.updateTimezone(user.id, salonId, body);
  }

  // ---------- Payment QR (FastQue Credits / Wallet V1) ----------

  @Get(`${SALON_SCOPE}/${DASHBOARD_PATHS.paymentQr}`)
  getPaymentQr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.paymentQr.get(user.id, salonId);
  }

  @Put(`${SALON_SCOPE}/${DASHBOARD_PATHS.paymentQr}`)
  setPaymentQr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(setSalonPaymentQrSchema))
    body: SetSalonPaymentQrInput,
  ) {
    return this.paymentQr.setLink(user.id, salonId, body);
  }

  // Multipart sibling of the JSON route above — same shape as photos' upload/link pair.
  @Post(`${SALON_SCOPE}/${DASHBOARD_PATHS.paymentQr}/${DASHBOARD_PATHS.photoUpload}`)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: SALON_PHOTO_UPLOAD.maxBytes, files: 1 },
    }),
  )
  uploadPaymentQr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.paymentQr.setFromUpload(user.id, salonId, file);
  }

  @Delete(`${SALON_SCOPE}/${DASHBOARD_PATHS.paymentQr}`)
  @HttpCode(HttpStatus.NO_CONTENT)
  removePaymentQr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.paymentQr.remove(user.id, salonId);
  }

  // ---------- Operating hours ----------

  @Get(`${SALON_SCOPE}/${DASHBOARD_PATHS.operatingHours}`)
  listOperatingHours(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.operatingHours.list(user.id, salonId);
  }

  // PUT, not PATCH: the body is the complete week and replaces whatever is stored, so the verb
  // matches the semantics (idempotent whole-resource replacement).
  @Put(`${SALON_SCOPE}/${DASHBOARD_PATHS.operatingHours}`)
  setOperatingHours(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(setOperatingHoursSchema))
    body: SetOperatingHoursInput,
  ) {
    return this.operatingHours.set(user.id, salonId, body);
  }

  // ---------- Services ----------

  @Get(`${SALON_SCOPE}/${DASHBOARD_PATHS.services}`)
  listServices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.services.list(user.id, salonId);
  }

  @Post(`${SALON_SCOPE}/${DASHBOARD_PATHS.services}`)
  createService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(createSalonServiceSchema))
    body: CreateSalonServiceInput,
  ) {
    return this.services.create(user.id, salonId, body);
  }

  @Patch(`${SALON_SCOPE}/${DASHBOARD_PATHS.services}/:serviceId`)
  updateService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('serviceId') serviceId: string,
    @Body(new ZodValidationPipe(updateSalonServiceSchema))
    body: UpdateSalonServiceInput,
  ) {
    return this.services.update(user.id, salonId, serviceId, body);
  }

  // ---------- Photos ----------

  @Get(`${SALON_SCOPE}/${DASHBOARD_PATHS.photos}`)
  listPhotos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.photos.list(user.id, salonId);
  }

  @Post(`${SALON_SCOPE}/${DASHBOARD_PATHS.photos}`)
  createPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(createSalonPhotoSchema))
    body: CreateSalonPhotoInput,
  ) {
    return this.photos.create(user.id, salonId, body);
  }

  // Multipart sibling of the JSON route above — the owner uploads from their device instead of
  // linking. Separate route rather than an overload of the same one: a multipart body and a JSON
  // body cannot share a validation pipe, and keeping them apart leaves the existing JSON contract
  // byte-for-byte unchanged for any client already using it.
  @Post(
    `${SALON_SCOPE}/${DASHBOARD_PATHS.photos}/${DASHBOARD_PATHS.photoUpload}`,
  )
  @UseInterceptors(
    FileInterceptor('image', {
      // Memory, not disk: the buffer is sniffed and forwarded straight to object storage, so the
      // API server never writes an uploaded file to its own filesystem. Same shape as the Style
      // Advisor's upload interceptor.
      storage: memoryStorage(),
      limits: { fileSize: SALON_PHOTO_UPLOAD.maxBytes, files: 1 },
    }),
  )
  uploadPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    // Multipart text fields arrive as strings; the schema is what turns `type` into a real
    // PhotoType and rejects anything else, exactly as the JSON route's pipe does.
    @Body(new ZodValidationPipe(salonPhotoUploadMetaSchema))
    meta: SalonPhotoUploadMetaInput,
  ) {
    return this.photos.createFromUpload(user.id, salonId, file, meta);
  }

  @Delete(`${SALON_SCOPE}/${DASHBOARD_PATHS.photos}/:photoId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  removePhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('photoId') photoId: string,
  ) {
    return this.photos.remove(user.id, salonId, photoId);
  }

  // ---------- Chairs ----------

  @Get(`${SALON_SCOPE}/${DASHBOARD_PATHS.chairs}`)
  listChairs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.chairs.list(user.id, salonId);
  }

  @Post(`${SALON_SCOPE}/${DASHBOARD_PATHS.chairs}`)
  createChair(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(createSalonChairSchema))
    body: CreateSalonChairInput,
  ) {
    return this.chairs.create(user.id, salonId, body);
  }

  @Patch(`${SALON_SCOPE}/${DASHBOARD_PATHS.chairs}/:chairId`)
  updateChair(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('chairId') chairId: string,
    @Body(new ZodValidationPipe(updateSalonChairSchema))
    body: UpdateSalonChairInput,
  ) {
    return this.chairs.update(user.id, salonId, chairId, body);
  }

  // ---------- Staff / barbers ----------

  @Get(`${SALON_SCOPE}/${DASHBOARD_PATHS.staff}`)
  listStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.staff.list(user.id, salonId);
  }

  @Post(`${SALON_SCOPE}/${DASHBOARD_PATHS.staff}`)
  createStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(createSalonStaffSchema))
    body: CreateSalonStaffInput,
  ) {
    return this.staff.create(user.id, salonId, body);
  }

  @Patch(`${SALON_SCOPE}/${DASHBOARD_PATHS.staff}/:staffId`)
  updateStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('staffId') staffId: string,
    @Body(new ZodValidationPipe(updateSalonStaffSchema))
    body: UpdateSalonStaffInput,
  ) {
    return this.staff.update(user.id, salonId, staffId, body);
  }

  @Post(
    `${SALON_SCOPE}/${DASHBOARD_PATHS.staff}/:staffId/${DASHBOARD_PATHS.resendInvite}`,
  )
  resendInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.staff.resendInvite(user.id, salonId, staffId);
  }

  // ---------- Barber working hours (Phase 7) ----------

  @Get(
    `${SALON_SCOPE}/${DASHBOARD_PATHS.staff}/:staffId/${DASHBOARD_PATHS.workingHours}`,
  )
  listStaffWorkingHours(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.staffWorkingHours.list(user.id, salonId, staffId);
  }

  @Put(
    `${SALON_SCOPE}/${DASHBOARD_PATHS.staff}/:staffId/${DASHBOARD_PATHS.workingHours}`,
  )
  setStaffWorkingHours(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('staffId') staffId: string,
    @Body(new ZodValidationPipe(setStaffWorkingHoursSchema))
    body: SetStaffWorkingHoursInput,
  ) {
    return this.staffWorkingHours.set(user.id, salonId, staffId, body);
  }
}
