import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CryptoService } from '../auth/services/crypto.service';
import { CrmModule } from '../crm/crm.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ViAccessService } from './vi-access.service';
import { ViAlertsService } from './vi-alerts.service';
import { ViAnalyticsService } from './vi-analytics.service';
import { ViAskService } from './vi-ask.service';
import { ViCampaignsService } from './vi-campaigns.service';
import { ViConfigService } from './vi-config.service';
import { ViIngestService } from './vi-ingest.service';
import { ViInsightsService } from './vi-insights.service';
import { ViIntegrationsService } from './vi-integrations.service';
import { ViMaintenanceService } from './vi-maintenance.service';
import { ViReportsService } from './vi-reports.service';
import { ViSegmentsService } from './vi-segments.service';
import { VisitorIntelController } from './visitor-intel.controller';

/** FastQue Visitor Intelligence (docs/visitor-intelligence/). Self-contained; reuses CRM, realtime and crypto. */
@Module({
  imports: [
    CrmModule,
    RealtimeModule,
    // Read-only verification of an optional customer token on the public collect endpoint.
    JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET }),
  ],
  controllers: [VisitorIntelController],
  providers: [
    CryptoService,
    ViConfigService,
    ViAccessService,
    ViIntegrationsService,
    ViIngestService,
    ViAnalyticsService,
    ViCampaignsService,
    ViInsightsService,
    ViAskService,
    ViSegmentsService,
    ViAlertsService,
    ViReportsService,
    ViMaintenanceService,
  ],
  exports: [ViAnalyticsService, ViAccessService],
})
export class VisitorIntelModule {}
