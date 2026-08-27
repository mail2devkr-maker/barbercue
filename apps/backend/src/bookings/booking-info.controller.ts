import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  Role,
  availabilityQuerySchema,
  staffListQuerySchema,
  type AvailabilityQueryInput,
  type StaffListQueryInput,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AvailabilityService } from './availability.service';
import { CancellationPolicyService } from './cancellation-policy.service';

/**
 * Mounted at `salons/:salonId/booking/...` — deliberately NOT a bare `salons/:salonId/staff`
 * shape. SalonsController's public discovery route (`GET salons/:countryCode/:citySlug/:salonSlug`,
 * three dynamic segments as of B9) sits under the same `salons` prefix and is a fully-wildcard
 * 3-segment pattern, so it structurally matches ANY 3-segment `salons/*` path — including this
 * controller's own routes (`salons/:salonId/booking/staff` etc. are also exactly 3 segments after
 * `salons/`). The literal `booking` segment does NOT make the two shapes non-overlapping (a
 * previous version of this comment claimed it did — that was wrong and caused a real production
 * bug: Nest/Express matches routes in registration order, not by pattern specificity, so whichever
 * controller's module is imported first in AppModule wins for ANY 3-segment `salons/*` path).
 * BookingsModule is now imported before SalonsModule in app.module.ts specifically so these routes
 * are tried first — see the comment there. If you add another `salons/:salonId/...` sub-resource,
 * either keep it behind a module imported before SalonsModule, or give it a different arity.
 */
@Controller('salons/:salonId/booking')
export class BookingInfoController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly cancellationPolicyService: CancellationPolicyService,
  ) {}

  // The zod pipe is scoped to the @Query() parameter specifically, not applied via a method-level
  // @UsePipes() — a method-level pipe runs against EVERY parameter, including @Param('salonId')
  // (a plain string), which fails these object-shaped query schemas with a confusing "Expected
  // object, received string" error.
  @Roles(Role.CUSTOMER)
  @Get('staff')
  listStaff(
    @Param('salonId') salonId: string,
    @Query(new ZodValidationPipe(staffListQuerySchema))
    query: StaffListQueryInput,
  ) {
    return this.availability.listQualifiedStaff(salonId, query.serviceId);
  }

  @Roles(Role.CUSTOMER)
  @Get('availability')
  getAvailability(
    @Param('salonId') salonId: string,
    @Query(new ZodValidationPipe(availabilityQuerySchema))
    query: AvailabilityQueryInput,
  ) {
    return this.availability.getAvailability(
      salonId,
      query.serviceId,
      query.date,
      query.staffId,
    );
  }

  @Roles(Role.CUSTOMER)
  @Get('cancellation-policy')
  getCancellationPolicy(@Param('salonId') salonId: string) {
    return this.cancellationPolicyService.getEffectivePolicy(salonId);
  }
}
