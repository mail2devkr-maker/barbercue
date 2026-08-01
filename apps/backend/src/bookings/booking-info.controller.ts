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
 * shape. SalonsController's public discovery route (`GET salons/:citySlug/:salonSlug`) is also a
 * two-dynamic-segment pattern under the same `salons` prefix; a request like
 * `/salons/{uuid}/staff` would structurally match both, and which one wins would depend on
 * fragile module/controller registration order. The extra literal `booking` segment makes the two
 * shapes structurally non-overlapping regardless of registration order — same fix philosophy as
 * Phase 3A's `/areas/` locality route (resolve via a distinct path shape, not by luck of
 * ordering). API.md's Booking section is annotated accordingly.
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
