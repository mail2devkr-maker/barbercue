import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  VI_SEGMENT_KEYS,
  viVisitorLabel,
  type ViSegmentInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ViActor } from './vi-access.service';
import { maskContact, num, viForbidden, viNotFound } from './vi-common';

type Rule = ViSegmentInput['rule'];

export const VI_SYSTEM_SEGMENTS: Array<{
  name: string;
  description: string;
  rule: Rule;
}> = [
  {
    name: 'New visitors',
    description: 'First visit within the lookback window.',
    rule: { base: 'new_visitors', lookbackDays: 30 },
  },
  {
    name: 'Returning visitors',
    description: 'More than one visit, active in the window.',
    rule: { base: 'returning_visitors', lookbackDays: 30 },
  },
  {
    name: 'Registered, never booked',
    description: 'Has a FastQue account but no booking.',
    rule: { base: 'registered_no_booking', lookbackDays: 90 },
  },
  {
    name: 'Abandoned bookings',
    description: 'Started a booking but did not confirm it.',
    rule: { base: 'abandoned_booking', lookbackDays: 14 },
  },
  {
    name: 'Abandoned carts',
    description: 'Added a product to the cart without buying.',
    rule: { base: 'abandoned_cart', lookbackDays: 14 },
  },
  {
    name: 'Frequent visitors',
    description: '5 or more visits.',
    rule: { base: 'frequent_visitors', lookbackDays: 90 },
  },
  {
    name: 'High value',
    description: 'Tracked bookings/orders worth ₹2,000 or more.',
    rule: { base: 'high_value', lookbackDays: 365 },
  },
  {
    name: 'Inactive customers',
    description: 'Booked before but not seen in the window.',
    rule: { base: 'inactive', lookbackDays: 60 },
  },
  {
    name: 'Home service interest',
    description: 'Viewed or searched home services.',
    rule: { base: 'home_service_interest', lookbackDays: 30 },
  },
  {
    name: 'Marketplace interest',
    description: 'Viewed products.',
    rule: { base: 'marketplace_interest', lookbackDays: 30 },
  },
];

/**
 * First-party audience segments (docs/visitor-intelligence/README.md (SEGMENTS)). Only visitors who gave marketing
 * consent are ever "reachable", registered users must not have opted out or be suppressed for the channel,
 * and FastQue never adds contact details it does not already legitimately hold.
 */
@Injectable()
export class ViSegmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private where(rule: Rule): Prisma.Sql {
    const since = new Date(Date.now() - rule.lookbackDays * 86_400_000);
    const parts: Prisma.Sql[] = [Prisma.sql`v."isBot" = false`];
    switch (rule.base) {
      case 'new_visitors':
        parts.push(Prisma.sql`v."firstSeenAt" >= ${since}`);
        break;
      case 'returning_visitors':
        parts.push(
          Prisma.sql`v."sessionCount" > 1 AND v."lastSeenAt" >= ${since}`,
        );
        break;
      case 'registered_no_booking':
        parts.push(
          Prisma.sql`v."userId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b."customerId" = v."userId")`,
        );
        break;
      case 'abandoned_booking':
        parts.push(
          Prisma.sql`EXISTS (SELECT 1 FROM vi_sessions s WHERE s."visitorId" = v.id AND s."bookingStarted" AND NOT s."bookingConfirmed" AND s."startedAt" >= ${since})`,
        );
        break;
      case 'abandoned_cart':
        parts.push(
          Prisma.sql`EXISTS (SELECT 1 FROM vi_sessions s WHERE s."visitorId" = v.id AND s."addedToCart" AND NOT s.purchased AND s."startedAt" >= ${since})`,
        );
        break;
      case 'frequent_visitors':
        parts.push(
          Prisma.sql`v."sessionCount" >= 5 AND v."lastSeenAt" >= ${since}`,
        );
        break;
      case 'high_value':
        parts.push(Prisma.sql`v."revenuePaise" >= 200000`);
        break;
      case 'inactive':
        parts.push(Prisma.sql`v."lastSeenAt" < ${since} AND v.bookings > 0`);
        break;
      case 'home_service_interest':
        parts.push(
          Prisma.sql`EXISTS (SELECT 1 FROM vi_events e WHERE e."visitorId" = v.id AND e.module = 'HOME_SERVICES' AND e."occurredAt" >= ${since})`,
        );
        break;
      case 'marketplace_interest':
        parts.push(
          Prisma.sql`v."productViews" > 0 AND v."lastSeenAt" >= ${since}`,
        );
        break;
    }
    if (rule.city) parts.push(Prisma.sql`lower(v.city) = lower(${rule.city})`);
    if (rule.serviceCategory)
      parts.push(Prisma.sql`v."topServices" ? ${rule.serviceCategory}`);
    return Prisma.join(parts, ' AND ');
  }

  async counts(rule: Rule) {
    const where = this.where(rule);
    const [r] = await this.prisma.$queryRaw<
      Array<{
        total: bigint;
        consented: bigint;
        registered: bigint;
        reachable: bigint;
      }>
    >`
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE v."consentMarketing") AS consented,
        COUNT(*) FILTER (WHERE v."userId" IS NOT NULL) AS registered,
        COUNT(*) FILTER (WHERE v."consentMarketing" AND v."userId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM vi_marketing_preferences p WHERE p."userId" = v."userId" AND (p.suppressed OR NOT p."optedIn"))) AS reachable
      FROM vi_visitors v WHERE ${where}`;
    return {
      total: num(r?.total),
      marketingConsented: num(r?.consented),
      registered: num(r?.registered),
      reachableRegistered: num(r?.reachable),
    };
  }

  async list() {
    const custom = await this.prisma.viSegment.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const system = await Promise.all(
      VI_SYSTEM_SEGMENTS.map(async (s, i) => ({
        id: `system-${i}`,
        ...s,
        isSystem: true,
        frequencyCapPerWeek: 2,
        ...(await this.counts(s.rule)),
      })),
    );
    const user = await Promise.all(
      custom.map(async (c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        rule: c.rule as Rule,
        isSystem: false,
        frequencyCapPerWeek: c.frequencyCapPerWeek,
        ...(await this.counts(c.rule as Rule)),
      })),
    );
    return {
      segments: [...system, ...user],
      bases: VI_SEGMENT_KEYS,
      note: 'Only marketing-consented visitors are reachable. Registered users who opted out or are suppressed are excluded.',
    };
  }

  async create(input: ViSegmentInput, userId: string) {
    return this.prisma.viSegment.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        rule: input.rule,
        frequencyCapPerWeek: input.frequencyCapPerWeek,
        createdByUserId: userId,
      },
    });
  }

  async remove(id: string) {
    await this.prisma.viSegment
      .delete({ where: { id } })
      .catch(() => undefined);
    return { ok: true };
  }

  private async ruleFor(id: string): Promise<Rule> {
    if (id.startsWith('system-')) {
      const s = VI_SYSTEM_SEGMENTS[Number(id.slice(7))];
      if (!s) throw viNotFound('Segment');
      return s.rule;
    }
    const row = await this.prisma.viSegment.findUnique({ where: { id } });
    if (!row) throw viNotFound('Segment');
    return row.rule as Rule;
  }

  /**
   * Reachable members only (marketing consent, not opted out, not suppressed). Contact is shown only to
   * roles with PII rights; everyone else gets pseudonymous labels. Every export is audited by the caller.
   */
  async audience(id: string, actor: ViActor, channel: string) {
    if (!actor.capabilities.has('manageSegments')) throw viForbidden();
    const rule = await this.ruleFor(id);
    const where = this.where(rule);
    const rows = await this.prisma.$queryRaw<
      Array<{ guest: number; userId: string | null; city: string | null }>
    >`
      SELECT v."guestNumber" AS guest, v."userId", v.city FROM vi_visitors v WHERE ${where} AND v."consentMarketing"
        AND (v."userId" IS NULL OR NOT EXISTS (SELECT 1 FROM vi_marketing_preferences p WHERE p."userId" = v."userId" AND p.channel = ${channel} AND (p.suppressed OR NOT p."optedIn")))
      ORDER BY v."lastSeenAt" DESC LIMIT 5000`;
    const ids = rows.map((r) => r.userId).filter((u): u is string => !!u);
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, phone: true, email: true },
        })
      : [];
    const full = actor.capabilities.has('pii');
    return rows.map((r) => {
      const u = users.find((x) => x.id === r.userId);
      const contact = channel === 'EMAIL' ? u?.email : u?.phone;
      return {
        visitor: viVisitorLabel(r.guest),
        city: r.city,
        registered: !!r.userId,
        contact: contact ? (full ? contact : maskContact(contact)) : null,
      };
    });
  }

  async setPreference(
    userId: string,
    channel: string,
    optedIn: boolean,
    suppressed: boolean,
    reason: string | null,
  ) {
    return this.prisma.viMarketingPreference.upsert({
      where: { userId_channel: { userId, channel } },
      create: { userId, channel, optedIn, suppressed, reason },
      update: { optedIn, suppressed, reason },
    });
  }

  async preferences(userId: string) {
    return this.prisma.viMarketingPreference.findMany({ where: { userId } });
  }
}
