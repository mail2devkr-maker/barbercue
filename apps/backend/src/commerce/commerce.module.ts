import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ShopModule } from '../shop/shop.module';
import { CommerceAdminService } from './commerce-admin.service';
import { CommerceCatalogService } from './commerce-catalog.service';
import { CommerceOrdersService } from './commerce-orders.service';
import { CommerceOutboxService } from './commerce-outbox.service';
import { CommerceStockService } from './commerce-stock.service';
import {
  CommerceAdminController,
  CommerceConfigController,
  CommerceCustomerController,
  CommercePublicController,
} from './commerce.controller';

/**
 * FastQue Direct Commerce: products FastQue sells itself, delivered with Cash on Delivery. Off unless
 * FASTQUE_DIRECT_COMMERCE_ENABLED=true. Salon marketplace orders stay in ShopModule; a mixed checkout
 * places them through ShopOrderService unchanged.
 */
@Module({
  imports: [NotificationsModule, ShopModule],
  controllers: [
    CommerceConfigController,
    CommercePublicController,
    CommerceCustomerController,
    CommerceAdminController,
  ],
  providers: [
    CommerceStockService,
    CommerceCatalogService,
    CommerceOutboxService,
    CommerceOrdersService,
    CommerceAdminService,
  ],
})
export class CommerceModule {}
