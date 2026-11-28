import { Module, forwardRef } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { NotificationDeliveryModule } from '../notifications/notification-delivery.module';
import { QueueModule } from '../queue/queue.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { StorageModule } from '../storage/storage.module';
import { ConnectAccessService } from './connect-access.service';
import { ConnectActionsService } from './connect-actions.service';
import { ConnectBusinessService } from './connect-business.service';
import { ConnectConfigService, ConnectEnabledGuard } from './connect-config';
import { ConnectConversationsService } from './connect-conversations.service';
import { ConnectEventsService } from './connect-events.service';
import { ConnectInsightsService } from './connect-insights.service';
import { ConnectLinksService } from './connect-links.service';
import { ConnectMessagesService } from './connect-messages.service';
import { ConnectNotifyService } from './connect-notify.service';
import {
  ConnectAdminController,
  ConnectConversationController,
  ConnectCustomerController,
  ConnectProviderController,
  ConnectSalonController,
  ConnectStatusController,
} from './connect.controller';
import { ConnectAiService } from './ai/connect-ai.service';
import { ConnectKnowledgeService } from './ai/connect-knowledge.service';
import { ConnectModelService } from './ai/connect-model.service';

/**
 * FastQue Connect (docs/connect/). Off unless FASTQUE_CONNECT_ENABLED=true: every route answers
 * 404 and every event listener returns at once, so the rest of the app behaves exactly as before.
 */
@Module({
  imports: [
    RealtimeModule,
    NotificationDeliveryModule,
    StorageModule,
    BookingsModule,
    forwardRef(() => QueueModule),
  ],
  controllers: [
    ConnectStatusController,
    ConnectCustomerController,
    ConnectConversationController,
    ConnectSalonController,
    ConnectProviderController,
    ConnectAdminController,
  ],
  providers: [
    ConnectEnabledGuard,
    ConnectConfigService,
    ConnectAccessService,
    ConnectLinksService,
    ConnectNotifyService,
    ConnectMessagesService,
    ConnectConversationsService,
    ConnectKnowledgeService,
    ConnectModelService,
    ConnectAiService,
    ConnectActionsService,
    ConnectEventsService,
    ConnectBusinessService,
    ConnectInsightsService,
  ],
  exports: [ConnectLinksService],
})
export class ConnectModule {}
