import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  HR_PATHS,
  Role,
  hrContactUpdateSchema,
  hrCreateOfferSchema,
  hrExitSchema,
  hrJoiningSchema,
  hrMatchQuerySchema,
  hrNotJoinedSchema,
  hrOfferStatusSchema,
  hrPageQuerySchema,
  hrPdfEventSchema,
  hrReconciliationCreateIdentitySchema,
  hrReconciliationDuplicateSchema,
  hrReconciliationImportSchema,
  hrReconciliationLinkSchema,
  hrRegisterQuerySchema,
  type AuthenticatedUser,
  type HrContactUpdateInput,
  type HrCreateOfferInput,
  type HrExitInput,
  type HrJoiningInput,
  type HrMatchQuery,
  type HrNotJoinedInput,
  type HrOfferStatusInput,
  type HrPageQuery,
  type HrPdfEventInput,
  type HrReconciliationImportInput,
  type HrRegisterQuery,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { HrRegisterService } from './hr-register.service';
import { HrReconciliationService } from './hr-reconciliation.service';

/**
 * HR permanent employee-ID register. ADMIN-audience sessions only (RolesGuard enforces the audience for these
 * roles); every mutation requires an Idempotency-Key so a double click or retry can never record a second event.
 */
@Controller(HR_PATHS.base)
@Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.HR_ADMIN)
export class HrRegisterController {
  constructor(
    private readonly register: HrRegisterService,
    private readonly reconciliation: HrReconciliationService,
  ) {}

  @Get(HR_PATHS.register)
  search(
    @Query(new ZodValidationPipe(hrRegisterQuerySchema)) query: HrRegisterQuery,
  ) {
    return this.register.search(query);
  }

  @Post(HR_PATHS.matches)
  match(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(hrMatchQuerySchema)) body: HrMatchQuery,
  ) {
    return this.register.matchIdentity(user, body);
  }

  @Post(HR_PATHS.offers)
  @Idempotent()
  createOffer(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(hrCreateOfferSchema)) body: HrCreateOfferInput,
  ) {
    return this.register.createOffer(user, body);
  }

  @Get(`${HR_PATHS.persons}/:id`)
  person(@Param('id') id: string) {
    return this.register.getPerson(id);
  }

  @Get(`${HR_PATHS.persons}/:id/audit`)
  audit(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(hrPageQuerySchema)) query: HrPageQuery,
  ) {
    return this.register.listAudit(id, query.cursor, query.limit);
  }

  @Post(`${HR_PATHS.persons}/:id/contact`)
  @Idempotent()
  updateContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hrContactUpdateSchema))
    body: HrContactUpdateInput,
  ) {
    return this.register.updateContact(user, id, body);
  }

  @Post(`${HR_PATHS.offers}/:id/status`)
  @Idempotent()
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hrOfferStatusSchema)) body: HrOfferStatusInput,
  ) {
    return this.register.transitionOffer(user, id, body);
  }

  @Post(`${HR_PATHS.offers}/:id/joining`)
  @Idempotent()
  joining(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hrJoiningSchema)) body: HrJoiningInput,
  ) {
    return this.register.recordJoining(user, id, body);
  }

  @Post(`${HR_PATHS.offers}/:id/not-joined`)
  @Idempotent()
  notJoined(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hrNotJoinedSchema)) body: HrNotJoinedInput,
  ) {
    return this.register.recordNotJoined(user, id, body);
  }

  @Post(`${HR_PATHS.offers}/:id/pdf-events`)
  @Idempotent()
  pdfEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hrPdfEventSchema)) body: HrPdfEventInput,
  ) {
    return this.register.recordPdfEvent(user, id, body);
  }

  @Get(`${HR_PATHS.offers}/:id/letter-data`)
  letterData(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.register.getLetterData(user, id);
  }

  @Post(`${HR_PATHS.episodes}/:id/exit`)
  @Idempotent()
  exit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hrExitSchema)) body: HrExitInput,
  ) {
    return this.register.recordExit(user, id, body);
  }

  @Get(HR_PATHS.reconciliation)
  reconciliationList(
    @Query(new ZodValidationPipe(hrPageQuerySchema)) query: HrPageQuery,
  ) {
    return this.reconciliation.list(query.status, query.cursor, query.limit);
  }

  @Post(`${HR_PATHS.reconciliation}/import`)
  @Idempotent()
  reconciliationImport(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(hrReconciliationImportSchema))
    body: HrReconciliationImportInput,
  ) {
    return this.reconciliation.import(user, body);
  }

  @Post(`${HR_PATHS.reconciliation}/:id/link`)
  @Idempotent()
  reconciliationLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hrReconciliationLinkSchema))
    body: { personId: string },
  ) {
    return this.reconciliation.link(user, id, body.personId);
  }

  @Post(`${HR_PATHS.reconciliation}/:id/duplicate`)
  @Idempotent()
  reconciliationDuplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hrReconciliationDuplicateSchema))
    body: { duplicateOfItemId: string },
  ) {
    return this.reconciliation.markDuplicate(user, id, body.duplicateOfItemId);
  }

  @Post(`${HR_PATHS.reconciliation}/:id/create-identity`)
  @Idempotent()
  reconciliationCreateIdentity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hrReconciliationCreateIdentitySchema))
    _body: { historyChecked: true },
  ) {
    void _body;
    return this.reconciliation.createIdentity(user, id);
  }
}
