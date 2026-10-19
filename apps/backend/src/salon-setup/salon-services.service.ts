import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingErrorCode,
  SalonSetupErrorCode,
  normalizeServiceIdentity,
  type SalonTypeResultDto,
  type UpdateSalonTypeInput,
  type CreateSalonServiceInput,
  type SalonServiceCategoryDto,
  type ServiceTaxonomyNodeDto,
  type ServiceTaxonomyNodeInput,
  type SalonServiceDto,
  type UpdateSalonServiceInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { ensureServiceTaxonomy, normalizeTaxonomyName, type ResolvedServiceTaxonomy } from './service-taxonomy';

function invalidTaxonomy(): never {
  throw new AppException(
    'SERVICE_TAXONOMY_INVALID',
    'The selected category or subcategory is not available for this shop.',
    HttpStatus.BAD_REQUEST,
  );
}

function taxonomyNodeNotFound(): never {
  throw new AppException('SERVICE_TAXONOMY_NOT_FOUND', 'Category or subcategory not found.', HttpStatus.NOT_FOUND);
}

function taxonomyNodeInUse(categoryCount: number, subcategoryCount: number): never {
  throw new AppException(
    'SERVICE_TAXONOMY_IN_USE',
    'Remove or reassign the linked services and child categories before deleting this item.',
    HttpStatus.CONFLICT,
    { linkedServices: categoryCount, childSubcategories: subcategoryCount },
  );
}

function taxonomyNameConflict(error: unknown): never | void {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppException(
      'SERVICE_TAXONOMY_NAME_CONFLICT',
      'A category or subcategory with this name already exists in this shop.',
      HttpStatus.CONFLICT,
    );
  }
}

async function createTaxonomy(
  tx: Prisma.TransactionClient,
  salonId: string,
  input: CreateSalonServiceInput,
): Promise<ResolvedServiceTaxonomy> {
  let categoryLabel = input.category ?? null;
  if (input.categoryId) {
    const category = await tx.salonServiceCategory.findFirst({
      where: { id: input.categoryId, salonId },
      select: { id: true, name: true },
    });
    if (!category || (categoryLabel &&
      normalizeTaxonomyName(categoryLabel) !== normalizeTaxonomyName(category.name))) invalidTaxonomy();
    categoryLabel = category.name;
  }

  const taxonomy = await ensureServiceTaxonomy(tx, salonId, categoryLabel, input.subcategory);
  if (input.subcategoryId) {
    if (!taxonomy.categoryId) invalidTaxonomy();
    const subcategory = await tx.salonServiceSubcategory.findFirst({
      where: { id: input.subcategoryId, salonId, categoryId: taxonomy.categoryId },
      select: { id: true, name: true },
    });
    if (!subcategory || (input.subcategory &&
      normalizeTaxonomyName(input.subcategory) !== normalizeTaxonomyName(subcategory.name))) invalidTaxonomy();
    taxonomy.subcategoryId = subcategory.id;
    taxonomy.subcategoryName = subcategory.name;
  }
  return taxonomy;
}

async function updateTaxonomy(
  tx: Prisma.TransactionClient,
  salonId: string,
  existing: { category: string | null; subcategory: string | null; categoryId: string | null; subcategoryId: string | null },
  input: UpdateSalonServiceInput,
): Promise<ResolvedServiceTaxonomy> {
  let categoryId = existing.categoryId;
  let subcategoryId = existing.subcategoryId;
  let categoryName = existing.category;
  let subcategoryName = existing.subcategory;
  let categoryChanged = false;
  let selectedCategory: { id: string; name: string } | null = null;

  if (input.categoryId !== undefined && input.categoryId !== null) {
    selectedCategory = await tx.salonServiceCategory.findFirst({
      where: { id: input.categoryId, salonId },
      select: { id: true, name: true },
    });
    if (!selectedCategory || (input.category &&
      normalizeTaxonomyName(input.category) !== normalizeTaxonomyName(selectedCategory.name))) invalidTaxonomy();
    categoryChanged = selectedCategory.id !== existing.categoryId;
    categoryId = selectedCategory.id;
    categoryName = selectedCategory.name;
  } else if (input.categoryId === null) {
    categoryChanged = existing.categoryId !== null;
    categoryId = null;
  }

  if (input.category !== undefined) {
    if (input.category === null) {
      if (input.categoryId && input.categoryId !== null) invalidTaxonomy();
      categoryChanged ||= categoryId !== null || categoryName !== null;
      categoryId = null;
      categoryName = null;
    } else if (selectedCategory) {
      categoryName = selectedCategory.name;
    } else if (input.categoryId === null) {
      // Explicit null ID plus a text label keeps backward-compatible free text without attaching it.
      categoryName = input.category;
    } else {
      const resolved = await ensureServiceTaxonomy(tx, salonId, input.category, null);
      categoryChanged ||= resolved.categoryId !== existing.categoryId;
      categoryId = resolved.categoryId;
      categoryName = input.category;
    }
  }

  if (categoryChanged && input.subcategory === undefined && input.subcategoryId === undefined) {
    // A child label from the prior category cannot silently become a child of a new category.
    subcategoryId = null;
    subcategoryName = null;
  } else if (input.categoryId === null && input.subcategory === undefined && input.subcategoryId === undefined) {
    // Unlinking the parent preserves legacy text but must unlink the child ID too.
    subcategoryId = null;
  }

  if (input.subcategoryId !== undefined) {
    if (input.subcategoryId === null) {
      if (input.subcategory && input.subcategory.trim()) invalidTaxonomy();
      subcategoryId = null;
      subcategoryName = input.subcategory === null ? null : subcategoryName;
    } else {
      if (!categoryId) invalidTaxonomy();
      const subcategory = await tx.salonServiceSubcategory.findFirst({
        where: { id: input.subcategoryId, salonId, categoryId },
        select: { id: true, name: true },
      });
      if (!subcategory || (input.subcategory &&
        normalizeTaxonomyName(input.subcategory) !== normalizeTaxonomyName(subcategory.name))) invalidTaxonomy();
      subcategoryId = subcategory.id;
      subcategoryName = subcategory.name;
    }
  }

  if (input.subcategory !== undefined) {
    if (input.subcategory === null) {
      subcategoryId = null;
      subcategoryName = null;
    } else if (input.subcategoryId && subcategoryId) {
      // The ID lookup above already checked that the supplied label agrees with the node.
      subcategoryName = input.subcategory;
    } else if (categoryId) {
      const resolved = await ensureServiceTaxonomy(tx, salonId, categoryName, input.subcategory);
      categoryId = resolved.categoryId;
      subcategoryId = resolved.subcategoryId;
      subcategoryName = input.subcategory;
    } else {
      subcategoryId = null;
      subcategoryName = input.subcategory;
    }
  }

  return { categoryId, subcategoryId, categoryName, subcategoryName };
}

/**
 * Service catalog CRUD. Every method begins with SalonAccessService.assertOwnerOrAdminAccess,
 * preserving salon isolation while allowing explicit platform-admin delegated support.
 *
 * Never hard-delete services: Booking, BookingService, QueueEntry and ServiceSession
 * hold historical foreign keys. The bulk "Remove All" action only deactivates
 * active services for this salon (reversible, preserves bookings and history).
 * AvailabilityService already filters on isActive.
 */
@Injectable()
export class SalonServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async getSalonType(
    userId: string,
    salonId: string,
  ): Promise<SalonTypeResultDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { salonType: true },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return { salonType: salon.salonType };
  }

  async updateSalonType(
    userId: string,
    salonId: string,
    input: UpdateSalonTypeInput,
  ): Promise<SalonTypeResultDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const existing = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { salonType: true },
    });
    if (!existing) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const salon = await this.prisma.salon.update({
      where: { id: salonId },
      data: { salonType: input.salonType },
      select: { salonType: true },
    });

    if (actor === 'PLATFORM_ADMIN') {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ADMIN_SALON_TYPE_UPDATED',
          entityType: 'Salon',
          entityId: salonId,
          metadata: {
            before: existing.salonType,
            after: salon.salonType,
          },
        },
      });
    }

    return { salonType: salon.salonType };
  }

  async list(userId: string, salonId: string): Promise<SalonServiceDto[]> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const services = await this.prisma.service.findMany({
      where: { salonId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    const currency = await this.currencyFor(salonId);
    return services.map((s) => this.toDto(s, currency));
  }

  async listCategories(userId: string, salonId: string): Promise<SalonServiceCategoryDto[]> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const categories = await this.prisma.salonServiceCategory.findMany({
      where: { salonId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: {
        subcategories: { orderBy: [{ name: 'asc' }, { id: 'asc' }] },
      },
    });
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      subcategories: category.subcategories.map((subcategory) => ({
        id: subcategory.id,
        name: subcategory.name,
      })),
    }));
  }

  async createCategory(userId: string, salonId: string, input: ServiceTaxonomyNodeInput): Promise<ServiceTaxonomyNodeDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const name = input.name.trim();
    const normalizedName = normalizeTaxonomyName(name);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.salonServiceCategory.findFirst({ where: { salonId, normalizedName } });
        if (existing) return { id: existing.id, name: existing.name };
        const category = await tx.salonServiceCategory.create({
          data: { salonId, name, normalizedName }, select: { id: true, name: true },
        });
        await tx.auditLog.create({ data: {
          actorUserId: userId, action: 'SERVICE_CATEGORY_CREATED', entityType: 'SalonServiceCategory',
          entityId: category.id, metadata: { salonId, name: category.name },
        } });
        return category;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.salonServiceCategory.findFirst({ where: { salonId, normalizedName } });
        if (existing) return { id: existing.id, name: existing.name };
      }
      taxonomyNameConflict(error);
      throw error;
    }
  }

  async renameCategory(
    userId: string,
    salonId: string,
    categoryId: string,
    input: ServiceTaxonomyNodeInput,
  ): Promise<ServiceTaxonomyNodeDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const name = input.name.trim();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.salonServiceCategory.findFirst({ where: { id: categoryId, salonId } });
        if (!existing) taxonomyNodeNotFound();
        const normalizedName = normalizeTaxonomyName(name);
        const updated = await tx.salonServiceCategory.update({
          where: { salonId_id: { salonId, id: categoryId } },
          data: { name, normalizedName },
          select: { id: true, name: true },
        });
        // Keep the pre-taxonomy text fields coherent for older API clients. BookingService rows are
        // immutable snapshots and are deliberately not touched by a catalog rename.
        await tx.service.updateMany({ where: { salonId, categoryId }, data: { category: name } });
        await tx.auditLog.create({ data: {
          actorUserId: userId, action: 'SERVICE_CATEGORY_RENAMED', entityType: 'SalonServiceCategory',
          entityId: categoryId, metadata: { salonId, before: existing.name, after: name },
        } });
        return updated;
      });
    } catch (error) {
      taxonomyNameConflict(error);
      throw error;
    }
  }

  async deleteCategory(userId: string, salonId: string, categoryId: string): Promise<{ deleted: true }> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.salonServiceCategory.findFirst({ where: { id: categoryId, salonId } });
      if (!category) taxonomyNodeNotFound();
      const [linkedServices, childSubcategories] = await Promise.all([
        tx.service.count({ where: { salonId, categoryId } }),
        tx.salonServiceSubcategory.count({ where: { salonId, categoryId } }),
      ]);
      if (linkedServices || childSubcategories) taxonomyNodeInUse(linkedServices, childSubcategories);
      await tx.salonServiceCategory.delete({ where: { salonId_id: { salonId, id: categoryId } } });
      await tx.auditLog.create({ data: {
        actorUserId: userId, action: 'SERVICE_CATEGORY_DELETED', entityType: 'SalonServiceCategory',
        entityId: categoryId, metadata: { salonId, name: category.name },
      } });
      return { deleted: true as const };
    });
  }

  async createSubcategory(
    userId: string,
    salonId: string,
    categoryId: string,
    input: ServiceTaxonomyNodeInput,
  ): Promise<ServiceTaxonomyNodeDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const name = input.name.trim();
    const normalizedName = normalizeTaxonomyName(name);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const category = await tx.salonServiceCategory.findFirst({ where: { id: categoryId, salonId } });
        if (!category) taxonomyNodeNotFound();
        const existing = await tx.salonServiceSubcategory.findFirst({ where: { salonId, categoryId, normalizedName } });
        if (existing) return { id: existing.id, name: existing.name };
        const subcategory = await tx.salonServiceSubcategory.create({
          data: { salonId, categoryId, name, normalizedName }, select: { id: true, name: true },
        });
        await tx.auditLog.create({ data: {
          actorUserId: userId, action: 'SERVICE_SUBCATEGORY_CREATED', entityType: 'SalonServiceSubcategory',
          entityId: subcategory.id, metadata: { salonId, categoryId, name: subcategory.name },
        } });
        return subcategory;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.salonServiceSubcategory.findFirst({ where: { salonId, categoryId, normalizedName } });
        if (existing) return { id: existing.id, name: existing.name };
      }
      taxonomyNameConflict(error);
      throw error;
    }
  }

  async renameSubcategory(
    userId: string,
    salonId: string,
    categoryId: string,
    subcategoryId: string,
    input: ServiceTaxonomyNodeInput,
  ): Promise<ServiceTaxonomyNodeDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const name = input.name.trim();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.salonServiceSubcategory.findFirst({ where: { id: subcategoryId, categoryId, salonId } });
        if (!existing) taxonomyNodeNotFound();
        const normalizedName = normalizeTaxonomyName(name);
        const updated = await tx.salonServiceSubcategory.update({
          where: { salonId_categoryId_id: { salonId, categoryId, id: subcategoryId } },
          data: { name, normalizedName },
          select: { id: true, name: true },
        });
        await tx.service.updateMany({ where: { salonId, subcategoryId }, data: { subcategory: name } });
        await tx.auditLog.create({ data: {
          actorUserId: userId, action: 'SERVICE_SUBCATEGORY_RENAMED', entityType: 'SalonServiceSubcategory',
          entityId: subcategoryId, metadata: { salonId, categoryId, before: existing.name, after: name },
        } });
        return updated;
      });
    } catch (error) {
      taxonomyNameConflict(error);
      throw error;
    }
  }

  async deleteSubcategory(
    userId: string,
    salonId: string,
    categoryId: string,
    subcategoryId: string,
  ): Promise<{ deleted: true }> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    return this.prisma.$transaction(async (tx) => {
      const subcategory = await tx.salonServiceSubcategory.findFirst({ where: { id: subcategoryId, categoryId, salonId } });
      if (!subcategory) taxonomyNodeNotFound();
      const linkedServices = await tx.service.count({ where: { salonId, subcategoryId } });
      if (linkedServices) taxonomyNodeInUse(linkedServices, 0);
      await tx.salonServiceSubcategory.delete({ where: { salonId_categoryId_id: { salonId, categoryId, id: subcategoryId } } });
      await tx.auditLog.create({ data: {
        actorUserId: userId, action: 'SERVICE_SUBCATEGORY_DELETED', entityType: 'SalonServiceSubcategory',
        entityId: subcategoryId, metadata: { salonId, categoryId, name: subcategory.name },
      } });
      return { deleted: true as const };
    });
  }

  /**
   * Owner-facing "Remove All Services" means remove ALL ACTIVE services from future
   * booking choices; never erase historical FK rows. Requires exact typed intent and
   * the owner-observed active count to avoid silently acting on a stale page.
   */
  async removeAll(
    userId: string,
    salonId: string,
    raw: unknown,
  ): Promise<{ removedCount: number; remainingActive: number }> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const input = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>) : {};
    const expectedActiveCount = input.expectedActiveCount;
    if (input.confirmation !== 'REMOVE ALL' ||
        typeof expectedActiveCount !== 'number' ||
        !Number.isSafeInteger(expectedActiveCount) ||
        expectedActiveCount < 1 || expectedActiveCount > 100000) {
      throw new AppException(
        'SERVICE_BULK_CONFIRMATION_REQUIRED',
        'Type REMOVE ALL and confirm the current number of active services.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      // Serialize bulk removal with the existing catalog importer lock.
      // executeRaw avoids Prisma attempting to deserialize PostgreSQL's void return.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', salonId);
      const scope = { salonId, isActive: true };
      const actual = await tx.service.count({ where: scope });
      if (actual !== expectedActiveCount) {
        throw new AppException(
          'SERVICE_CATALOG_CHANGED',
          'Your shop catalog changed. Refresh the page and review the count before trying again.',
          HttpStatus.CONFLICT,
          { expectedActiveCount, actualActiveCount: actual },
        );
      }
      const result = await tx.service.updateMany({
        where: scope, data: { isActive: false },
      });
      if (result.count !== actual) {
        throw new AppException(
          'SERVICE_CATALOG_CHANGED',
          'The catalog changed while you were removing services. Refresh and try again.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.auditLog.create({ data: {
        actorUserId: userId,
        action: actor === 'PLATFORM_ADMIN'
          ? 'ADMIN_SERVICES_BULK_DEACTIVATED' : 'OWNER_SERVICES_BULK_DEACTIVATED',
        entityType: 'Salon',
        entityId: salonId,
        metadata: { salonId, removedCount: result.count, method: 'SOFT_DEACTIVATE' },
      } });
      return { removedCount: result.count, remainingActive: 0 };
    });
  }

  /**
   * Physical catalog reset for a selected salon. Unlike the legacy soft
   * remove-all action this deletes inactive records too, so re-imports
   * are not blocked by stale normalized service identities.
   *
   * Fail closed if ANY booking/queue/session history references any service.
   * Do not alter historical bookings just to make deletion possible.
   * Only staff-to-service qualifications (non-historical links) are cleared.
   */
  async deleteAll(
    userId: string,
    salonId: string,
    raw: unknown,
  ): Promise<{ deletedCount: number; remainingCount: number }> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const input = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>) : {};
    const expectedTotalCount = input.expectedTotalCount;
    if (input.confirmation !== 'DELETE ALL' ||
      typeof expectedTotalCount !== 'number' ||
      !Number.isSafeInteger(expectedTotalCount) ||
      expectedTotalCount < 1 || expectedTotalCount > 10000) {
      throw new AppException(
        'SERVICE_BULK_DELETE_CONFIRMATION_REQUIRED',
        'Type DELETE ALL and confirm the number of all services, including inactive ones.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      // Serialize with imported catalogs and legacy bulk deactivation.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', salonId);
      const services = await tx.service.findMany({
        where: { salonId }, select: { id: true },
      });
      if (services.length !== expectedTotalCount) {
        throw new AppException(
          'SERVICE_CATALOG_CHANGED',
          'Shop service count changed. Refresh before deleting services.',
          HttpStatus.CONFLICT,
          { expectedTotalCount, actualTotalCount: services.length },
        );
      }
      const serviceId = { in: services.map((service) => service.id) };
      // These relations are immutable business history. Do not cascade or orphan them.
      const references = {
        bookings: await tx.booking.count({ where: { serviceId } }),
        bookingServices: await tx.bookingService.count({ where: { serviceId } }),
        queueEntries: await tx.queueEntry.count({ where: { serviceId } }),
        serviceSessions: await tx.serviceSession.count({ where: { serviceId } }),
      };
      if (Object.values(references).some((count) => count > 0)) {
        throw new AppException(
          'SERVICE_HISTORY_PROTECTED',
          'Some services are linked to bookings, queues or service history and cannot be permanently deleted. Nothing was deleted.',
          HttpStatus.CONFLICT,
          { references },
        );
      }
      // Staff qualifications are configuration, not completed service history.
      await tx.staffService.deleteMany({ where: { serviceId } });
      const deleted = await tx.service.deleteMany({ where: { salonId, id: serviceId } });
      if (deleted.count !== services.length) {
        throw new AppException(
          'SERVICE_CATALOG_CHANGED',
          'Shop catalog changed during deletion. No partial changes were saved.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.auditLog.create({ data: {
        actorUserId: userId,
        action: actor === 'PLATFORM_ADMIN'
          ? 'ADMIN_SALON_SERVICES_PERMANENTLY_DELETED'
          : 'OWNER_SALON_SERVICES_PERMANENTLY_DELETED',
        entityType: 'Salon', entityId: salonId,
        metadata: { salonId, deletedCount: deleted.count, method: 'HARD_DELETE',
          staffQualificationsRemoved: true },
      } });
      return { deletedCount: deleted.count, remainingCount: 0 };
    }, { timeout: 30000 });
  }

  async create(
    userId: string,
    salonId: string,
    input: CreateSalonServiceInput,
  ): Promise<SalonServiceDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const created = await this.prisma.$transaction(async (tx) => {
      const taxonomy = await createTaxonomy(tx, salonId, input);
      const existingServices = await tx.service.findMany({ where: { salonId } });
      const identity = normalizeServiceIdentity(input.name, taxonomy.categoryName);
      const duplicate = existingServices.find((service) =>
        normalizeServiceIdentity(service.name, service.category) === identity);
      if (duplicate) {
        throw new AppException(
          SalonSetupErrorCode.SERVICE_ALREADY_EXISTS,
          duplicate.isActive
            ? 'That service is already in your catalog.'
            : 'That service already exists but is turned off. Reactivate it instead.',
          HttpStatus.CONFLICT,
        );
      }
      const row = await tx.service.create({
        data: {
          salonId,
          name: input.name,
          description: input.description?.trim() || null,
          price: String(input.price),
          durationMinutes: input.durationMinutes,
          category: taxonomy.categoryName,
          subcategory: taxonomy.subcategoryName,
          categoryId: taxonomy.categoryId,
          subcategoryId: taxonomy.subcategoryId,
          isActive: true,
        },
      });
      if (actor === 'PLATFORM_ADMIN') {
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'ADMIN_SERVICE_CREATED',
            entityType: 'Service',
            entityId: row.id,
            metadata: { salonId, name: row.name },
          },
        });
      }
      return row;
    });
    return this.toDto(created, await this.currencyFor(salonId));
  }

  async update(
    userId: string,
    salonId: string,
    serviceId: string,
    input: UpdateSalonServiceInput,
  ): Promise<SalonServiceDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Scoped by BOTH id and salonId: guessing another salon's service/category ID never grants access.
      const existing = await tx.service.findFirst({ where: { id: serviceId, salonId } });
      if (!existing) {
        throw new AppException(
          BookingErrorCode.SERVICE_NOT_FOUND,
          'Service not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      const taxonomy = await updateTaxonomy(tx, salonId, existing, input);
      const taxonomyChanged =
        input.category !== undefined || input.subcategory !== undefined ||
        input.categoryId !== undefined || input.subcategoryId !== undefined;
      const row = await tx.service.update({
        where: { id: serviceId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description?.trim() || null }),
          ...(input.price !== undefined && { price: String(input.price) }),
          ...(input.durationMinutes !== undefined && { durationMinutes: input.durationMinutes }),
          ...(taxonomyChanged && {
            category: taxonomy.categoryName,
            subcategory: taxonomy.subcategoryName,
            categoryId: taxonomy.categoryId,
            subcategoryId: taxonomy.subcategoryId,
          }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        },
      });
      if (actor === 'PLATFORM_ADMIN') {
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'ADMIN_SERVICE_UPDATED',
            entityType: 'Service',
            entityId: serviceId,
            metadata: {
              salonId,
              before: {
                name: existing.name,
                description: existing.description,
                price: String(existing.price),
                durationMinutes: existing.durationMinutes,
                category: existing.category,
                subcategory: existing.subcategory,
                categoryId: existing.categoryId,
                subcategoryId: existing.subcategoryId,
                isActive: existing.isActive,
              },
              after: {
                name: row.name,
                description: row.description,
                price: String(row.price),
                durationMinutes: row.durationMinutes,
                category: row.category,
                subcategory: row.subcategory,
                categoryId: row.categoryId,
                subcategoryId: row.subcategoryId,
                isActive: row.isActive,
              },
            },
          },
        });
      }
      return row;
    });
    return this.toDto(updated, await this.currencyFor(salonId));
  }

  /** The owning salon's ISO-4217 currency, or null where none is recorded yet. */
  private async currencyFor(salonId: string): Promise<string | null> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { currency: true },
    });
    return salon?.currency ?? null;
  }

  private toDto(
    service: {
      id: string;
      name: string;
      description: string | null;
      durationMinutes: number;
      price: unknown;
      category: string | null;
      subcategory: string | null;
      categoryId?: string | null;
      subcategoryId?: string | null;
      isActive: boolean;
    },
    currency: string | null,
  ): SalonServiceDto {
    return {
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      price: Number(service.price),
      category: service.category,
      subcategory: service.subcategory ?? null,
      categoryId: service.categoryId ?? null,
      subcategoryId: service.subcategoryId ?? null,
      isActive: service.isActive,
      currency,
    };
  }
}
