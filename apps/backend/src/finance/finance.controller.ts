import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  FINANCE_ATTACHMENT_MAX_BYTES,
  FINANCE_PATHS as P,
  FINANCE_PERMISSION_ROLES,
  financeAccountSchema,
  financeCategoryCreateSchema,
  financeCategoryUpdateSchema,
  financeContributorSchema,
  financeExpenseInputSchema,
  financeExpenseListQuerySchema,
  financeExpensePaymentSchema,
  financeExpenseReviewSchema,
  financeFundingSchema,
  financeOverviewQuerySchema,
  financePayoutSchema,
  financeReasonSchema,
  financeReimbursementCreateSchema,
  financeReimbursementReviewSchema,
  financeVendorSchema,
  type AuthenticatedUser,
  type FinanceAccountInput,
  type FinanceCategoryCreateInput,
  type FinanceCategoryUpdateInput,
  type FinanceContributorInput,
  type FinanceExpenseInput,
  type FinanceExpenseListQuery,
  type FinanceExpensePaymentInput,
  type FinanceExpenseReviewInput,
  type FinanceFundingInput,
  type FinanceOverviewQuery,
  type FinancePayoutInput,
  type FinanceReasonInput,
  type FinanceReimbursementCreateInput,
  type FinanceReimbursementReviewInput,
  type FinanceVendorInput,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { financeActor } from './finance-access';
import { FinanceExpensesService } from './finance-expenses.service';
import { FinanceFundingService } from './finance-funding.service';
import { FinanceOverviewService } from './finance-overview.service';
import { FinanceSetupService } from './finance-setup.service';

/** Every route needs an internal admin role; finer rules (company-wide vs own records) are in the services. */
const ANY = FINANCE_PERMISSION_ROLES.submitOwnClaims;
const COMPANY = FINANCE_PERMISSION_ROLES.viewCompanyFinance;
const uuid = new ParseUUIDPipe({ version: '4' });
const receiptUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: FINANCE_ATTACHMENT_MAX_BYTES, files: 1 },
});

@Controller(P.root)
export class FinanceController {
  constructor(
    private readonly setup: FinanceSetupService,
    private readonly expenses: FinanceExpensesService,
    private readonly funding: FinanceFundingService,
    private readonly overviewService: FinanceOverviewService,
  ) {}

  @Get(P.me)
  @Roles(...ANY)
  me(@CurrentUser() u: AuthenticatedUser) {
    return this.setup.me(financeActor(u));
  }

  @Get(P.overview)
  @Roles(...COMPANY)
  @Header('Cache-Control', 'private, no-store')
  overview(
    @CurrentUser() u: AuthenticatedUser,
    @Query(new ZodValidationPipe(financeOverviewQuerySchema))
    q: FinanceOverviewQuery,
  ) {
    return this.overviewService.overview(financeActor(u), q);
  }

  // categories
  @Get(P.categories)
  @Roles(...ANY)
  categories() {
    return this.setup.categories();
  }
  @Post(P.categories)
  @Roles(...COMPANY)
  createCategory(
    @CurrentUser() u: AuthenticatedUser,
    @Body(new ZodValidationPipe(financeCategoryCreateSchema))
    b: FinanceCategoryCreateInput,
  ) {
    return this.setup.createCategory(financeActor(u), b);
  }
  @Patch(`${P.categories}/:id`)
  @Roles(...COMPANY)
  updateCategory(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeCategoryUpdateSchema))
    b: FinanceCategoryUpdateInput,
  ) {
    return this.setup.updateCategory(financeActor(u), id, b);
  }

  // contributors
  @Get(P.contributors)
  @Roles(...ANY)
  contributors(@CurrentUser() u: AuthenticatedUser) {
    return this.setup.contributors(financeActor(u));
  }
  @Post(P.contributors)
  @Roles(...COMPANY)
  createContributor(
    @CurrentUser() u: AuthenticatedUser,
    @Body(new ZodValidationPipe(financeContributorSchema))
    b: FinanceContributorInput,
  ) {
    return this.setup.createContributor(financeActor(u), b);
  }
  @Patch(`${P.contributors}/:id`)
  @Roles(...COMPANY)
  updateContributor(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeContributorSchema))
    b: FinanceContributorInput,
  ) {
    return this.setup.updateContributor(financeActor(u), id, b);
  }
  @Get(`${P.contributors}/:id/${P.ledger}`)
  @Roles(...ANY)
  @Header('Cache-Control', 'private, no-store')
  ledger(@CurrentUser() u: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.funding.ledger(financeActor(u), id);
  }

  // accounts + vendors
  @Get(P.accounts)
  @Roles(...COMPANY)
  accounts(@CurrentUser() u: AuthenticatedUser) {
    return this.setup.accounts(financeActor(u));
  }
  @Post(P.accounts)
  @Roles(...COMPANY)
  createAccount(
    @CurrentUser() u: AuthenticatedUser,
    @Body(new ZodValidationPipe(financeAccountSchema)) b: FinanceAccountInput,
  ) {
    return this.setup.saveAccount(financeActor(u), null, b);
  }
  @Patch(`${P.accounts}/:id`)
  @Roles(...COMPANY)
  updateAccount(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeAccountSchema)) b: FinanceAccountInput,
  ) {
    return this.setup.saveAccount(financeActor(u), id, b);
  }
  @Get(P.vendors)
  @Roles(...COMPANY)
  vendors(@CurrentUser() u: AuthenticatedUser) {
    return this.setup.vendors(financeActor(u));
  }
  @Get(`${P.vendors}/options`)
  @Roles(...ANY)
  vendorOptions() {
    return this.setup.vendorOptions();
  }
  @Post(P.vendors)
  @Roles(...COMPANY)
  createVendor(
    @CurrentUser() u: AuthenticatedUser,
    @Body(new ZodValidationPipe(financeVendorSchema)) b: FinanceVendorInput,
  ) {
    return this.setup.saveVendor(financeActor(u), null, b);
  }
  @Patch(`${P.vendors}/:id`)
  @Roles(...COMPANY)
  updateVendor(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeVendorSchema)) b: FinanceVendorInput,
  ) {
    return this.setup.saveVendor(financeActor(u), id, b);
  }

  // expenses
  @Get(P.expenses)
  @Roles(...ANY)
  @Header('Cache-Control', 'private, no-store')
  listExpenses(
    @CurrentUser() u: AuthenticatedUser,
    @Query(new ZodValidationPipe(financeExpenseListQuerySchema))
    q: FinanceExpenseListQuery,
  ) {
    return this.expenses.list(financeActor(u), q);
  }
  @Get(`${P.expenses}/${P.export}`)
  @Roles(...ANY)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportExpenses(
    @CurrentUser() u: AuthenticatedUser,
    @Query(new ZodValidationPipe(financeExpenseListQuerySchema))
    q: FinanceExpenseListQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.expenses.exportCsv(financeActor(u), q);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    // UTF-8 byte-order mark so Excel opens ₹ and Hindi text correctly.
    return new StreamableFile(
      Buffer.from(String.fromCharCode(0xfeff) + file.body, 'utf8'),
    );
  }
  @Post(P.expenses)
  @Roles(...ANY)
  createExpense(
    @CurrentUser() u: AuthenticatedUser,
    @Body(new ZodValidationPipe(financeExpenseInputSchema))
    b: FinanceExpenseInput,
  ) {
    return this.expenses.create(financeActor(u), b);
  }
  @Get(`${P.expenses}/:id`)
  @Roles(...ANY)
  @Header('Cache-Control', 'private, no-store')
  expense(@CurrentUser() u: AuthenticatedUser, @Param('id', uuid) id: string) {
    return this.expenses.detail(financeActor(u), id);
  }
  @Patch(`${P.expenses}/:id`)
  @Roles(...ANY)
  updateExpense(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeExpenseInputSchema))
    b: FinanceExpenseInput,
  ) {
    return this.expenses.update(financeActor(u), id, b);
  }
  @Delete(`${P.expenses}/:id`)
  @Roles(...ANY)
  deleteExpense(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
  ) {
    return this.expenses.remove(financeActor(u), id);
  }
  @Post(`${P.expenses}/:id/${P.submit}`)
  @Roles(...ANY)
  submitExpense(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
  ) {
    return this.expenses.submit(financeActor(u), id);
  }
  @Post(`${P.expenses}/:id/${P.review}`)
  @Roles(...COMPANY)
  reviewExpense(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeExpenseReviewSchema))
    b: FinanceExpenseReviewInput,
  ) {
    return this.expenses.review(financeActor(u), id, b);
  }
  @Post(`${P.expenses}/:id/${P.cancel}`)
  @Roles(...ANY)
  cancelExpense(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeReasonSchema)) b: FinanceReasonInput,
  ) {
    return this.expenses.cancel(financeActor(u), id, b.reason);
  }
  @Get(`${P.expenses}/:id/${P.audit}`)
  @Roles(...ANY)
  @Header('Cache-Control', 'private, no-store')
  expenseAudit(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
  ) {
    return this.expenses.audit(financeActor(u), id);
  }
  @Post(`${P.expenses}/:id/${P.payments}`)
  @Roles(...COMPANY)
  addPayment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeExpensePaymentSchema))
    b: FinanceExpensePaymentInput,
  ) {
    return this.expenses.addPayment(financeActor(u), id, b);
  }
  @Post(`${P.payments}/:id/${P.void}`)
  @Roles(...COMPANY)
  voidPayment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeReasonSchema)) b: FinanceReasonInput,
  ) {
    return this.expenses.voidPayment(financeActor(u), id, b.reason);
  }
  @Post(`${P.expenses}/:id/${P.attachments}`)
  @Roles(...ANY)
  @UseInterceptors(receiptUpload)
  addAttachment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('confirmDuplicate') confirm?: string,
  ) {
    return this.expenses.addAttachment(
      financeActor(u),
      id,
      file,
      confirm === '1',
    );
  }
  @Get(`${P.attachments}/:id`)
  @Roles(...ANY)
  async attachment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.expenses.attachment(financeActor(u), id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName.replace(/[^\w.\- ]/g, '_')}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.data);
  }
  @Delete(`${P.attachments}/:id`)
  @Roles(...ANY)
  removeAttachment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
  ) {
    return this.expenses.removeAttachment(financeActor(u), id);
  }

  // funding
  @Get(P.funding)
  @Roles(...COMPANY)
  @Header('Cache-Control', 'private, no-store')
  listFunding(
    @CurrentUser() u: AuthenticatedUser,
    @Query('contributorId') contributorId?: string,
  ) {
    return this.funding.listFunding(
      financeActor(u),
      contributorId || undefined,
    );
  }
  @Post(P.funding)
  @Roles(...COMPANY)
  createFunding(
    @CurrentUser() u: AuthenticatedUser,
    @Body(new ZodValidationPipe(financeFundingSchema)) b: FinanceFundingInput,
  ) {
    return this.funding.createFunding(financeActor(u), b);
  }
  @Post(`${P.funding}/:id/${P.void}`)
  @Roles(...COMPANY)
  voidFunding(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeReasonSchema)) b: FinanceReasonInput,
  ) {
    return this.funding.voidFunding(financeActor(u), id, b.reason);
  }

  // reimbursements
  @Get(P.reimbursements)
  @Roles(...ANY)
  @Header('Cache-Control', 'private, no-store')
  listReimbursements(@CurrentUser() u: AuthenticatedUser) {
    return this.funding.listReimbursements(financeActor(u));
  }
  @Get(`${P.reimbursements}/claimable`)
  @Roles(...ANY)
  claimable(@CurrentUser() u: AuthenticatedUser) {
    return this.funding.claimablePayments(financeActor(u));
  }
  @Post(P.reimbursements)
  @Roles(...ANY)
  createReimbursement(
    @CurrentUser() u: AuthenticatedUser,
    @Body(new ZodValidationPipe(financeReimbursementCreateSchema))
    b: FinanceReimbursementCreateInput,
  ) {
    return this.funding.createReimbursement(financeActor(u), b);
  }
  @Post(`${P.reimbursements}/:id/${P.review}`)
  @Roles(...COMPANY)
  reviewReimbursement(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeReimbursementReviewSchema))
    b: FinanceReimbursementReviewInput,
  ) {
    return this.funding.reviewReimbursement(financeActor(u), id, b);
  }
  @Post(`${P.reimbursements}/:id/${P.cancel}`)
  @Roles(...ANY)
  cancelReimbursement(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeReasonSchema)) b: FinanceReasonInput,
  ) {
    return this.funding.cancelReimbursement(financeActor(u), id, b.reason);
  }
  @Post(`${P.reimbursements}/:id/${P.payouts}`)
  @Roles(...COMPANY)
  addPayout(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financePayoutSchema)) b: FinancePayoutInput,
  ) {
    return this.funding.addPayout(financeActor(u), id, b);
  }
  @Post(`${P.payouts}/:id/${P.void}`)
  @Roles(...COMPANY)
  voidPayout(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(financeReasonSchema)) b: FinanceReasonInput,
  ) {
    return this.funding.voidPayout(financeActor(u), id, b.reason);
  }
}
