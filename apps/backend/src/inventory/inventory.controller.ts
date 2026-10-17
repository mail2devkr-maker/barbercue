import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  INVENTORY_PATHS,
  Role,
  createInventoryCategorySchema,
  createInventoryMovementSchema,
  createInventoryProductSchema,
  createInventorySupplierSchema,
  inventoryMovementListQuerySchema,
  inventoryLookupListQuerySchema,
  inventoryProductListQuerySchema,
  updateInventoryProductSchema,
  type AuthenticatedUser,
  type CreateInventoryCategoryInput,
  type CreateInventoryMovementInput,
  type CreateInventoryProductInput,
  type CreateInventorySupplierInput,
  type InventoryMovementListQuery,
  type InventoryLookupListQuery,
  type InventoryProductListQuery,
  type UpdateInventoryProductInput,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { InventoryService } from './inventory.service';

const ROOT = `dashboard/salons/:salonId/${INVENTORY_PATHS.root}`;

/** Inventory is owner/admin-only, salon scoped, and backed by immutable stock movements. */
@Controller()
@Roles(Role.SALON_OWNER, Role.PLATFORM_ADMIN)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get(`${ROOT}/${INVENTORY_PATHS.categories}`)
  listCategories(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Query(new ZodValidationPipe(inventoryLookupListQuerySchema))
    query: InventoryLookupListQuery,
  ) {
    return this.inventory.listCategories(user.id, salonId, query);
  }

  @Post(`${ROOT}/${INVENTORY_PATHS.categories}`)
  @HttpCode(HttpStatus.CREATED)
  createCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Body(new ZodValidationPipe(createInventoryCategorySchema))
    body: CreateInventoryCategoryInput,
  ) {
    return this.inventory.createCategory(user.id, salonId, body);
  }

  @Get(`${ROOT}/${INVENTORY_PATHS.suppliers}`)
  listSuppliers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Query(new ZodValidationPipe(inventoryLookupListQuerySchema))
    query: InventoryLookupListQuery,
  ) {
    return this.inventory.listSuppliers(user.id, salonId, query);
  }

  @Post(`${ROOT}/${INVENTORY_PATHS.suppliers}`)
  @HttpCode(HttpStatus.CREATED)
  createSupplier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Body(new ZodValidationPipe(createInventorySupplierSchema))
    body: CreateInventorySupplierInput,
  ) {
    return this.inventory.createSupplier(user.id, salonId, body);
  }

  @Get(`${ROOT}/${INVENTORY_PATHS.products}`)
  listProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Query(new ZodValidationPipe(inventoryProductListQuerySchema))
    query: InventoryProductListQuery,
  ) {
    return this.inventory.listProducts(user.id, salonId, query);
  }

  @Post(`${ROOT}/${INVENTORY_PATHS.products}`)
  @HttpCode(HttpStatus.CREATED)
  createProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Body(new ZodValidationPipe(createInventoryProductSchema))
    body: CreateInventoryProductInput,
  ) {
    return this.inventory.createProduct(user.id, salonId, body);
  }

  @Patch(`${ROOT}/${INVENTORY_PATHS.products}/:productId`)
  updateProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body(new ZodValidationPipe(updateInventoryProductSchema))
    body: UpdateInventoryProductInput,
  ) {
    return this.inventory.updateProduct(user.id, salonId, productId, body);
  }

  @Post(
    `${ROOT}/${INVENTORY_PATHS.products}/:productId/${INVENTORY_PATHS.movements}`,
  )
  async createMovement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createInventoryMovementSchema))
    body: CreateInventoryMovementInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.inventory.createMovement(
      user.id,
      salonId,
      productId,
      idempotencyKey,
      body,
    );
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Get(`${ROOT}/${INVENTORY_PATHS.movements}`)
  listMovements(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
    @Query(new ZodValidationPipe(inventoryMovementListQuerySchema))
    query: InventoryMovementListQuery,
  ) {
    return this.inventory.listMovements(user.id, salonId, query);
  }

  @Get(`${ROOT}/${INVENTORY_PATHS.report}`)
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
  ) {
    return this.inventory.report(user.id, salonId);
  }
}
