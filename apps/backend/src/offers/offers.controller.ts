import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  Role,
  createOfferSchema,
  offerListQuerySchema,
  offerPreviewSchema,
  publicOfferQuerySchema,
  updateOfferSchema,
  type AuthenticatedUser,
  type CreateOfferInput,
  type OfferListQuery,
  type OfferPreviewInput,
  type PublicOfferQuery,
  type UpdateOfferInput,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { OffersService } from './offers.service';

@Controller('dashboard/salons/:salonId/offers')
@Roles(Role.SALON_OWNER, Role.PLATFORM_ADMIN)
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Query(new ZodValidationPipe(offerListQuerySchema)) query: OfferListQuery,
  ) {
    return this.offers.listForOwner(actor.id, salonId, query);
  }

  @Get(':offerId')
  @Header('Cache-Control', 'private, no-store')
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.offers.getForOwner(actor.id, salonId, offerId);
  }

  @Post()
  @Idempotent()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Body(new ZodValidationPipe(createOfferSchema)) body: CreateOfferInput,
  ) {
    return this.offers.create(actor.id, salonId, body);
  }

  @Patch(':offerId')
  @Idempotent()
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body(new ZodValidationPipe(updateOfferSchema)) body: UpdateOfferInput,
  ) {
    return this.offers.update(actor.id, salonId, offerId, body);
  }

  @Post('preview')
  previewDraft(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Body(new ZodValidationPipe(createOfferSchema)) body: CreateOfferInput,
  ) {
    return this.offers.previewDraft(actor.id, salonId, body);
  }

  @Post(':offerId/preview')
  previewSaved(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body(new ZodValidationPipe(offerPreviewSchema)) body: OfferPreviewInput,
  ) {
    return this.offers.previewSaved(actor.id, salonId, offerId, body);
  }

  @Post(':offerId/publish')
  @Idempotent()
  publish(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.offers.publish(actor.id, salonId, offerId);
  }

  @Post(':offerId/pause')
  @Idempotent()
  pause(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.offers.pause(actor.id, salonId, offerId);
  }

  @Get(':offerId/stats')
  @Header('Cache-Control', 'private, no-store')
  stats(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.offers.stats(actor.id, salonId, offerId);
  }
}

@Controller('offers')
export class PublicOffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'no-store')
  list(
    @Query(new ZodValidationPipe(publicOfferQuerySchema))
    query: PublicOfferQuery,
  ) {
    return this.offers.publicList(query);
  }
}
