import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UsePipes,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
import { setRefreshCookie } from '../common/refresh-cookie';
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

  // @Res({passthrough: true}) + setRefreshCookie: registerSalon mints a fresh STAFF-audience
  // session (see its own doc comment) — the web client needs the same httpOnly refresh cookie
  // every login endpoint sets, not just the JSON body mobile reads its tokens from.
  @Roles(Role.CUSTOMER, Role.SALON_OWNER)
  @Post()
  @Idempotent()
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(registerSalonSchema)) body: RegisterSalonInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.salonsService.registerSalon(
      user.id,
      body,
      req.headers['user-agent'],
    );
    setRefreshCookie(res, result.tokens.refreshToken);
    return result;
  }

  // `mine` is a single literal segment vs. the three-segment :countryCode/:citySlug/:salonSlug
  // route below (B9) — different arity, so Nest/Express can never confuse GET /salons/mine/<id>
  // with a public salon lookup regardless of declaration order.
  @Roles(Role.SALON_OWNER)
  @Get(DISCOVERY_PATHS.mine)
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.salonsService.listOwned(user.id);
  }

  // Also a single literal segment, same arity argument as `mine` above. Open to staff as well as
  // owners: this is the only route by which a barber can discover the salon they work at —
  // listMine above is keyed on ownership and returns nothing for them. Read-only identity; it
  // grants no operational permission of its own.
  @Roles(Role.SALON_OWNER, Role.SALON_STAFF)
  @Get(DISCOVERY_PATHS.workplaces)
  listWorkplaces(@CurrentUser() user: AuthenticatedUser) {
    return this.salonsService.listWorkplaces(user.id);
  }

  @Roles(Role.SALON_OWNER, Role.SALON_STAFF)
  @Get(`${DISCOVERY_PATHS.mine}/:salonId`)
  getMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.salonsService.getOwnedSalon(user.id, salonId);
  }

  // Issue #13 Mission G — single literal segment, same arity argument as `mine`/`workplaces`
  // above. Platform-wide aggregate counts only; see LiveStatsDto's own doc comment.
  @Public()
  @Get(DISCOVERY_PATHS.liveStats)
  getLiveStats() {
    return this.salonsService.getLiveStats();
  }

  @Public()
  @Get(':countryCode/:citySlug/:salonSlug/status')
  getPublicStatus(
    @Param('countryCode') countryCode: string,
    @Param('citySlug') citySlug: string,
    @Param('salonSlug') salonSlug: string,
  ) {
    return this.salonsService.getPublicStatus(countryCode, citySlug, salonSlug);
  }

  // B9: country-scoped public salon URL (/{countryCode}/{citySlug}/{salonSlug}). Resolves through
  // CitiesService.findCityByCountryAndSlugOrThrow, an exact (countryCode, slug) lookup, so a
  // salon in "Springfield, US" can never be confused with one in "Springfield, GB" even if both
  // exist. countryCode is case-insensitive here (see CitiesController).
  @Public()
  @Get(':countryCode/:citySlug/:salonSlug')
  getProfile(
    @Param('countryCode') countryCode: string,
    @Param('citySlug') citySlug: string,
    @Param('salonSlug') salonSlug: string,
  ) {
    return this.salonsService.getProfile(countryCode, citySlug, salonSlug);
  }
}
