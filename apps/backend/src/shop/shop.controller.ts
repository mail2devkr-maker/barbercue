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
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import {
  ADMIN_PATHS,
  Role,
  SHOP_PATHS as P,
  adminListingQuerySchema,
  adminListingReviewSchema,
  ownerListingStatusSchema,
  ownerListingUpsertSchema,
  shopAnalyticsQuerySchema,
  shopCartQuoteSchema,
  shopCheckoutSchema,
  shopOrderAccessQuerySchema,
  shopOrderListQuerySchema,
  shopOrderTransitionSchema,
  shopProductDetailQuerySchema,
  shopProductsQuerySchema,
  type AdminListingQuery,
  type AdminListingReviewInput,
  type AuthenticatedUser,
  type OwnerListingStatusInput,
  type OwnerListingUpsertInput,
  type ShopAnalyticsQuery,
  type ShopCartQuoteInput,
  type ShopCheckoutInput,
  type ShopOrderListQuery,
  type ShopOrderTransitionInput,
  type ShopProductDetailQuery,
  type ShopProductsQuery,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { ShopCatalogService } from './shop-catalog.service';
import { ShopOrderService } from './shop-order.service';
import { ShopSellerService } from './shop-seller.service';

const CHECKOUT_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const LOOKUP_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
const ORDER_NUMBER = /^FQS-[0-9A-F]{10}$/;
const cancelSchema = z
  .object({ reason: z.string().trim().max(300).optional() })
  .strict();

function orderNumber(value: string): string {
  if (!ORDER_NUMBER.test(value))
    throw new AppException(
      'SHOP_ORDER_NOT_FOUND',
      'Order not found.',
      HttpStatus.NOT_FOUND,
    );
  return value;
}

/** Marketplace public storefront: browse, product pages, server-priced cart, guest checkout and order link. */
@Controller(P.root)
@Public()
export class ShopPublicController {
  constructor(
    private readonly catalog: ShopCatalogService,
    private readonly orders: ShopOrderService,
  ) {}

  @Get(P.home)
  @Header('Cache-Control', 'public, max-age=60')
  home(
    @Query(new ZodValidationPipe(shopProductDetailQuerySchema))
    query: ShopProductDetailQuery,
  ) {
    return this.catalog.home(
      query.lat != null && query.lng != null
        ? { lat: query.lat, lng: query.lng }
        : null,
      query.city,
    );
  }

  @Get(P.facets)
  @Header('Cache-Control', 'public, max-age=300')
  facets() {
    return this.catalog.facets();
  }

  @Get(P.products)
  @Header('Cache-Control', 'public, max-age=30')
  products(
    @Query(new ZodValidationPipe(shopProductsQuerySchema))
    query: ShopProductsQuery,
  ) {
    return this.catalog.search(query);
  }

  @Get('sitemap-products')
  @Header('Cache-Control', 'public, max-age=3600')
  sitemap() {
    return this.catalog.sitemapIds();
  }

  @Get(`${P.products}/:id`)
  @Header('Cache-Control', 'public, max-age=30')
  product(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(shopProductDetailQuerySchema))
    query: ShopProductDetailQuery,
  ) {
    return this.catalog.product(
      id,
      query.lat != null && query.lng != null
        ? { lat: query.lat, lng: query.lng }
        : null,
      query.city,
    );
  }

  @Post(P.quote)
  @HttpCode(HttpStatus.OK)
  @Throttle(LOOKUP_THROTTLE)
  quote(
    @Body(new ZodValidationPipe(shopCartQuoteSchema)) body: ShopCartQuoteInput,
  ) {
    return this.orders.quote(body);
  }

  /** Guest checkout (signed-in customers use customer/shop/orders so the order is on their account). */
  @Post(P.orders)
  @Throttle(CHECKOUT_THROTTLE)
  async checkout(
    @Headers('Idempotency-Key') key: string | undefined,
    @Body(new ZodValidationPipe(shopCheckoutSchema)) body: ShopCheckoutInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.orders.checkout(body, key, null);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    res.setHeader('Cache-Control', 'no-store');
    return result;
  }

  @Get(`${P.orders}/:orderNumber`)
  @Throttle(LOOKUP_THROTTLE)
  @Header('Cache-Control', 'private, no-store')
  guestOrder(
    @Param('orderNumber') number: string,
    @Query(new ZodValidationPipe(shopOrderAccessQuerySchema))
    query: { token: string },
  ) {
    return this.orders.getForGuest(orderNumber(number), query.token);
  }

  @Post(`${P.orders}/:orderNumber/${P.cancel}`)
  @HttpCode(HttpStatus.OK)
  @Throttle(CHECKOUT_THROTTLE)
  guestCancel(
    @Param('orderNumber') number: string,
    @Query(new ZodValidationPipe(shopOrderAccessQuerySchema))
    query: { token: string },
    @Body(new ZodValidationPipe(cancelSchema)) body: { reason?: string },
  ) {
    return this.orders.cancelForGuest(
      orderNumber(number),
      query.token,
      body.reason,
    );
  }
}

/** A signed-in customer's shop orders and wishlist. */
@Controller(P.customer)
@Roles(Role.CUSTOMER)
export class ShopCustomerController {
  constructor(
    private readonly orders: ShopOrderService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(P.orders)
  @Throttle(CHECKOUT_THROTTLE)
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('Idempotency-Key') key: string | undefined,
    @Body(new ZodValidationPipe(shopCheckoutSchema)) body: ShopCheckoutInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.orders.checkout(body, key, user.id);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Get(P.orders)
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.listForCustomer(user.id);
  }

  @Get(`${P.orders}/:orderNumber`)
  @Header('Cache-Control', 'private, no-store')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNumber') number: string,
  ) {
    return this.orders.getForCustomer(user.id, orderNumber(number));
  }

  @Post(`${P.orders}/:orderNumber/${P.cancel}`)
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNumber') number: string,
    @Body(new ZodValidationPipe(cancelSchema)) body: { reason?: string },
  ) {
    return this.orders.cancelForCustomer(
      user.id,
      orderNumber(number),
      body.reason,
    );
  }

  @Get(P.wishlist)
  @Header('Cache-Control', 'private, no-store')
  async wishlist(@CurrentUser() user: AuthenticatedUser): Promise<string[]> {
    const rows = await this.prisma.shopWishlistItem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { globalProductId: true },
      take: 200,
    });
    return rows.map((r) => r.globalProductId);
  }

  @Put(`${P.wishlist}/:productId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async addWish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    const exists = await this.prisma.globalProduct.findFirst({
      where: { id: productId, verificationStatus: 'VERIFIED' },
      select: { id: true },
    });
    if (!exists)
      throw new AppException(
        'SHOP_PRODUCT_NOT_FOUND',
        'Product not found.',
        HttpStatus.NOT_FOUND,
      );
    await this.prisma.shopWishlistItem.upsert({
      where: {
        userId_globalProductId: { userId: user.id, globalProductId: productId },
      },
      create: { userId: user.id, globalProductId: productId },
      update: {},
    });
  }

  @Delete(`${P.wishlist}/:productId`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeWish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    await this.prisma.shopWishlistItem.deleteMany({
      where: { userId: user.id, globalProductId: productId },
    });
  }
}

const OWNER = `dashboard/salons/:salonId/${P.owner}`;

/** Salon owner: "Sell on FastQue" — listings, the salon's shop orders and sales analytics. */
@Controller()
@Roles(Role.SALON_OWNER, Role.PLATFORM_ADMIN, Role.CO_FOUNDER)
export class ShopOwnerController {
  constructor(
    private readonly seller: ShopSellerService,
    private readonly orders: ShopOrderService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  @Get(`${OWNER}/${P.sellable}`)
  @Header('Cache-Control', 'private, no-store')
  sellable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
  ) {
    return this.seller.sellable(user.id, salonId);
  }

  @Put(`${OWNER}/${P.listings}`)
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Body(new ZodValidationPipe(ownerListingUpsertSchema))
    body: OwnerListingUpsertInput,
  ) {
    return this.seller.upsertListing(user.id, salonId, body);
  }

  @Patch(`${OWNER}/${P.listings}/:listingId`)
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body(new ZodValidationPipe(ownerListingStatusSchema))
    body: OwnerListingStatusInput,
  ) {
    return this.seller.setListingStatus(user.id, salonId, listingId, body);
  }

  @Get(`${OWNER}/${P.orders}`)
  @Header('Cache-Control', 'private, no-store')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Query(new ZodValidationPipe(shopOrderListQuerySchema))
    query: ShopOrderListQuery,
  ) {
    await this.salonAccess.assertOwnerOrAdminAccess(user.id, salonId);
    return this.orders.listForSalon(salonId, query, 'SELLER');
  }

  @Post(`${OWNER}/${P.orders}/:orderId/${P.transition}`)
  @HttpCode(HttpStatus.OK)
  async transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body(new ZodValidationPipe(shopOrderTransitionSchema))
    body: ShopOrderTransitionInput,
  ) {
    await this.salonAccess.assertOwnerOrAdminAccess(user.id, salonId);
    return this.orders.transition(orderId, body, 'SELLER', user.id, salonId);
  }

  @Get(`${OWNER}/${P.analytics}`)
  @Header('Cache-Control', 'private, no-store')
  analytics(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Query(new ZodValidationPipe(shopAnalyticsQuerySchema))
    query: ShopAnalyticsQuery,
  ) {
    return this.seller.analytics(user.id, salonId, query);
  }
}

const VIEW = [Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.PLATFORM_VIEWER];
const MANAGE = [Role.PLATFORM_ADMIN, Role.CO_FOUNDER];

/** FastQue admin: marketplace control — listing approvals, all orders, statistics. */
@Controller(`${ADMIN_PATHS.admin}/${P.admin}`)
export class ShopAdminController {
  constructor(
    private readonly seller: ShopSellerService,
    private readonly orders: ShopOrderService,
  ) {}

  @Get(P.stats)
  @Roles(...VIEW)
  @Header('Cache-Control', 'private, no-store')
  stats() {
    return this.seller.adminStats();
  }

  @Get(P.analytics)
  @Roles(...VIEW)
  @Header('Cache-Control', 'private, no-store')
  analytics(
    @Query(new ZodValidationPipe(shopAnalyticsQuerySchema))
    query: ShopAnalyticsQuery,
  ) {
    return this.seller.analytics(null, null, query);
  }

  @Get(P.listings)
  @Roles(...VIEW)
  @Header('Cache-Control', 'private, no-store')
  listings(
    @Query(new ZodValidationPipe(adminListingQuerySchema))
    query: AdminListingQuery,
  ) {
    return this.seller.adminListings(query);
  }

  @Patch(`${P.listings}/:listingId`)
  @Roles(...MANAGE)
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body(new ZodValidationPipe(adminListingReviewSchema))
    body: AdminListingReviewInput,
  ) {
    return this.seller.reviewListing(user.id, listingId, body);
  }

  @Get(P.orders)
  @Roles(...VIEW)
  @Header('Cache-Control', 'private, no-store')
  orderList(
    @Query(new ZodValidationPipe(shopOrderListQuerySchema))
    query: ShopOrderListQuery,
  ) {
    return this.orders.listForSalon(null, query, 'ADMIN');
  }

  @Post(`${P.orders}/:orderId/${P.cancel}`)
  @Roles(...MANAGE)
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body(new ZodValidationPipe(cancelSchema)) body: { reason?: string },
  ) {
    return this.orders.transition(
      orderId,
      { to: 'CANCELLED', note: body.reason || 'Cancelled by FastQue' },
      'ADMIN',
      user.id,
    );
  }
}
