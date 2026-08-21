import { Module } from '@nestjs/common';
import { PremiumController } from './premium.controller';
import { PremiumPlansService } from './premium-plans.service';
import { PremiumEntitlementService } from './premium-entitlement.service';
import { AiCreditService } from './ai-credit.service';

@Module({
  controllers: [PremiumController],
  providers: [PremiumPlansService, PremiumEntitlementService, AiCreditService],
  // StyleAdvisorModule imports this module to gate AI generation behind AiCreditService.
  exports: [PremiumPlansService, PremiumEntitlementService, AiCreditService],
})
export class PremiumModule {}
