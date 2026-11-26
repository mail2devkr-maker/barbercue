import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  GROWTH_ROLE_PERMISSIONS,
  Role,
  type AuthenticatedUser,
  type GrowthPermission,
  type GrowthRole,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

export const fail = (
  code: string,
  message: string,
  status: HttpStatus = HttpStatus.BAD_REQUEST,
) => new AppException(code, message, status);

export type GrowthFlag =
  | 'GROWTH_AI_ENABLED'
  | 'GROWTH_AI_KEYWORDS_ENABLED'
  | 'GROWTH_AI_CAMPAIGNS_ENABLED'
  | 'GROWTH_AI_MEASUREMENT_ENABLED'
  | 'GROWTH_AI_LLM_ENABLED';

/** Off unless exactly "true"; GROWTH_AI_ENABLED gates every other flag. */
export function growthFlag(name: GrowthFlag): boolean {
  if (process.env.GROWTH_AI_ENABLED !== 'true') return false;
  return process.env[name] === 'true';
}

/** Read an integer env value; anything missing or malformed falls back. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return fallback;
  return Number(raw);
}

/** Every Growth AI route answers 404 while the master flag is off, as if it did not exist. */
@Injectable()
export class GrowthEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!growthFlag('GROWTH_AI_ENABLED'))
      throw fail('GROWTH_AI_DISABLED', 'Not available.', HttpStatus.NOT_FOUND);
    return true;
  }
}

/** A sub-feature switch for one route or controller, also answering 404 while off. */
const FEATURE = 'growthFeature';
export const GrowthFeature = (flag: GrowthFlag) => SetMetadata(FEATURE, flag);
const PERMISSION = 'growthPermission';
export const GrowthPermit = (permission: GrowthPermission) =>
  SetMetadata(PERMISSION, permission);

/** Only internal admins can ever hold a Growth role. */
export const GROWTH_STAFF_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.CO_FOUNDER,
  Role.PLATFORM_VIEWER,
  Role.HR_ADMIN,
  Role.SALES_ADMIN,
];

export async function growthRoleOf(
  prisma: PrismaService,
  user: AuthenticatedUser,
): Promise<GrowthRole | null> {
  if (user.roles.includes(Role.PLATFORM_ADMIN)) return 'ADMIN';
  if (!user.roles.some((r) => GROWTH_STAFF_ROLES.includes(r))) return null;
  const row = await prisma.growthStaffRole.findUnique({
    where: { userId: user.id },
  });
  return (row?.role as GrowthRole | undefined) ?? null;
}

export function permissionsFor(role: GrowthRole | null): GrowthPermission[] {
  if (!role) return [];
  const perms = [...GROWTH_ROLE_PERMISSIONS[role]];
  // Settings (roles, emergency pause, exclusions) is never delegated through a grant.
  return role === 'ADMIN' ? perms : perms.filter((p) => p !== 'settings');
}

@Injectable()
export class GrowthPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const feature = this.reflector.getAllAndOverride<GrowthFlag | undefined>(
      FEATURE,
      targets,
    );
    if (feature && !growthFlag(feature))
      throw fail('GROWTH_AI_DISABLED', 'Not available.', HttpStatus.NOT_FOUND);
    const needed = this.reflector.getAllAndOverride<
      GrowthPermission | undefined
    >(PERMISSION, targets);
    const req = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser; growthRole?: GrowthRole }>();
    const user = req.user;
    if (!user || !needed)
      throw fail('FORBIDDEN', 'Not allowed.', HttpStatus.FORBIDDEN);
    const role = await growthRoleOf(this.prisma, user);
    if (!permissionsFor(role).includes(needed))
      throw fail(
        'GROWTH_AI_FORBIDDEN',
        'Your account does not have this Growth AI permission.',
        HttpStatus.FORBIDDEN,
      );
    return true;
  }
}

/** Emergency pause: env switch or the admin's switch. Reads still work while paused. */
export async function pauseState(
  prisma: PrismaService,
): Promise<{ paused: boolean; reason: string | null }> {
  if (process.env.GROWTH_AI_EMERGENCY_PAUSE === 'true')
    return {
      paused: true,
      reason: 'Paused by the server (GROWTH_AI_EMERGENCY_PAUSE).',
    };
  const row = await prisma.growthControl.findUnique({ where: { id: 1 } });
  return { paused: !!row?.paused, reason: row?.pausedReason ?? null };
}

export async function assertNotPaused(prisma: PrismaService): Promise<void> {
  const s = await pauseState(prisma);
  if (s.paused)
    throw fail(
      'GROWTH_AI_PAUSED',
      `Growth AI is paused${s.reason ? `: ${s.reason}` : '.'}`,
      HttpStatus.LOCKED,
    );
}

/** YYYY-MM-DD today in India. */
export const indiaDay = (now = new Date()) =>
  new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const dateOnly = (v: string) => new Date(`${v}T00:00:00.000Z`);
export const addDays = (v: string, n: number) =>
  new Date(dateOnly(v).getTime() + n * 86400_000).toISOString().slice(0, 10);
/** Start of an India calendar day, as an instant. */
export const indiaDayStart = (v: string) =>
  new Date(dateOnly(v).getTime() - 5.5 * 3600_000);
