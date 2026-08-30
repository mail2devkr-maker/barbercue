import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  BookingErrorCode,
  PublicQueueUnavailableReason,
  SalonStatus,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

export interface QueueAvailabilityInput {
  status: SalonStatus;
  activeStaffCount: number;
  activeChairCount: number;
  activeServiceCount: number;
}

export interface QueueAvailabilityResult {
  queueAvailable: boolean;
  unavailableReason: PublicQueueUnavailableReason | null;
}

/**
 * Owns Salon.publicQueueToken — the one, existing, already-migrated public identifier for the
 * Phase 9 QR/queue-entry flow. Does NOT introduce a second token field or mechanism.
 *
 * Deliberately NOT Salon.publicId (that's a sequential "BC-SHOP-000001" counter — enumerable,
 * unsuitable for a link anyone can join a queue through) and NOT Salon.id (the internal PK, never
 * exposed here). Generated lazily, server-side, via Node's crypto.randomBytes — same convention
 * as auth.service.ts's password-reset token — rather than a DB sequence default, since a
 * cryptographically random value isn't a Postgres built-in without the pgcrypto extension.
 */
@Injectable()
export class PublicQueueTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a public queue token to its salon. Returns null for an unknown/malformed token —
   * callers map that to a generic, detail-free "not found" so token-guessing gives no signal
   * about whether a token is merely wrong vs. syntactically odd vs. anything else.
   */
  async resolveToken(token: string) {
    if (!token) return null;
    return this.prisma.salon.findUnique({ where: { publicQueueToken: token } });
  }

  /**
   * Returns the calling (already-authorized) salon's existing token, generating one if it
   * doesn't have one yet. Race-safe: the conditional UPDATE only succeeds for the first caller
   * when two requests race to generate a token for the same never-tokened salon; the loser
   * re-reads and gets the winner's value, so a salon can never end up with two tokens or a
   * uniqueness violation.
   */
  async getOrCreateToken(salonId: string): Promise<string> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { publicQueueToken: true },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (salon.publicQueueToken) return salon.publicQueueToken;

    const candidate = randomBytes(24).toString('hex');
    const claim = await this.prisma.salon.updateMany({
      where: { id: salonId, publicQueueToken: null },
      data: { publicQueueToken: candidate },
    });
    if (claim.count === 1) return candidate;

    // Lost the race to a concurrent caller — re-read rather than retry-generate, so we never end
    // up creating (and discarding) a second unused token.
    const current = await this.prisma.salon.findUniqueOrThrow({
      where: { id: salonId },
      select: { publicQueueToken: true },
    });
    // Not reachable in practice (the row now has SOME token after the race), but satisfies the
    // return type without a non-null assertion.
    return current.publicQueueToken ?? candidate;
  }

  buildPublicQueueUrl(token: string): string {
    const webBaseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:3001';
    return `${webBaseUrl}/q/${token}`;
  }

  /**
   * Distinct, truthful reasons a scanned QR/link isn't currently joinable (Issue 9) — replaces a
   * single `status === ACTIVE` boolean, which collapsed "not yet open," "paused," and "open but
   * nobody could ever actually serve you" into one generic message. Checked in the same priority
   * order as the reasons are listed: a salon can be simultaneously PENDING and short-staffed, but
   * only the most fundamental blocker is worth telling the customer about.
   */
  resolveQueueAvailability(
    input: QueueAvailabilityInput,
  ): QueueAvailabilityResult {
    if (input.status === SalonStatus.PENDING) {
      return {
        queueAvailable: false,
        unavailableReason: PublicQueueUnavailableReason.NOT_YET_OPEN,
      };
    }
    if (input.status === SalonStatus.SUSPENDED) {
      return {
        queueAvailable: false,
        unavailableReason: PublicQueueUnavailableReason.PAUSED,
      };
    }
    if (input.activeStaffCount === 0) {
      return {
        queueAvailable: false,
        unavailableReason: PublicQueueUnavailableReason.NO_ACTIVE_STAFF,
      };
    }
    if (input.activeChairCount === 0) {
      return {
        queueAvailable: false,
        unavailableReason: PublicQueueUnavailableReason.NO_ACTIVE_CHAIRS,
      };
    }
    if (input.activeServiceCount === 0) {
      return {
        queueAvailable: false,
        unavailableReason: PublicQueueUnavailableReason.NO_ACTIVE_SERVICES,
      };
    }
    return { queueAvailable: true, unavailableReason: null };
  }
}
