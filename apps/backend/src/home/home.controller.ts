import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { z } from 'zod';
import {
  HOME_CODE_PATTERN,
  homeAddressSchema,
  homeAdjustmentSchema,
  homeAreasSchema,
  homeBookingSchema,
  homeFeedbackSchema,
  homeFreelancerRegisterSchema,
  homeHoldSchema,
  homeHygieneSchema,
  homeIncidentSchema,
  homeOfferingSchema,
  homePackageSchema,
  homePaymentSchema,
  homeProfessionalSchema,
  homeProviderSettingsSchema,
  homeProviderTermsSchema,
  homePromotionSchema,
  homeQuoteSchema,
  homeReasonSchema,
  homeRecurringSchema,
  homeRescheduleSchema,
  homeReviewSchema,
  homeSearchSchema,
  homeTicketSchema,
  homeTimeOffSchema,
  homeVerificationSubmitSchema,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { HomeAdminService } from './home-admin.service';
import { HomeBookingService, type HomeViewer } from './home-booking.service';
import { HomeCatalogService } from './home-catalog.service';
import { HomeCustomerService } from './home-customer.service';
import { HomeEnabledGuard, homeInvalid, homeNotFound } from './home-errors';
import { HomeProviderService } from './home-provider.service';
import { HomeQuoteService } from './home-quote.service';
import { HomeVisitService } from './home-visit.service';

export const zod = <T extends z.ZodTypeAny>(s: T) => new ZodValidationPipe(s);
export const code = (v: string): string => {
  if (!HOME_CODE_PATTERN.test(v)) throw homeNotFound('Booking not found.');
  return v;
};
const key = (v: string | undefined): string => {
  if (!v || v.length < 8 || v.length > 128)
    throw homeInvalid('An Idempotency-Key header is required.');
  return v;
};
const STRICT = { default: { limit: 10, ttl: 60_000 } };
const LOOKUP = { default: { limit: 40, ttl: 60_000 } };
const LOCATION = { default: { limit: 30, ttl: 60_000 } };
const slotsSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quote: z.record(z.unknown()),
  })
  .strict();
const pageSchema = z.object({
  scope: z.enum(['active', 'history']).default('active'),
  page: z.coerce.number().int().min(1).max(500).default(1),
});
const otpSchema = z.object({ otp: z.string().regex(/^\d{6}$/) }).strict();
const codeSchema = z.object({ code: z.string().min(4).max(120) }).strict();
const answerSchema = z.object({ approve: z.boolean() }).strict();
const textSchema = z
  .object({ text: z.string().trim().min(2).max(300) })
  .strict();
const messageSchema = z
  .object({ message: z.string().trim().min(1).max(2000) })
  .strict();
const FILE = () =>
  FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
type Up = { buffer: Buffer } | undefined;

/** Public discovery. Off (404) until FASTQUE_HOME_ENABLED. */
@Controller('home')
@Public()
export class HomePublicController {
  constructor(
    private readonly catalog: HomeCatalogService,
    private readonly quotes: HomeQuoteService,
    private readonly bookings: HomeBookingService,
    private readonly customers: HomeCustomerService,
    private readonly admin: HomeAdminService,
  ) {}

  @Get('config')
  config() {
    return this.catalog.config();
  }

  @Get('landing')
  @UseGuards(HomeEnabledGuard)
  @Header('Cache-Control', 'public, max-age=30')
  landing() {
    return this.catalog.landing(null);
  }

  @Get('categories')
  @UseGuards(HomeEnabledGuard)
  categories() {
    return this.catalog.categories();
  }

  @Get('search')
  @UseGuards(HomeEnabledGuard)
  search(@Query(zod(homeSearchSchema)) q: z.infer<typeof homeSearchSchema>) {
    return this.catalog.search(q);
  }

  @Get('professionals/:id')
  @UseGuards(HomeEnabledGuard)
  professional(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.professional(id);
  }

  @Post('understand')
  @UseGuards(HomeEnabledGuard)
  @HttpCode(HttpStatus.OK)
  understand(@Body(zod(textSchema)) b: { text: string }) {
    return this.admin.understand(b.text);
  }

  @Get('campaigns')
  @UseGuards(HomeEnabledGuard)
  campaigns(@Query('city') city?: string, @Query('pincode') pincode?: string) {
    return this.customers.campaigns({ city, pincode });
  }

  @Post('quote')
  @UseGuards(HomeEnabledGuard)
  @Throttle(LOOKUP)
  @HttpCode(HttpStatus.OK)
  async quote(@Body(zod(homeQuoteSchema)) q: z.infer<typeof homeQuoteSchema>) {
    return this.quotes.dto(await this.quotes.quote(q, null));
  }

  @Post('slots')
  @UseGuards(HomeEnabledGuard)
  @Throttle(LOOKUP)
  @HttpCode(HttpStatus.OK)
  slots(@Body(zod(slotsSchema)) b: z.infer<typeof slotsSchema>) {
    const q = homeQuoteSchema.parse({
      ...b.quote,
      mode: 'INSTANT',
      startAt: undefined,
    });
    return this.quotes.slots(q, b.date, null);
  }

  @Post('guest/holds')
  @UseGuards(HomeEnabledGuard)
  @Throttle(STRICT)
  hold(@Body(zod(homeHoldSchema)) b: z.infer<typeof homeHoldSchema>) {
    return this.bookings.hold(b.quote, null);
  }

  @Post('guest/bookings')
  @UseGuards(HomeEnabledGuard)
  @Throttle(STRICT)
  create(
    @Body(zod(homeBookingSchema)) b: z.infer<typeof homeBookingSchema>,
    @Headers('idempotency-key') k?: string,
  ) {
    return this.bookings.create(b, null, key(k));
  }

  @Get('shared/:token')
  @Throttle(LOOKUP)
  shared(@Param('token') token: string) {
    return this.customers.shared(token);
  }
}

/** Guest booking access: needs the unguessable token issued once at booking, never just the code. */
@Controller('home/guest/bookings/:code')
@Public()
@Throttle(LOOKUP)
export class HomeGuestController {
  constructor(
    private readonly bookings: HomeBookingService,
    private readonly visits: HomeVisitService,
    private readonly customers: HomeCustomerService,
  ) {}
  private v(token?: string): HomeViewer {
    return { userId: null, guestToken: token ?? null };
  }

  @Get()
  view(@Param('code') c: string, @Headers('x-home-access') t?: string) {
    return this.bookings.view(code(c), this.v(t));
  }
  @Post('phone-code')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  phone(@Param('code') c: string, @Headers('x-home-access') t?: string) {
    return this.bookings.guestSendCode(code(c), this.v(t));
  }
  @Post('phone-verify')
  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  verify(
    @Param('code') c: string,
    @Body(zod(otpSchema)) b: { otp: string },
    @Headers('x-home-access') t?: string,
  ) {
    return this.bookings.guestVerify(code(c), this.v(t), b.otp);
  }
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('code') c: string,
    @Body(zod(homeReasonSchema)) b: { reason: string },
    @Headers('x-home-access') t?: string,
  ) {
    return this.bookings.cancel(code(c), this.v(t), b.reason);
  }
  @Get('tracking')
  tracking(@Param('code') c: string, @Headers('x-home-access') t?: string) {
    return this.visits.tracking(code(c), this.v(t));
  }
  @Post('start-code')
  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  startCode(@Param('code') c: string, @Headers('x-home-access') t?: string) {
    return this.visits.issueCode(code(c), this.v(t), 'START');
  }
  @Post('tickets')
  ticket(
    @Param('code') c: string,
    @Body(zod(homeTicketSchema)) b: z.infer<typeof homeTicketSchema>,
    @Headers('x-home-access') t?: string,
  ) {
    return this.customers.openTicket(code(c), this.v(t), b);
  }
  @Post('review')
  review(
    @Param('code') c: string,
    @Body(zod(homeReviewSchema)) b: z.infer<typeof homeReviewSchema>,
    @Headers('x-home-access') t?: string,
  ) {
    return this.customers.review(code(c), this.v(t), b);
  }
  @Post('incident')
  incident(
    @Param('code') c: string,
    @Body(zod(homeIncidentSchema)) b: z.infer<typeof homeIncidentSchema>,
    @Headers('x-home-access') t?: string,
  ) {
    return this.customers.incident(this.v(t), b.kind, b.description, code(c));
  }
}

/** Signed-in customer. Creating needs the flag; everything about existing bookings always works. */
@Controller('home/me')
export class HomeCustomerController {
  constructor(
    private readonly catalog: HomeCatalogService,
    private readonly quotes: HomeQuoteService,
    private readonly bookings: HomeBookingService,
    private readonly visits: HomeVisitService,
    private readonly customers: HomeCustomerService,
    private readonly admin: HomeAdminService,
  ) {}
  private v(u: AuthenticatedUser): HomeViewer {
    return { userId: u.id };
  }

  @Get('landing')
  @UseGuards(HomeEnabledGuard)
  landing(@CurrentUser() u: AuthenticatedUser) {
    return this.catalog.landing(u.id);
  }
  @Get('addresses')
  addresses(@CurrentUser() u: AuthenticatedUser) {
    return this.customers.addresses(u.id);
  }
  @Post('addresses')
  addAddress(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeAddressSchema)) b: z.infer<typeof homeAddressSchema>,
  ) {
    return this.customers.saveAddress(u.id, b);
  }
  @Put('addresses/:id')
  editAddress(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(homeAddressSchema)) b: z.infer<typeof homeAddressSchema>,
  ) {
    return this.customers.saveAddress(u.id, b, id);
  }
  @Delete('addresses/:id')
  removeAddress(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.removeAddress(u.id, id);
  }
  @Get('favorites')
  favorites(@CurrentUser() u: AuthenticatedUser) {
    return this.customers.favorites(u.id);
  }
  @Put('favorites/:id')
  fav(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.favorite(u.id, id, true);
  }
  @Delete('favorites/:id')
  unfav(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.favorite(u.id, id, false);
  }
  @Get('suggestions')
  suggestions(@CurrentUser() u: AuthenticatedUser) {
    return this.admin.retention(u.id);
  }
  @Post('quote')
  @UseGuards(HomeEnabledGuard)
  @Throttle(LOOKUP)
  @HttpCode(HttpStatus.OK)
  async quote(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeQuoteSchema)) q: z.infer<typeof homeQuoteSchema>,
  ) {
    return this.quotes.dto(await this.quotes.quote(q, u.id));
  }
  @Post('slots')
  @UseGuards(HomeEnabledGuard)
  @Throttle(LOOKUP)
  @HttpCode(HttpStatus.OK)
  slots(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(slotsSchema)) b: z.infer<typeof slotsSchema>,
  ) {
    return this.quotes.slots(
      homeQuoteSchema.parse({
        ...b.quote,
        mode: 'INSTANT',
        startAt: undefined,
      }),
      b.date,
      u.id,
    );
  }
  @Post('holds')
  @UseGuards(HomeEnabledGuard)
  @Throttle(STRICT)
  hold(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeHoldSchema)) b: z.infer<typeof homeHoldSchema>,
  ) {
    return this.bookings.hold(b.quote, u.id);
  }
  @Delete('holds/:id')
  async releaseHold(@Param('id', ParseUUIDPipe) id: string) {
    await this.bookings.releaseHold(id);
    return { ok: true };
  }
  @Get('bookings')
  list(
    @CurrentUser() u: AuthenticatedUser,
    @Query(zod(pageSchema)) q: z.infer<typeof pageSchema>,
  ) {
    return this.bookings.listForCustomer(u.id, q.scope, q.page);
  }
  @Post('bookings')
  @UseGuards(HomeEnabledGuard)
  @Throttle(STRICT)
  create(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeBookingSchema)) b: z.infer<typeof homeBookingSchema>,
    @Headers('idempotency-key') k?: string,
  ) {
    return this.bookings.create(b, u.id, key(k));
  }
  @Get('bookings/:code')
  view(@CurrentUser() u: AuthenticatedUser, @Param('code') c: string) {
    return this.bookings.view(code(c), this.v(u));
  }
  @Post('bookings/:code/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Body(zod(homeReasonSchema)) b: { reason: string },
  ) {
    return this.bookings.cancel(code(c), this.v(u), b.reason);
  }
  @Post('bookings/:code/reschedule')
  @HttpCode(HttpStatus.OK)
  reschedule(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Body(zod(homeRescheduleSchema)) b: z.infer<typeof homeRescheduleSchema>,
  ) {
    return this.bookings.reschedule(
      code(c),
      this.v(u),
      new Date(b.startAt),
      b.reason,
    );
  }
  @Post('bookings/:code/reschedule/answer')
  @HttpCode(HttpStatus.OK)
  answer(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Body(zod(answerSchema)) b: { approve: boolean },
  ) {
    return this.bookings.answerReschedule(code(c), this.v(u), b.approve);
  }
  @Post('bookings/:code/replacement')
  @HttpCode(HttpStatus.OK)
  replacement(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Body(zod(z.object({ choice: z.enum(['APPROVE', 'ANY']) }).strict()))
    b: { choice: 'APPROVE' | 'ANY' },
  ) {
    return this.bookings.answerReplacement(code(c), this.v(u), b.choice);
  }
  @Post('bookings/:code/no-show')
  @HttpCode(HttpStatus.OK)
  noShow(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Body(zod(homeReasonSchema)) b: { reason: string },
  ) {
    return this.visits.professionalNoShow(code(c), this.v(u), b.reason);
  }
  @Post('bookings/:code/interrupt')
  @HttpCode(HttpStatus.OK)
  interrupt(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Body(zod(homeReasonSchema)) b: { reason: string },
  ) {
    return this.visits.interrupt(code(c), this.v(u), b.reason);
  }
  @Get('bookings/:code/tracking')
  tracking(@CurrentUser() u: AuthenticatedUser, @Param('code') c: string) {
    return this.visits.tracking(code(c), this.v(u));
  }
  @Post('bookings/:code/start-code')
  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  startCode(@CurrentUser() u: AuthenticatedUser, @Param('code') c: string) {
    return this.visits.issueCode(code(c), this.v(u), 'START');
  }
  @Post('bookings/:code/completion-code')
  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  endCode(@CurrentUser() u: AuthenticatedUser, @Param('code') c: string) {
    return this.visits.issueCode(code(c), this.v(u), 'COMPLETE');
  }
  @Post('bookings/:code/extras/:id')
  @HttpCode(HttpStatus.OK)
  extra(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(answerSchema)) b: { approve: boolean },
  ) {
    return this.visits.decideAdjustment(code(c), this.v(u), id, b.approve);
  }
  @Post('bookings/:code/payments/:id')
  @HttpCode(HttpStatus.OK)
  payment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      zod(
        z
          .object({
            agree: z.boolean(),
            note: z.string().trim().max(500).optional(),
          })
          .strict(),
      ),
    )
    b: { agree: boolean; note?: string },
  ) {
    return this.visits.customerPaymentAnswer(
      code(c),
      this.v(u),
      id,
      b.agree,
      b.note,
    );
  }
  @Post('bookings/:code/review')
  review(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Body(zod(homeReviewSchema)) b: z.infer<typeof homeReviewSchema>,
  ) {
    return this.customers.review(code(c), this.v(u), b);
  }
  @Post('bookings/:code/tickets')
  @UseInterceptors(FILE())
  ticket(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Body(zod(homeTicketSchema)) b: z.infer<typeof homeTicketSchema>,
    @UploadedFile() file?: Up,
  ) {
    return this.customers.openTicket(code(c), this.v(u), b, file);
  }
  @Get('bookings/:code/tickets/:id')
  getTicket(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.ticket(code(c), this.v(u), id);
  }
  @Post('bookings/:code/tickets/:id')
  reply(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(messageSchema)) b: { message: string },
  ) {
    return this.customers.replyTicket(code(c), this.v(u), id, b.message);
  }
  @Post('bookings/:code/incident')
  incident(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Body(zod(homeIncidentSchema)) b: z.infer<typeof homeIncidentSchema>,
  ) {
    return this.customers.incident(this.v(u), b.kind, b.description, code(c));
  }
  @Post('bookings/:code/share')
  share(@CurrentUser() u: AuthenticatedUser, @Param('code') c: string) {
    return this.customers.share(code(c), this.v(u));
  }
  @Post('bookings/:code/block')
  block(@CurrentUser() u: AuthenticatedUser, @Param('code') c: string) {
    return this.customers.block(code(c), this.v(u));
  }
  @Get('bookings/:code/rebook')
  rebook(@CurrentUser() u: AuthenticatedUser, @Param('code') c: string) {
    return this.customers.rebook(code(c), this.v(u));
  }
  @Get('recurring')
  recurring(@CurrentUser() u: AuthenticatedUser) {
    return this.customers.recurring(u.id);
  }
  @Post('recurring')
  @UseGuards(HomeEnabledGuard)
  addRecurring(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeRecurringSchema)) b: z.infer<typeof homeRecurringSchema>,
  ) {
    return this.customers.createRecurring(u.id, b);
  }
  @Put('recurring/:id')
  editRecurring(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      zod(
        z
          .object({
            status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']).optional(),
            intervalDays: z.number().int().min(7).max(90).optional(),
            nextStart: z.string().datetime().optional(),
          })
          .strict(),
      ),
    )
    b: {
      status?: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
      intervalDays?: number;
      nextStart?: string;
    },
  ) {
    return this.customers.updateRecurring(u.id, id, b);
  }
  @Post('campaigns/:id/join')
  @UseGuards(HomeEnabledGuard)
  join(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(z.object({ addressId: z.string().uuid() }).strict()))
    b: { addressId: string },
  ) {
    return this.customers.joinCampaign(u.id, id, b.addressId);
  }
  @Post('campaigns/:id/leave')
  leave(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.leaveCampaign(u.id, id);
  }
  @Post('campaigns/:id/price')
  campaignPrice(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(answerSchema)) b: { approve: boolean },
  ) {
    return this.customers.answerCampaignPrice(u.id, id, b.approve);
  }
  @Get('export')
  export(@CurrentUser() u: AuthenticatedUser) {
    return this.customers.exportMine(u.id);
  }
  @Delete('data')
  erase(@CurrentUser() u: AuthenticatedUser) {
    return this.customers.eraseMine(u.id);
  }
}

/** The professional's own dashboard - any signed-in person with a home profile (staff or independent). */
@Controller('home/pro')
export class HomeProController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: HomeProviderService,
    private readonly bookings: HomeBookingService,
    private readonly visits: HomeVisitService,
    private readonly customers: HomeCustomerService,
  ) {}
  private v(u: AuthenticatedUser): HomeViewer {
    return { userId: u.id };
  }
  private async mine(u: AuthenticatedUser) {
    const p = await this.providers.myIndependent(u.id);
    if (!p)
      throw homeNotFound('Register as an independent professional first.');
    return p;
  }

  @Get('profile')
  async profile(@CurrentUser() u: AuthenticatedUser) {
    const ind = await this.providers.myIndependent(u.id);
    return {
      profiles: await this.providers.myProfiles(u.id),
      independent: ind ? await this.providers.dashboard(ind.id) : null,
    };
  }
  @Get('prefill')
  prefill(@CurrentUser() u: AuthenticatedUser) {
    return this.providers.prefill(u.id);
  }
  @Post('register')
  @UseGuards(HomeEnabledGuard)
  register(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeFreelancerRegisterSchema))
    b: z.infer<typeof homeFreelancerRegisterSchema>,
  ) {
    return this.providers.registerIndependent(u.id, b);
  }
  @Put('settings')
  async settings(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeProviderSettingsSchema))
    b: z.infer<typeof homeProviderSettingsSchema>,
  ) {
    return this.providers.updateSettings(await this.mine(u), u.id, b);
  }
  @Post('terms')
  async terms(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeProviderTermsSchema))
    b: z.infer<typeof homeProviderTermsSchema>,
  ) {
    return this.providers.acceptTerms(await this.mine(u), u.id, b.adult);
  }
  @Post('submit')
  async submit(@CurrentUser() u: AuthenticatedUser) {
    return this.providers.submit(await this.mine(u), u.id);
  }
  @Put('offerings')
  async offering(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeOfferingSchema)) b: z.infer<typeof homeOfferingSchema>,
  ) {
    return this.providers.saveOffering(await this.mine(u), u.id, b);
  }
  @Put('areas')
  async areas(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeAreasSchema)) b: z.infer<typeof homeAreasSchema>,
  ) {
    return this.providers.saveAreas(await this.mine(u), u.id, b.areas);
  }
  @Put('profiles/:id')
  async update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(homeProfessionalSchema))
    b: z.infer<typeof homeProfessionalSchema>,
  ) {
    const row = await this.providers.myProfile(u.id, id);
    await this.providers.updateProfessional(row.provider, id, b, true);
    return this.profile(u);
  }
  @Post('profiles/:id/consent')
  consent(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(z.object({ consent: z.boolean() }).strict()))
    b: { consent: boolean },
  ) {
    return this.providers.setConsent(u.id, id, b.consent);
  }
  @Post('profiles/:id/online')
  online(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(z.object({ online: z.boolean() }).strict()))
    b: { online: boolean },
  ) {
    return this.providers.setOnline(u.id, id, b.online);
  }
  @Post('profiles/:id/verifications')
  @UseInterceptors(FILE())
  verification(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(homeVerificationSubmitSchema))
    b: z.infer<typeof homeVerificationSubmitSchema>,
    @UploadedFile() file?: Up,
  ) {
    return this.providers.submitVerification(u.id, id, b, file);
  }
  @Get('verifications/:id/file')
  async evidence(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    sendPrivate(
      res,
      await this.providers.evidence(id, { userId: u.id, admin: false }),
    );
  }
  @Get('calendar')
  calendar(
    @CurrentUser() u: AuthenticatedUser,
    @Query(
      zod(z.object({ from: z.string().datetime(), to: z.string().datetime() })),
    )
    q: { from: string; to: string },
  ) {
    return this.providers.calendar(u.id, new Date(q.from), new Date(q.to));
  }
  @Post('time-off')
  timeOff(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeTimeOffSchema)) b: z.infer<typeof homeTimeOffSchema>,
  ) {
    return this.providers.addTimeOff(u.id, b);
  }
  @Delete('time-off/:id')
  removeTimeOff(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.providers.removeTimeOff(u.id, id);
  }
  @Get('requests')
  requests(@CurrentUser() u: AuthenticatedUser) {
    return this.bookings.requestsFor(u.id);
  }
  @Post('requests/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookings.accept(id, u.id);
  }
  @Post('requests/:id/decline')
  @HttpCode(HttpStatus.OK)
  decline(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      zod(z.object({ note: z.string().trim().max(300).optional() }).strict()),
    )
    b: { note?: string },
  ) {
    return this.bookings.decline(id, u.id, b.note);
  }
  @Get('bookings')
  list(
    @CurrentUser() u: AuthenticatedUser,
    @Query(zod(pageSchema)) q: z.infer<typeof pageSchema>,
  ) {
    return this.bookings.list(
      {
        assignments: {
          some: {
            professional: { userId: u.id },
            status: q.scope === 'active' ? 'ACTIVE' : 'COMPLETED',
          },
        },
      },
      'PROFESSIONAL',
      q.page,
      25,
      q.scope === 'active' ? 'asc' : 'desc',
    );
  }
  @Get('bookings/:code')
  view(@CurrentUser() u: AuthenticatedUser, @Param('code') c: string) {
    return this.bookings.view(code(c), this.v(u));
  }
  @Post('bookings/:code/:action')
  @HttpCode(HttpStatus.OK)
  async act(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Param('action') action: string,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') k?: string,
  ): Promise<unknown> {
    const b = code(c);
    const v = this.v(u);
    const reason = () => homeParse(homeReasonSchema, body).reason;
    switch (action) {
      case 'prepare':
        return this.visits.prepare(b, v);
      case 'on-the-way':
        return this.visits.onTheWay(b, v);
      case 'arrived':
        return this.visits.arrived(b, v);
      case 'address-issue':
        return this.visits.addressIssue(b, v, reason());
      case 'customer-no-show':
        return this.visits.customerNoShow(b, v, reason());
      case 'delay': {
        const d = homeParse(
          z
            .object({
              minutes: z.number().int().min(5).max(180),
              reason: z.string().max(300).optional(),
            })
            .strict(),
          body,
        );
        return this.visits.delay(b, v, d.minutes, d.reason);
      }
      case 'check-in':
        return this.visits.checkIn(b, v, homeParse(codeSchema, body).code);
      case 'start':
        return this.visits.start(b, v);
      case 'interrupt':
        return this.visits.interrupt(b, v, reason());
      case 'hygiene': {
        const h = homeParse(homeHygieneSchema, body);
        return this.visits.hygiene(b, v, h.stage, h.answers);
      }
      case 'extras':
        return this.visits.requestAdjustment(
          b,
          v,
          homeParse(homeAdjustmentSchema, body),
        );
      case 'complete': {
        const d = homeParse(
          z
            .object({
              code: z.string().max(120).optional(),
              productUse: z
                .array(
                  z
                    .object({
                      productId: z.string().max(60),
                      quantity: z.number().positive().max(1000),
                    })
                    .strict(),
                )
                .max(20)
                .optional(),
            })
            .strict(),
          body,
        );
        return this.visits.complete(b, v, d);
      }
      case 'payment':
        return this.visits.recordPayment(
          b,
          v,
          homeParse(homePaymentSchema, body),
          key(k),
        );
      case 'cancel':
        return this.bookings.cancel(b, v, reason());
      case 'cannot-come':
        return this.bookings.requestReplacement(b, v, reason());
      case 'reschedule': {
        const d = homeParse(homeRescheduleSchema, body);
        return this.bookings.reschedule(b, v, new Date(d.startAt), d.reason);
      }
      case 'reschedule-answer':
        return this.bookings.answerReschedule(
          b,
          v,
          homeParse(answerSchema, body).approve,
        );
      case 'feedback':
        return this.customers.feedback(
          b,
          v,
          homeParse(homeFeedbackSchema, body),
        );
      case 'incident': {
        const d = homeParse(homeIncidentSchema, body);
        return this.customers.incident(v, d.kind, d.description, b);
      }
      case 'ticket':
        return this.customers.openTicket(
          b,
          v,
          homeParse(homeTicketSchema, body),
        );
      case 'share':
        return this.customers.share(b, v);
      case 'block':
        return this.customers.block(b, v);
      case 'tracking-start':
        return this.visits.startTracking(
          b,
          v,
          homeParse(z.object({ consent: z.boolean() }).strict(), body).consent,
        );
      case 'tracking-stop':
        return this.visits.stopTracking(b, v);
      default:
        throw homeNotFound();
    }
  }
  @Put('bookings/:code/location')
  @Throttle(LOCATION)
  location(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Body(
      zod(
        z
          .object({
            lat: z.number().min(-90).max(90),
            lng: z.number().min(-180).max(180),
            accuracy: z.number().min(0).max(100000).optional(),
          })
          .strict(),
      ),
    )
    b: { lat: number; lng: number; accuracy?: number },
  ) {
    return this.visits.pushLocation(code(c), this.v(u), b);
  }
  @Get('earnings')
  async earnings(
    @CurrentUser() u: AuthenticatedUser,
    @Query(
      zod(z.object({ from: z.string().datetime(), to: z.string().datetime() })),
    )
    q: { from: string; to: string },
  ) {
    const ids = await this.prisma.homeProfessional.findMany({
      where: { userId: u.id, provider: { kind: 'INDEPENDENT_PROFESSIONAL' } },
      select: { id: true },
    });
    // Salon staff see visit counts, not the salon's money: their pay is the salon's own payroll.
    if (ids.length === 0)
      return {
        visits: await this.prisma.homeAssignment.count({
          where: {
            professional: { userId: u.id },
            status: 'COMPLETED',
            releasedAt: { gte: new Date(q.from), lt: new Date(q.to) },
          },
        }),
        salonManaged: true,
        note: 'Your salon manages payment for these visits.',
      };
    return this.providers.earnings(
      { professionalIds: ids.map((i) => i.id) },
      new Date(q.from),
      new Date(q.to),
    );
  }
  @Get('reviews')
  reviews(@CurrentUser() u: AuthenticatedUser) {
    return this.prisma.homeReview.findMany({
      where: { professional: { userId: u.id }, status: { not: 'HIDDEN' } },
      select: {
        id: true,
        overall: true,
        comment: true,
        response: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
  @Post('reviews/:id/respond')
  respond(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(messageSchema)) b: { message: string },
  ) {
    return this.customers.respondReview(id, u.id, b.message);
  }
  @Post('reviews/:id/report')
  report(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(homeReasonSchema)) b: { reason: string },
  ) {
    return this.customers.reportReview(id, u.id, b.reason);
  }
  @Post('incident')
  incident(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeIncidentSchema)) b: z.infer<typeof homeIncidentSchema>,
  ) {
    return this.customers.incident(this.v(u), b.kind, b.description);
  }
}

export function homeParse<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): z.infer<T> {
  return new ZodValidationPipe(schema).transform(body, {
    type: 'body',
  });
}
export function sendPrivate(res: Response, f: { body: Buffer; type: string }) {
  res.setHeader('Content-Type', f.type);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.send(f.body);
}

/** Salon owner tab. Every route re-proves ownership of THIS salon. */
@Controller('dashboard/salons/:salonId/home')
export class HomeOwnerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: HomeProviderService,
    private readonly bookings: HomeBookingService,
    private readonly visits: HomeVisitService,
    private readonly customers: HomeCustomerService,
    private readonly admin: HomeAdminService,
  ) {}

  @Get()
  async get(@CurrentUser() u: AuthenticatedUser, @Param('salonId') s: string) {
    const p = await this.providers.salonProvider(u.id, s);
    return p
      ? {
          enabled: true,
          provider: await this.providers.dashboard(p.id),
          overview: await this.providers.overview(p),
        }
      : { enabled: false, provider: null, overview: null };
  }
  @Post('enable')
  enable(@CurrentUser() u: AuthenticatedUser, @Param('salonId') s: string) {
    return this.providers.enableSalon(u.id, s);
  }
  @Get('sources')
  sources(@CurrentUser() u: AuthenticatedUser, @Param('salonId') s: string) {
    return this.providers.ownerServices(u.id, s);
  }
  @Post('terms')
  async terms(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
    @Body(zod(homeProviderTermsSchema))
    b: z.infer<typeof homeProviderTermsSchema>,
  ) {
    return this.providers.acceptTerms(
      await this.providers.requireSalonProvider(u.id, s),
      u.id,
      b.adult,
    );
  }
  @Post('submit')
  async submit(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
  ) {
    return this.providers.submit(
      await this.providers.requireSalonProvider(u.id, s),
      u.id,
    );
  }
  @Put('settings')
  async settings(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
    @Body(zod(homeProviderSettingsSchema))
    b: z.infer<typeof homeProviderSettingsSchema>,
  ) {
    return this.providers.updateSettings(
      await this.providers.requireSalonProvider(u.id, s),
      u.id,
      b,
    );
  }
  @Put('offerings')
  async offering(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
    @Body(zod(homeOfferingSchema)) b: z.infer<typeof homeOfferingSchema>,
  ) {
    return this.providers.saveOffering(
      await this.providers.requireSalonProvider(u.id, s),
      u.id,
      b,
    );
  }
  @Put('areas')
  async areas(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
    @Body(zod(homeAreasSchema)) b: z.infer<typeof homeAreasSchema>,
  ) {
    return this.providers.saveAreas(
      await this.providers.requireSalonProvider(u.id, s),
      u.id,
      b.areas,
    );
  }
  @Post('staff/:staffId')
  staff(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
    @Param('staffId') staffId: string,
  ) {
    return this.providers.addStaff(u.id, s, staffId);
  }
  @Put('professionals/:id')
  async professional(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(homeProfessionalSchema))
    b: z.infer<typeof homeProfessionalSchema>,
  ) {
    return this.providers.updateProfessional(
      await this.providers.requireSalonProvider(u.id, s),
      id,
      b,
      false,
    );
  }
  @Get('bookings')
  async list(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
    @Query(
      zod(
        z.object({
          tab: z.enum([
            'incoming',
            'upcoming',
            'active',
            'completed',
            'cancellations',
          ]),
          page: z.coerce.number().int().min(1).max(500).default(1),
        }),
      ),
    )
    q: { tab: string; page: number },
  ) {
    const p = await this.providers.requireSalonProvider(u.id, s);
    const sets: Record<string, string[]> = {
      incoming: [
        'REQUESTED',
        'AWAITING_ASSIGNMENT',
        'INVITED',
        'NO_PROFESSIONAL',
        'REPLACEMENT_REQUESTED',
      ],
      upcoming: ['ACCEPTED', 'CONFIRMED', 'PREPARING', 'RESCHEDULE_REQUESTED'],
      active: [
        'ON_THE_WAY',
        'ARRIVED',
        'CHECKED_IN',
        'IN_PROGRESS',
        'ADDRESS_ISSUE',
        'INTERRUPTED',
      ],
      completed: [
        'COMPLETED',
        'PAYMENT_PENDING',
        'PAYMENT_CONFIRMED',
        'CLOSED',
      ],
      cancellations: [
        'CANCELLED_BY_CUSTOMER',
        'CANCELLED_BY_PROFESSIONAL',
        'CANCELLED_BY_SALON',
        'CANCELLED_BY_PLATFORM',
        'CUSTOMER_NO_SHOW',
        'PROFESSIONAL_NO_SHOW',
        'EXPIRED',
      ],
    };
    return this.bookings.list(
      { providerId: p.id, status: { in: sets[q.tab] as never } },
      'PROVIDER',
      q.page,
      25,
      ['incoming', 'upcoming', 'active'].includes(q.tab) ? 'asc' : 'desc',
    );
  }
  private async own(u: AuthenticatedUser, salonId: string, c: string) {
    const p = await this.providers.requireSalonProvider(u.id, salonId);
    const b = await this.prisma.homeBooking.findFirst({
      where: { code: code(c), providerId: p.id },
      select: { id: true, code: true },
    });
    if (!b) throw homeNotFound('Booking not found.');
    return b;
  }
  @Get('bookings/:code')
  async view(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
    @Param('code') c: string,
  ) {
    const b = await this.own(u, s, c);
    return this.bookings.view(b.code, { userId: u.id });
  }
  @Post('bookings/:code/:action')
  @HttpCode(HttpStatus.OK)
  async act(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
    @Param('code') c: string,
    @Param('action') action: string,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') k?: string,
  ): Promise<unknown> {
    const b = await this.own(u, s, c);
    const v: HomeViewer = { userId: u.id };
    switch (action) {
      case 'assign':
        return this.bookings.ownerAssign(
          b.id,
          homeParse(
            z.object({ professionalId: z.string().uuid() }).strict(),
            body,
          ).professionalId,
          u.id,
        );
      case 'cancel':
        return this.bookings.cancel(
          b.code,
          v,
          homeParse(homeReasonSchema, body).reason,
        );
      case 'reschedule': {
        const d = homeParse(homeRescheduleSchema, body);
        return this.bookings.reschedule(
          b.code,
          v,
          new Date(d.startAt),
          d.reason,
        );
      }
      case 'reschedule-answer':
        return this.bookings.answerReschedule(
          b.code,
          v,
          homeParse(answerSchema, body).approve,
        );
      case 'replacement': {
        const d = homeParse(
          z
            .object({
              reason: z.string().trim().min(3).max(500),
              professionalId: z.string().uuid().optional(),
            })
            .strict(),
          body,
        );
        return this.bookings.requestReplacement(
          b.code,
          v,
          d.reason,
          d.professionalId,
        );
      }
      case 'payment':
        return this.visits.recordPayment(
          b.code,
          v,
          homeParse(homePaymentSchema, body),
          key(k),
        );
      default:
        throw homeNotFound();
    }
  }
  @Get('reviews')
  async reviews(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
  ) {
    const p = await this.providers.requireSalonProvider(u.id, s);
    return this.prisma.homeReview.findMany({
      where: { providerId: p.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        overall: true,
        comment: true,
        response: true,
        status: true,
        createdAt: true,
        professional: { select: { displayName: true } },
      },
    });
  }
  @Post('reviews/:id/respond')
  respond(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(messageSchema)) b: { message: string },
  ) {
    return this.customers.respondReview(id, u.id, b.message);
  }
  @Post('reviews/:id/report')
  report(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(homeReasonSchema)) b: { reason: string },
  ) {
    return this.customers.reportReview(id, u.id, b.reason);
  }
  @Get('earnings')
  async earnings(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
    @Query(
      zod(z.object({ from: z.string().datetime(), to: z.string().datetime() })),
    )
    q: { from: string; to: string },
  ) {
    const p = await this.providers.requireSalonProvider(u.id, s);
    return this.providers.earnings(
      { providerId: p.id },
      new Date(q.from),
      new Date(q.to),
    );
  }
  @Get('settlements')
  async settlements(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
  ) {
    const p = await this.providers.requireSalonProvider(u.id, s);
    return this.prisma.homeSettlement.findMany({
      where: { providerId: p.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Get('promotions')
  async promotions(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
  ) {
    const p = await this.providers.requireSalonProvider(u.id, s);
    const [promotions, packages] = await Promise.all([
      this.prisma.homePromotion.findMany({ where: { providerId: p.id } }),
      this.prisma.homePackage.findMany({ where: { providerId: p.id } }),
    ]);
    return { promotions, packages };
  }
  @Post('promotions')
  async addPromotion(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
    @Body(zod(homePromotionSchema)) b: z.infer<typeof homePromotionSchema>,
  ) {
    const p = await this.providers.requireSalonProvider(u.id, s);
    return this.admin.createPromotion(u.id, b, p.id);
  }
  @Post('packages')
  async addPackage(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
    @Body(zod(homePackageSchema)) b: z.infer<typeof homePackageSchema>,
  ) {
    const p = await this.providers.requireSalonProvider(u.id, s);
    const n = await this.prisma.homeOffering.count({
      where: { id: { in: b.offeringIds }, providerId: p.id, active: true },
    });
    if (n !== new Set(b.offeringIds).size)
      throw homeInvalid('Choose your own active home services.');
    return this.prisma.homePackage.create({
      data: { ...b, description: b.description ?? null, providerId: p.id },
    });
  }
  @Get('advice')
  async advice(
    @CurrentUser() u: AuthenticatedUser,
    @Param('salonId') s: string,
  ) {
    const p = await this.providers.requireSalonProvider(u.id, s);
    return {
      workforce: await this.admin.workforceAdvice(s),
      pricing: await this.admin.pricingAdvice(p.id),
    };
  }
}
