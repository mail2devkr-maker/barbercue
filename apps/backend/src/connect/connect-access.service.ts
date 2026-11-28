import { Injectable } from '@nestjs/common';
import type { ConnectConversation } from '@prisma/client';
import { Role } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { connectNotFound } from './connect-config';

export type ConnectSalonRole =
  'OWNER' | 'MANAGER' | 'RECEPTIONIST' | 'STYLIST' | 'PROVIDER';

export interface ConnectViewer {
  conv: ConnectConversation;
  userId: string;
  side: 'CUSTOMER' | 'SALON';
  /** Null for the customer. */
  role: ConnectSalonRole | null;
  canAssign: boolean;
  canSeeHistory: boolean;
}

/** A salon-side inbox: a salon, or an independent home professional's provider record. */
export interface ConnectTenant {
  salonId: string | null;
  homeProviderId: string | null;
}

/**
 * The ONE gate for every Connect operation (spec section 20). A caller sees a conversation only
 * as its customer, or as authorised staff of its tenant. Everyone else, including a valid user of
 * another salon who knows the id, gets the same 404 a missing id gets.
 */
@Injectable()
export class ConnectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's Connect role at one salon, or null. Owners always; staff only with a grant. */
  async salonRole(
    userId: string,
    salonId: string,
  ): Promise<ConnectSalonRole | null> {
    const roles = await this.prisma.userRole.findMany({
      where: {
        userId,
        salonId,
        role: { in: [Role.SALON_OWNER, Role.SALON_STAFF] },
      },
      select: { role: true },
    });
    if (roles.some((r) => r.role === Role.SALON_OWNER)) return 'OWNER';
    if (!roles.length) return null;
    const staff = await this.prisma.salonStaff.findFirst({
      where: { userId, salonId, accessRevokedAt: null },
      select: { id: true },
    });
    if (!staff) return null;
    const grant = await this.prisma.connectStaffGrant.findUnique({
      where: { salonId_userId: { salonId, userId } },
    });
    return grant?.role ?? null;
  }

  async providerRole(
    userId: string,
    homeProviderId: string,
  ): Promise<ConnectSalonRole | null> {
    const p = await this.prisma.homeProvider.findFirst({
      where: { id: homeProviderId, userId },
      select: { id: true },
    });
    return p ? 'PROVIDER' : null;
  }

  async tenantRole(
    userId: string,
    tenant: ConnectTenant,
  ): Promise<ConnectSalonRole | null> {
    if (tenant.salonId) return this.salonRole(userId, tenant.salonId);
    if (tenant.homeProviderId)
      return this.providerRole(userId, tenant.homeProviderId);
    return null;
  }

  /** Salon inbox entry: 404 unless the caller has a Connect role at this salon. */
  async assertSalonInbox(
    userId: string,
    salonId: string,
  ): Promise<ConnectSalonRole> {
    const role = await this.salonRole(userId, salonId);
    if (!role) throw connectNotFound();
    return role;
  }

  /** The independent professional's own inbox. */
  async providerTenantFor(userId: string): Promise<ConnectTenant | null> {
    const p = await this.prisma.homeProvider.findFirst({
      where: { userId },
      select: { id: true },
    });
    return p ? { salonId: null, homeProviderId: p.id } : null;
  }

  async load(conversationId: string, userId: string): Promise<ConnectViewer> {
    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) throw connectNotFound();
    const conv = await this.prisma.connectConversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw connectNotFound();
    if (conv.customerId === userId) {
      return {
        conv,
        userId,
        side: 'CUSTOMER',
        role: null,
        canAssign: false,
        canSeeHistory: false,
      };
    }
    const role = await this.tenantRole(userId, conv);
    if (!role) throw connectNotFound();
    // A stylist only works the conversations assigned to them.
    if (role === 'STYLIST' && conv.assignedToUserId !== userId)
      throw connectNotFound();
    return {
      conv,
      userId,
      side: 'SALON',
      role,
      canAssign: role === 'OWNER' || role === 'MANAGER' || role === 'PROVIDER',
      // Receptionists answer chats but do not see a customer's past visits and spend.
      canSeeHistory: role !== 'RECEPTIONIST',
    };
  }

  /** Users who may act for the tenant (owners, granted staff, provider): notification targets. */
  async tenantUserIds(
    tenant: ConnectTenant,
    assignedToUserId?: string | null,
  ): Promise<string[]> {
    if (tenant.salonId) {
      const owners = await this.prisma.userRole.findMany({
        where: { salonId: tenant.salonId, role: Role.SALON_OWNER },
        select: { userId: true },
      });
      const grants = await this.prisma.connectStaffGrant.findMany({
        where: {
          salonId: tenant.salonId,
          role: { in: ['MANAGER', 'RECEPTIONIST'] },
        },
        select: { userId: true },
      });
      const ids = new Set([...owners, ...grants].map((x) => x.userId));
      if (assignedToUserId) ids.add(assignedToUserId);
      return [...ids];
    }
    if (tenant.homeProviderId) {
      const p = await this.prisma.homeProvider.findUnique({
        where: { id: tenant.homeProviderId },
        select: { userId: true },
      });
      return p?.userId ? [p.userId] : [];
    }
    return [];
  }
}
