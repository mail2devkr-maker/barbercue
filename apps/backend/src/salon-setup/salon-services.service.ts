import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  SalonSetupErrorCode,
  normalizeServiceIdentity,
  type SalonTypeResultDto,
  type UpdateSalonTypeInput,
  type CreateSalonServiceInput,
  type SalonServiceDto,
  type UpdateSalonServiceInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

/**
 * Service catalog CRUD. Every method begins with SalonAccessService.assertOwnerOrAdminAccess,
 * preserving salon isolation while allowing explicit platform-admin delegated support.
 *
 * There is deliberately no delete: Service is foreign-keyed from Booking, QueueEntry, and
 * ServiceSession, so removing a row would orphan historical bookings and completed visits.
 * `isActive: false` is the soft-delete — AvailabilityService.getServiceOrThrow already filters
 * on isActive, so a deactivated service immediately stops being bookable while its history
 * stays intact.
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

  async create(
    userId: string,
    salonId: string,
    input: CreateSalonServiceInput,
  ): Promise<SalonServiceDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const existingServices = await this.prisma.service.findMany({
      where: { salonId },
    });
    const identity = normalizeServiceIdentity(input.name, input.category);
    const duplicate = existingServices.find(
      (service) =>
        normalizeServiceIdentity(service.name, service.category) === identity,
    );
    if (duplicate) {
      throw new AppException(
        SalonSetupErrorCode.SERVICE_ALREADY_EXISTS,
        duplicate.isActive
          ? 'That service is already in your catalog.'
          : 'That service already exists but is turned off. Reactivate it instead.',
        HttpStatus.CONFLICT,
      );
    }
    const created = await this.prisma.service.create({
      data: {
        salonId,
        name: input.name,
        description: input.description?.trim() || null,
        // Prisma accepts a string for Decimal columns; going through String() avoids any
        // float-repr surprise on a money column.
        price: String(input.price),
        durationMinutes: input.durationMinutes,
        category: input.category ?? null,
        isActive: true,
      },
    });
    if (actor === 'PLATFORM_ADMIN') {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ADMIN_SERVICE_CREATED',
          entityType: 'Service',
          entityId: created.id,
          metadata: { salonId, name: created.name },
        },
      });
    }
    return this.toDto(created, await this.currencyFor(salonId));
  }

  async update(
    userId: string,
    salonId: string,
    serviceId: string,
    input: UpdateSalonServiceInput,
  ): Promise<SalonServiceDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    // Scoped by BOTH id and salonId: an owner with access to salon A must not be able to mutate
    // salon B's service by guessing its id.
    const existing = await this.prisma.service.findFirst({
      where: { id: serviceId, salonId },
    });
    if (!existing) {
      throw new AppException(
        BookingErrorCode.SERVICE_NOT_FOUND,
        'Service not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const updated = await this.prisma.service.update({
      where: { id: serviceId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && {
          description: input.description?.trim() || null,
        }),
        ...(input.price !== undefined && { price: String(input.price) }),
        ...(input.durationMinutes !== undefined && {
          durationMinutes: input.durationMinutes,
        }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
    // Part 2 — every delegated admin mutation gets an AuditLog row with the real admin actor.
    if (actor === 'PLATFORM_ADMIN') {
      await this.prisma.auditLog.create({
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
              isActive: existing.isActive,
            },
            after: {
              name: updated.name,
              description: updated.description,
              price: String(updated.price),
              durationMinutes: updated.durationMinutes,
              category: updated.category,
              isActive: updated.isActive,
            },
          },
        },
      });
    }
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
      isActive: service.isActive,
      currency,
    };
  }
}
