import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { FinanceController } from './finance.controller';
import { FinanceExpensesService } from './finance-expenses.service';
import { FinanceFundingService } from './finance-funding.service';
import { FinanceOverviewService } from './finance-overview.service';
import { FinanceSetupService } from './finance-setup.service';

/** FastQue Finance (admin portal): expenses, funding, reimbursements, ledgers and the finance overview. */
@Module({
  imports: [StorageModule],
  controllers: [FinanceController],
  providers: [
    FinanceSetupService,
    FinanceExpensesService,
    FinanceFundingService,
    FinanceOverviewService,
  ],
})
export class FinanceModule {}
