import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

// Allowlisted, deliberately non-secret fields only; NEVER blindly serialize
// existing audit metadata, which may contain data from unrelated workflows.
const SAFE_METADATA_FIELDS = [
  'employeeCode', 'fullName', 'territory', 'shopName', 'shopPublicId',
  'previousStatus', 'newStatus', 'role', 'email', 'requestId',
  'requestedByUserId', 'reservedNumber', 'reason', 'note',
] as const;

function safeMetadata(action: string, value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  const metadata = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of SAFE_METADATA_FIELDS) {
    const item = metadata[key];
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      result[key] = item;
    }
  }
  if (action === 'EMPLOYEE_UPDATED') {
    for (const group of ['before', 'requested'] as const) {
      const item = metadata[group];
      if (!item || Array.isArray(item) || typeof item !== 'object') continue;
      const fields = item as Record<string, unknown>;
      result[group] = Object.fromEntries(
        ['fullName', 'territory', 'status']
          .filter((key) => key in fields)
          .map((key) => [key, fields[key]]),
      );
    }
  }
  return result;
}

@Injectable()
export class AdminSecurityAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: { actorEmail?: string; action?: string; cursor?: string }) {
    const actorEmail = query.actorEmail?.trim().toLowerCase();
    const action = query.action?.trim();
    const cursor = query.cursor?.trim();
    if (actorEmail && (actorEmail.length > 254 || !actorEmail.includes('@'))) {
      throw new AppException('AUDIT_FILTER_INVALID', 'Invalid actor email.', HttpStatus.BAD_REQUEST);
    }
    if (action && (action.length > 100 || !/^[A-Z0-9_]+$/.test(action))) {
      throw new AppException('AUDIT_FILTER_INVALID', 'Invalid audit action.', HttpStatus.BAD_REQUEST);
    }
    if (cursor && !/^[0-9a-f-]{36}$/i.test(cursor)) {
      throw new AppException('AUDIT_CURSOR_INVALID', 'Invalid page cursor.', HttpStatus.BAD_REQUEST);
    }

    const where: Prisma.AuditLogWhereInput = {
      ...(actorEmail
        ? { actor: { is: { email: { equals: actorEmail, mode: 'insensitive' } } } }
        : {}),
      ...(action ? { action } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { actor: { select: { id: true, email: true } } },
    });
    const page = rows.slice(0, 50);
    return {
      items: page.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        actorUserId: row.actorUserId,
        actorEmail: row.actor?.email ?? null,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        details: safeMetadata(row.action, row.metadata),
      })),
      nextCursor: rows.length > 50 ? page[page.length - 1]?.id ?? null : null,
    };
  }
}
