import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import {
  DISCOVERY_PATHS,
  Role,
  registerSalonSchema,
  salonSearchQuerySchema,
  type AuthenticatedUser,
  type RegisterSalonInput,
  type SalonSearchQueryInput,
} from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { SalonsService } from './salons.service';

// GET routes are public/unauthenticated, SEO-facing per API.md's Discovery section; POST (shop
// registration, major-upgrade phase) is authenticated — same resource, same controller, each
// route opts in/out of auth individually via its own decorator (RolesGuard/JwtAuthGuard are
// registered globally; @Public() is this codebase's established per-route opt-out).
@Controller(DISCOVERY_PATHS.salons)
export class SalonsController {
  constructor(private readonly salonsService: SalonsService) {}

  @Public()
  @Get()
  @UsePipes(new ZodValidationPipe(salonSearchQuerySchema))
  search(@Query() query: SalonSearchQueryInput) {
    return this.salonsService.search(query);
  }

  @Roles(Role.CUSTOMER, Role.SALON_OWNER)
  @Post()
  @Idempotent()
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(registerSalonSchema)) body: RegisterSalonInput,
  ) {
    return this.salonsService.registerSalon(user.id, body);
  }

  // Registered ahead of the :citySlug/:salonSlug wildcard below — both are 1-2 segment GETs on
  // the same controller, and Nest/Express matches routes in declaration order, so `mine` must be
  // seen first or a request like GET /salons/mine/<id> would instead be parsed as
  // citySlug="mine", salonSlug="<id>" and 404 as a public salon lookup instead of reaching here.
  @Roles(Role.SALON_OWNER)
  @Get(DISCOVERY_PATHS.mine)
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.salonsService.listOwned(user.id);
  }

  @Roles(Role.SALON_OWNER, Role.SALON_STAFF)
  @Get(`${DISCOVERY_PATHS.mine}/:salonId`)
  getMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.salonsService.getOwnedSalon(user.id, salonId);
  }

  @Public()
  @Get(':citySlug/:salonSlug')
  getProfile(
    @Param('citySlug') citySlug: string,
    @Param('salonSlug') salonSlug: string,
  ) {
    return this.salonsService.getProfile(citySlug, salonSlug);
  }
}
