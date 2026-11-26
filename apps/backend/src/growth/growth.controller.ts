import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ADMIN_PATHS,
  GROWTH_SERVICE_KEYS,
  growthExclusionSchema,
  growthKeywordRunSchema,
  growthPauseSchema,
  growthProposalCreateSchema,
  growthRoleGrantSchema,
  growthTransitionSchema,
  type AuthenticatedUser,
  type GrowthKeywordRunInput,
  type GrowthProposalCreateInput,
  type GrowthServiceKey,
} from '@barbercue/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import {
  GROWTH_STAFF_ROLES,
  GrowthEnabledGuard,
  GrowthFeature,
  GrowthPermissionGuard,
  GrowthPermit,
  fail,
  growthRoleOf,
  permissionsFor,
} from './growth-support';
import { GrowthService } from './growth.service';

const pipe = (schema: z.ZodTypeAny) => new ZodValidationPipe(schema);
const uuid = new ParseUUIDPipe({ version: '4' });

/**
 * Growth AI → Customer Acquisition (admin only, advisory mode). There is deliberately no publish,
 * spend or send route: approval records a decision; it does not act on any platform.
 */
@Controller(`${ADMIN_PATHS.admin}/growth`)
@Roles(...GROWTH_STAFF_ROLES)
@UseGuards(GrowthEnabledGuard, GrowthPermissionGuard)
@GrowthPermit('view')
export class GrowthAdminController {
  constructor(
    private readonly growth: GrowthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.growth.me(user);
  }

  @Get('dashboard')
  @Header('Cache-Control', 'private, no-store')
  dashboard() {
    return this.growth.dashboard();
  }

  @Get('cities')
  cities() {
    return this.growth.cities();
  }

  @Get('salons')
  salons(
    @Query('cityId', uuid) cityId: string,
    @Query('serviceKey') serviceKey: string,
  ) {
    if (!GROWTH_SERVICE_KEYS.includes(serviceKey as GrowthServiceKey))
      throw fail('VALIDATION_ERROR', 'Unknown service.');
    return this.growth.matchedSalons(cityId, serviceKey as GrowthServiceKey);
  }

  // ---------- Keyword research ----------

  @Get('keyword-runs')
  runs() {
    return this.growth.listRuns();
  }

  @Post('keyword-runs')
  @GrowthFeature('GROWTH_AI_KEYWORDS_ENABLED')
  @GrowthPermit('research')
  runKeywords(
    @CurrentUser() user: AuthenticatedUser,
    @Body(pipe(growthKeywordRunSchema)) body: GrowthKeywordRunInput,
  ) {
    return this.growth.runKeywords(user, body);
  }

  @Get('keyword-runs/:id/report')
  @Header('Cache-Control', 'private, no-store')
  report(@Param('id', uuid) id: string) {
    return this.growth.report(id);
  }

  // ---------- Proposals ----------

  @Get('proposals')
  proposals(@Query('status') status?: string) {
    return this.growth.listProposals(
      status && /^[A-Z]{3,12}$/.test(status) ? status : undefined,
    );
  }

  @Post('proposals')
  @GrowthFeature('GROWTH_AI_CAMPAIGNS_ENABLED')
  @GrowthPermit('draft')
  createProposal(
    @CurrentUser() user: AuthenticatedUser,
    @Body(pipe(growthProposalCreateSchema)) body: GrowthProposalCreateInput,
  ) {
    return this.growth.createProposal(user, body);
  }

  @Get('proposals/:id')
  @Header('Cache-Control', 'private, no-store')
  proposal(@Param('id', uuid) id: string) {
    return this.growth.proposal(id);
  }

  @Post('proposals/:id/copy')
  @HttpCode(HttpStatus.OK)
  @GrowthFeature('GROWTH_AI_CAMPAIGNS_ENABLED')
  @GrowthPermit('draft')
  copy(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.growth.draftCopy(user, id);
  }

  /** The action decides the permission (submit/archive: draft; approve/send back/reject: approve). */
  @Post('proposals/:id/transition')
  @HttpCode(HttpStatus.OK)
  @GrowthFeature('GROWTH_AI_CAMPAIGNS_ENABLED')
  async transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(pipe(growthTransitionSchema))
    body: z.infer<typeof growthTransitionSchema>,
  ) {
    const permissions = permissionsFor(await growthRoleOf(this.prisma, user));
    return this.growth.transition(
      user,
      id,
      body.action,
      body.note,
      body.acknowledgeMock === true,
      permissions,
    );
  }

  // ---------- Measurement ----------

  @Get('proposals/:id/measurement')
  @Header('Cache-Control', 'private, no-store')
  @GrowthFeature('GROWTH_AI_MEASUREMENT_ENABLED')
  measurement(@Param('id', uuid) id: string) {
    return this.growth.measurement(id);
  }

  @Get('proposals/:id/measurements')
  @GrowthFeature('GROWTH_AI_MEASUREMENT_ENABLED')
  measurements(@Param('id', uuid) id: string) {
    return this.growth.measurementHistory(id);
  }

  @Post('proposals/:id/measurements')
  @GrowthFeature('GROWTH_AI_MEASUREMENT_ENABLED')
  @GrowthPermit('research')
  recordMeasurement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuid) id: string,
  ) {
    return this.growth.recordMeasurement(user, id);
  }

  // ---------- Usage and settings ----------

  @Get('usage')
  usage() {
    return this.growth.usage();
  }

  @Get('roles')
  @GrowthPermit('settings')
  roles() {
    return this.growth.roles();
  }

  @Put('roles')
  @GrowthPermit('settings')
  grant(
    @CurrentUser() user: AuthenticatedUser,
    @Body(pipe(growthRoleGrantSchema))
    body: z.infer<typeof growthRoleGrantSchema>,
  ) {
    return this.growth.grantRole(user, body.userId, body.role);
  }

  @Delete('roles/:userId')
  @GrowthPermit('settings')
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ) {
    return this.growth.revokeRole(user, userId.slice(0, 64));
  }

  /** Emergency pause: stops every research, drafting, approval and measurement write at once. */
  @Put('pause')
  @GrowthPermit('settings')
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Body(pipe(growthPauseSchema)) body: z.infer<typeof growthPauseSchema>,
  ) {
    return this.growth.setPause(user, body.paused, body.reason);
  }

  @Get('exclusions')
  exclusions() {
    return this.growth.exclusions();
  }

  @Post('exclusions')
  @GrowthPermit('settings')
  exclude(
    @CurrentUser() user: AuthenticatedUser,
    @Body(pipe(growthExclusionSchema))
    body: z.infer<typeof growthExclusionSchema>,
  ) {
    return this.growth.addExclusion(user, body.salonId, body.reason);
  }

  @Delete('exclusions/:salonId')
  @GrowthPermit('settings')
  include(@Param('salonId') salonId: string) {
    return this.growth.removeExclusion(salonId.slice(0, 64));
  }
}
