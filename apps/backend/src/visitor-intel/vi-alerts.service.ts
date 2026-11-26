import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  VI_ALERT_KIND_LABELS,
  type ViAlertKind,
  type ViAlertRuleInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ViConfigService } from './vi-config.service';
import { ViIngestService } from './vi-ingest.service';
import { num, viNotFound } from './vi-common';
import { viSendEmail } from './vi-mailer';

/** Sensible defaults created on first use; thresholds are editable on the Alerts page. */
const DEFAULT_RULES: Array<
  Omit<ViAlertRuleInput, 'recipientUserIds' | 'channels' | 'enabled'> & {
    help: string;
  }
> = [
  {
    kind: 'TRAFFIC_SPIKE',
    name: 'Traffic spike',
    threshold: 100,
    windowMinutes: 60,
    severity: 'INFO',
    cooldownMinutes: 240,
    help: '% above the same hour on the previous 7 days (average)',
  },
  {
    kind: 'TRAFFIC_DROP',
    name: 'Traffic drop',
    threshold: 50,
    windowMinutes: 60,
    severity: 'WARNING',
    cooldownMinutes: 240,
    help: '% below the same hour on the previous 7 days (average)',
  },
  {
    kind: 'CONVERSION_DROP',
    name: 'Booking conversion drop',
    threshold: 40,
    windowMinutes: 1440,
    severity: 'WARNING',
    cooldownMinutes: 1440,
    help: '% relative drop vs the previous window',
  },
  {
    kind: 'NEW_CITY_DEMAND',
    name: 'New city with demand',
    threshold: 15,
    windowMinutes: 1440,
    severity: 'INFO',
    cooldownMinutes: 1440,
    help: 'searches in a city with no active salons',
  },
  {
    kind: 'ZERO_RESULT_SEARCHES',
    name: 'Frequent zero-result searches',
    threshold: 10,
    windowMinutes: 1440,
    severity: 'WARNING',
    cooldownMinutes: 1440,
    help: 'zero-result searches for one term',
  },
  {
    kind: 'CAMPAIGN_CAC',
    name: 'Campaign CAC over threshold',
    threshold: 500,
    windowMinutes: 10080,
    severity: 'WARNING',
    cooldownMinutes: 1440,
    help: '₹ per acquired customer',
  },
  {
    kind: 'PAYMENT_FAILURES',
    name: 'Payment failures',
    threshold: 5,
    windowMinutes: 60,
    severity: 'CRITICAL',
    cooldownMinutes: 120,
    help: 'failed payments in the window',
  },
  {
    kind: 'ABANDONMENT_RISE',
    name: 'Booking abandonment rise',
    threshold: 70,
    windowMinutes: 1440,
    severity: 'WARNING',
    cooldownMinutes: 1440,
    help: '% of started bookings not confirmed',
  },
  {
    kind: 'PRODUCT_NO_INVENTORY',
    name: 'Product searches without inventory',
    threshold: 10,
    windowMinutes: 1440,
    severity: 'INFO',
    cooldownMinutes: 1440,
    help: 'product searches with no results',
  },
  {
    kind: 'BOT_ACTIVITY',
    name: 'Bot activity',
    threshold: 500,
    windowMinutes: 60,
    severity: 'WARNING',
    cooldownMinutes: 240,
    help: 'bot requests rejected since the last check',
  },
  {
    kind: 'PAGE_ERRORS',
    name: 'Repeated page errors',
    threshold: 20,
    windowMinutes: 60,
    severity: 'CRITICAL',
    cooldownMinutes: 120,
    help: 'page_error events in the window',
  },
];

@Injectable()
export class ViAlertsService {
  private readonly logger = new Logger(ViAlertsService.name);
  private lastBotCount = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: ViIngestService,
  ) {}

  async ensureDefaults(): Promise<void> {
    if ((await this.prisma.viAlertRule.count()) > 0) return;
    await this.prisma.viAlertRule.createMany({
      data: DEFAULT_RULES.map((r) => ({
        kind: r.kind,
        name: r.name,
        threshold: r.threshold,
        windowMinutes: r.windowMinutes,
        severity: r.severity,
        cooldownMinutes: r.cooldownMinutes,
        channels: ['IN_APP'],
        enabled: true,
      })),
    });
  }

  async rules() {
    await this.ensureDefaults();
    const rows = await this.prisma.viAlertRule.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      ...r,
      kindLabel: VI_ALERT_KIND_LABELS[r.kind as ViAlertKind] ?? r.kind,
      help: DEFAULT_RULES.find((d) => d.kind === r.kind)?.help ?? '',
    }));
  }

  async upsertRule(id: string | null, input: ViAlertRuleInput, userId: string) {
    const data = { ...input, severity: input.severity };
    if (id) {
      if (!(await this.prisma.viAlertRule.findUnique({ where: { id } })))
        throw viNotFound('Alert rule');
      return this.prisma.viAlertRule.update({ where: { id }, data });
    }
    return this.prisma.viAlertRule.create({
      data: { ...data, createdByUserId: userId },
    });
  }

  async deleteRule(id: string) {
    await this.prisma.viAlertRule
      .delete({ where: { id } })
      .catch(() => undefined);
    return { ok: true };
  }

  async events(onlyOpen: boolean, page: number, pageSize: number) {
    const where: Prisma.ViAlertEventWhereInput = onlyOpen
      ? { acknowledgedAt: null }
      : {};
    const [total, open, items] = await Promise.all([
      this.prisma.viAlertEvent.count({ where }),
      this.prisma.viAlertEvent.count({ where: { acknowledgedAt: null } }),
      this.prisma.viAlertEvent.findMany({
        where,
        orderBy: { firedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, open, page, pageSize, items };
  }

  async acknowledge(id: string, userId: string) {
    return this.prisma.viAlertEvent.update({
      where: { id },
      data: { acknowledgedAt: new Date(), acknowledgedByUserId: userId },
    });
  }

  @Cron('*/15 * * * *')
  async tick(): Promise<void> {
    if (!ViConfigService.envEnabled()) return;
    await this.evaluate().catch((e) =>
      this.logger.warn(
        `alert evaluation failed: ${e instanceof Error ? e.message : e}`,
      ),
    );
  }

  /** Evaluates every enabled rule once (respecting cooldowns). Returns the alerts fired. */
  async evaluate(now = new Date()): Promise<number> {
    await this.ensureDefaults();
    const rules = await this.prisma.viAlertRule.findMany({
      where: { enabled: true },
    });
    let fired = 0;
    const botsNow = this.ingest.stats.bots;
    const botDelta = botsNow - this.lastBotCount;
    this.lastBotCount = botsNow;
    for (const r of rules) {
      if (
        r.lastFiredAt &&
        now.getTime() - r.lastFiredAt.getTime() < r.cooldownMinutes * 60_000
      )
        continue;
      const result = await this.check(
        r.kind as ViAlertKind,
        r.threshold,
        r.windowMinutes,
        now,
        botDelta,
      );
      if (!result) continue;
      await this.prisma.viAlertEvent.create({
        data: {
          ruleId: r.id,
          kind: r.kind,
          severity: r.severity,
          message: result.message.slice(0, 500),
          data: result.data as Prisma.InputJsonValue,
        },
      });
      await this.prisma.viAlertRule.update({
        where: { id: r.id },
        data: { lastFiredAt: now },
      });
      if (r.channels.includes('EMAIL') && r.recipientUserIds.length) {
        const users = await this.prisma.user.findMany({
          where: { id: { in: r.recipientUserIds } },
          select: { email: true },
        });
        await viSendEmail(
          users.map((u) => u.email).filter((e): e is string => !!e),
          `[FastQue ${r.severity}] ${r.name}`,
          `${result.message}\n\nOpen Visitor Intelligence → Alerts for details.`,
        );
      }
      // WhatsApp delivery is deliberately not implemented until an approved WhatsApp sender exists.
      fired++;
    }
    return fired;
  }

  private async check(
    kind: ViAlertKind,
    threshold: number,
    windowMin: number,
    now: Date,
    botDelta: number,
  ): Promise<{ message: string; data: Record<string, unknown> } | null> {
    const from = new Date(now.getTime() - windowMin * 60_000);
    const sessions = async (f: Date, t: Date) =>
      num(
        (
          await this.prisma.$queryRaw<
            Array<{ n: bigint }>
          >`SELECT COUNT(*) AS n FROM vi_sessions WHERE "startedAt" >= ${f} AND "startedAt" < ${t} AND "isBot" = false`
        )[0]?.n,
      );
    switch (kind) {
      case 'TRAFFIC_SPIKE':
      case 'TRAFFIC_DROP': {
        const cur = await sessions(from, now);
        let base = 0;
        for (let d = 1; d <= 7; d++)
          base += await sessions(
            new Date(from.getTime() - d * 86_400_000),
            new Date(now.getTime() - d * 86_400_000),
          );
        base /= 7;
        if (base < 10) return null;
        const change = ((cur - base) / base) * 100;
        if (kind === 'TRAFFIC_SPIKE' && change >= threshold)
          return {
            message: `Traffic is ${Math.round(change)}% above normal: ${cur} sessions vs ~${Math.round(base)}.`,
            data: { cur, base },
          };
        if (kind === 'TRAFFIC_DROP' && change <= -threshold)
          return {
            message: `Traffic is ${Math.round(-change)}% below normal: ${cur} sessions vs ~${Math.round(base)}.`,
            data: { cur, base },
          };
        return null;
      }
      case 'CONVERSION_DROP': {
        const rate = async (f: Date, t: Date) => {
          const [r] = await this.prisma.$queryRaw<
            Array<{ s: bigint; b: bigint }>
          >`SELECT COUNT(*) AS s, COUNT(*) FILTER (WHERE "bookingConfirmed") AS b FROM vi_sessions WHERE "startedAt" >= ${f} AND "startedAt" < ${t} AND "isBot" = false`;
          return { s: num(r?.s), b: num(r?.b) };
        };
        const cur = await rate(from, now);
        const prev = await rate(
          new Date(from.getTime() - windowMin * 60_000),
          from,
        );
        if (prev.s < 50 || prev.b < 5) return null;
        const cr = cur.s ? cur.b / cur.s : 0;
        const pr = prev.b / prev.s;
        const drop = ((pr - cr) / pr) * 100;
        return drop >= threshold
          ? {
              message: `Booking conversion fell ${Math.round(drop)}%: ${(cr * 100).toFixed(1)}% vs ${(pr * 100).toFixed(1)}%.`,
              data: { cur, prev },
            }
          : null;
      }
      case 'NEW_CITY_DEMAND': {
        const rows = await this.prisma.$queryRaw<
          Array<{ city: string; n: bigint }>
        >`
          SELECT se.city, COUNT(*) AS n FROM vi_search_events se WHERE se."occurredAt" >= ${from} AND se.city IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM salons sa JOIN cities c ON c.id = sa."cityId" WHERE sa.status = 'ACTIVE' AND lower(c.name) = lower(se.city))
          GROUP BY 1 HAVING COUNT(*) >= ${threshold} ORDER BY 2 DESC LIMIT 5`;
        return rows.length
          ? {
              message: `Demand with no active salons: ${rows.map((r) => `${r.city} (${num(r.n)} searches)`).join(', ')}.`,
              data: {
                cities: rows.map((r) => ({ city: r.city, searches: num(r.n) })),
              },
            }
          : null;
      }
      case 'ZERO_RESULT_SEARCHES': {
        const rows = await this.prisma.$queryRaw<
          Array<{ q: string; n: bigint }>
        >`
          SELECT COALESCE(category, "normalizedQuery") AS q, COUNT(*) AS n FROM vi_search_events WHERE "occurredAt" >= ${from} AND "zeroResult" GROUP BY 1 HAVING COUNT(*) >= ${threshold} ORDER BY 2 DESC LIMIT 5`;
        return rows.length
          ? {
              message: `Searches with no results: ${rows.map((r) => `"${r.q}" (${num(r.n)})`).join(', ')}.`,
              data: {
                terms: rows.map((r) => ({ query: r.q, count: num(r.n) })),
              },
            }
          : null;
      }
      case 'CAMPAIGN_CAC': {
        const rows = await this.prisma.$queryRaw<
          Array<{ id: string; name: string; spend: number; acq: bigint }>
        >`
          SELECT c.id::text, c.name, COALESCE((SELECT SUM(fe.amount) FROM vi_campaign_expense_links l JOIN finance_expenses fe ON fe.id = l."financeExpenseId"
              WHERE l."campaignId" = c.id AND fe.status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','PARTIALLY_PAID','PAID')),0)::float AS spend,
            (SELECT COUNT(*) FROM vi_sessions s WHERE s."campaignId" = c.id AND (s.registered OR s."bookingConfirmed") AND s."startedAt" >= ${from}) AS acq
          FROM vi_campaigns c WHERE c.status = 'ACTIVE'`;
        const over = rows.filter(
          (r) =>
            r.spend > 0 && num(r.acq) > 0 && r.spend / num(r.acq) > threshold,
        );
        return over.length
          ? {
              message: `CAC above ₹${threshold}: ${over.map((r) => `${r.name} (₹${Math.round(r.spend / num(r.acq))})`).join(', ')}.`,
              data: {
                campaigns: over.map((r) => ({
                  id: r.id,
                  name: r.name,
                  cac: Math.round(r.spend / num(r.acq)),
                })),
              },
            }
          : null;
      }
      case 'PAYMENT_FAILURES':
      case 'PAGE_ERRORS': {
        const type =
          kind === 'PAYMENT_FAILURES' ? 'payment_failed' : 'page_error';
        const n = num(
          (
            await this.prisma.$queryRaw<
              Array<{ n: bigint }>
            >`SELECT COUNT(*) AS n FROM vi_events WHERE type = ${type} AND "occurredAt" >= ${from}`
          )[0]?.n,
        );
        return n >= threshold
          ? {
              message: `${n} ${kind === 'PAYMENT_FAILURES' ? 'payment failures' : 'page errors'} in the last ${windowMin} minutes.`,
              data: { count: n },
            }
          : null;
      }
      case 'ABANDONMENT_RISE': {
        const [r] = await this.prisma.$queryRaw<
          Array<{ st: bigint; c: bigint }>
        >`SELECT COUNT(*) FILTER (WHERE "bookingStarted") AS st, COUNT(*) FILTER (WHERE "bookingConfirmed") AS c FROM vi_sessions WHERE "startedAt" >= ${from} AND "isBot" = false`;
        const st = num(r?.st);
        if (st < 20) return null;
        const rate = ((st - num(r?.c)) / st) * 100;
        return rate >= threshold
          ? {
              message: `${Math.round(rate)}% of started bookings were not confirmed (${st} started).`,
              data: { started: st, confirmed: num(r?.c) },
            }
          : null;
      }
      case 'PRODUCT_NO_INVENTORY': {
        const n = num(
          (
            await this.prisma.$queryRaw<
              Array<{ n: bigint }>
            >`SELECT COUNT(*) AS n FROM vi_search_events WHERE kind = 'PRODUCT' AND "zeroResult" AND "occurredAt" >= ${from}`
          )[0]?.n,
        );
        return n >= threshold
          ? {
              message: `${n} product searches found no products.`,
              data: { count: n },
            }
          : null;
      }
      case 'BOT_ACTIVITY':
        return botDelta >= threshold
          ? {
              message: `${botDelta} automated requests were filtered since the last check.`,
              data: { bots: botDelta },
            }
          : null;
    }
  }
}
