import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  Role,
  bookingAttributionCampaignListQuerySchema,
  bookingAttributionSummaryQuerySchema,
  createBookingAttributionCampaignSchema,
  type AuthenticatedUser,
  type BookingAttributionCampaignListQuery,
  type BookingAttributionSummaryQuery,
  type CreateBookingAttributionCampaignInput,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BookingAttributionService } from './booking-attribution.service';

@Controller('dashboard/salons/:salonId/booking-attribution')
@Roles(Role.SALON_OWNER, Role.PLATFORM_ADMIN)
export class BookingAttributionController {
  constructor(private readonly attribution: BookingAttributionService) {}

  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  summarize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Query(new ZodValidationPipe(bookingAttributionSummaryQuerySchema))
    query: BookingAttributionSummaryQuery,
  ) {
    return this.attribution.summarize(user.id, salonId, query);
  }

  @Get('campaigns')
  @Header('Cache-Control', 'private, no-store')
  listCampaigns(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Query(new ZodValidationPipe(bookingAttributionCampaignListQuerySchema))
    query: BookingAttributionCampaignListQuery,
  ) {
    return this.attribution.listCampaigns(user.id, salonId, query);
  }

  @Post('campaigns')
  createCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Body(new ZodValidationPipe(createBookingAttributionCampaignSchema))
    body: CreateBookingAttributionCampaignInput,
  ) {
    return this.attribution.createCampaign(user.id, salonId, body);
  }

  @Post('campaigns/:campaignId/revoke')
  revokeCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ) {
    return this.attribution.revokeCampaign(user.id, salonId, campaignId);
  }
}
