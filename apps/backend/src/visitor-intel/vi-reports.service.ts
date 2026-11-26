import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  resolveViRange,
  type ViPeriod,
  type ViReportFormat,
  type ViReportType,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toXlsx } from '../commerce/commerce-ops.service';
import type { ViActor } from './vi-access.service';
import { ViAnalyticsService } from './vi-analytics.service';
import { ViCampaignsService } from './vi-campaigns.service';
import { ViConfigService } from './vi-config.service';
import { ViSegmentsService } from './vi-segments.service';
import { csvEscape, viForbidden, type ViQuery } from './vi-common';
import { viSendEmail } from './vi-mailer';

type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;

const REPORT_CAPS: Record<ViReportType, string> = {
  activity: 'overview',
  geo: 'geo',
  search: 'search',
  campaigns: 'campaigns',
  conversion: 'conversions',
  revenue: 'conversions',
  segments: 'segments',
  salons: 'overview',
  territories: 'geo',
  insights: 'insights',
};

/** Exports and scheduled reports (docs/visitor-intelligence/REPORTS.md). Aggregates only; no contact details. */
@Injectable()
export class ViReportsService {
  private readonly logger = new Logger(ViReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: ViAnalyticsService,
    private readonly campaigns: ViCampaignsService,
    private readonly segments: ViSegmentsService,
  ) {}

  async rows(type: ViReportType, q: ViQuery, actor: ViActor): Promise<Row[]> {
    if (
      !actor.capabilities.has(REPORT_CAPS[type] as never) ||
      !actor.capabilities.has('reports')
    )
      throw viForbidden();
    switch (type) {
      case 'activity':
        return (await this.analytics.series(q, actor.scope)).map((p) => ({
          Date: p.date,
          Visitors: p.visitors,
          Sessions: p.sessions,
          'Page views': p.pageViews,
          Searches: p.searches,
          Bookings: p.bookings,
          Purchases: p.purchases,
          'Value (INR)': p.revenuePaise / 100,
        }));
      case 'geo':
      case 'territories':
        return (
          await this.analytics.geo(q, actor, type === 'geo' ? 'city' : 'state')
        ).rows.map((r) => ({
          Location: r.key,
          State: r.state,
          Country: r.country,
          Visitors: r.visitors,
          Sessions: r.sessions,
          Searches: r.searches,
          'Zero-result searches': r.zeroResultSearches,
          Bookings: r.bookings,
          Purchases: r.purchases,
          'Value (INR)': r.revenuePaise / 100,
          'Conversion %': r.conversionPct,
          'Active salons': r.activeSalons,
          Opportunity: r.opportunity.level,
          Score: r.opportunity.score,
          'Location source': r.geoSourceLabel,
          Confidence: r.confidence,
        }));
      case 'search':
        return (await this.analytics.search(q, actor)).top.map((t) => ({
          Search: t.query,
          Example: t.example,
          Category: t.category,
          Count: t.count,
          'No results': t.zeroResult,
          Bookings: t.bookings,
          Purchases: t.purchases,
          'Avg results': t.avgResults,
          'Conversion %': t.conversionPct,
        }));
      case 'campaigns':
        return (await this.campaigns.list(q)).items.map((c) => ({
          Campaign: c.name,
          Code: c.code,
          Type: c.kindLabel,
          Status: c.status,
          Visits: c.stats.visits,
          'Unique visitors': c.stats.uniqueVisitors,
          Registrations: c.stats.registrations,
          Searches: c.stats.searches,
          Bookings: c.stats.bookings,
          Purchases: c.stats.purchases,
          'Value (INR)': c.stats.revenueInr,
          'Spend (INR)': c.stats.spendInr,
          'CAC (INR)': c.stats.cacInr,
          'ROI %': c.stats.roiPct,
        }));
      case 'conversion': {
        const f = await this.analytics.funnel(q, actor, 'SALON_BOOKING');
        return f.stages.map((s) => ({
          Stage: s.label,
          Optional: s.optional,
          Sessions: s.sessions,
          'Conversion from previous %': s.conversionFromPrevPct,
          'Drop-off %': s.dropOffPct,
          'Median seconds': s.medianSecondsFromPrev,
        }));
      }
      case 'revenue':
        return (await this.analytics.conversions(q, actor)).byModule.map(
          (m) => ({
            Module: m.module,
            Conversions: m.count,
            'Value (INR)': m.valuePaise / 100,
          }),
        );
      case 'segments':
        return (await this.segments.list()).segments.map((s) => ({
          Segment: s.name,
          System: s.isSystem,
          Members: s.total,
          'Marketing consented': s.marketingConsented,
          Registered: s.registered,
          'Reachable registered': s.reachableRegistered,
        }));
      case 'salons': {
        const rows = await this.prisma.$queryRaw<
          Array<{
            id: string;
            name: string;
            views: bigint;
            bookings: bigint;
            value: bigint;
          }>
        >`
          SELECT sa.id, sa.name,
            (SELECT COUNT(*) FROM vi_events e WHERE e.type = 'salon_view' AND (e."salonId" = sa.id OR e."entityId" IN (sa.id, sa.slug)) AND e."occurredAt" >= ${q.range.from} AND e."occurredAt" < ${q.range.to}) AS views,
            (SELECT COUNT(*) FROM vi_conversions c WHERE c."salonId" = sa.id AND c.type = 'BOOKING' AND c."occurredAt" >= ${q.range.from} AND c."occurredAt" < ${q.range.to}) AS bookings,
            (SELECT COALESCE(SUM(c."valuePaise"),0) FROM vi_conversions c WHERE c."salonId" = sa.id AND c.type = 'BOOKING' AND c."occurredAt" >= ${q.range.from} AND c."occurredAt" < ${q.range.to}) AS value
          FROM salons sa WHERE sa.status = 'ACTIVE' ORDER BY 3 DESC LIMIT 1000`;
        return rows.map((r) => ({
          Salon: r.name,
          'Profile views': Number(r.views),
          Bookings: Number(r.bookings),
          'Value (INR)': Number(r.value) / 100,
          'Conversion %': Number(r.views)
            ? Math.round((Number(r.bookings) / Number(r.views)) * 1000) / 10
            : null,
        }));
      }
      case 'insights': {
        const rows = await this.prisma.viInsight.findMany({
          where: { createdAt: { gte: q.range.from, lt: q.range.to } },
          orderBy: { createdAt: 'desc' },
          take: 1000,
        });
        return rows.map((r) => ({
          Created: r.createdAt.toISOString(),
          Title: r.title,
          Department: r.department,
          Priority: r.priority,
          'Confidence %': r.confidencePct,
          Status: r.status,
          Action: r.action,
          Impact: r.impact,
          Source: r.source,
        }));
      }
    }
  }

  render(
    rows: Row[],
    format: ViReportFormat,
    title: string,
  ): { body: Buffer; contentType: string; ext: string } {
    if (format === 'csv') {
      const head = rows.length ? Object.keys(rows[0]) : ['No data'];
      const lines = [
        head.map(csvEscape).join(','),
        ...rows.map((r) => head.map((h) => csvEscape(r[h])).join(',')),
      ];
      return {
        // UTF-8 byte-order mark so Excel opens ₹ and Hindi text correctly.
        body: Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from(lines.join('\r\n'), 'utf8'),
        ]),
        contentType: 'text/csv; charset=utf-8',
        ext: 'csv',
      };
    }
    if (format === 'xlsx')
      return {
        body: toXlsx(
          rows.length ? rows : [{ Note: 'No data for this period' }],
        ),
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ext: 'xlsx',
      };
    return {
      body: tablePdf(title, rows),
      contentType: 'application/pdf',
      ext: 'pdf',
    };
  }

  async export(
    type: ViReportType,
    format: ViReportFormat,
    q: ViQuery,
    actor: ViActor,
  ) {
    const rows = await this.rows(type, q, actor);
    const title = `FastQue Visitor Intelligence - ${type} - ${q.range.from.toISOString().slice(0, 10)} to ${new Date(q.range.to.getTime() - 1).toISOString().slice(0, 10)}`;
    const out = this.render(rows, format, title);
    await this.prisma.auditLog
      .create({
        data: {
          actorUserId: actor.userId,
          action: 'VI_REPORT_EXPORTED',
          entityType: 'VISITOR_INTELLIGENCE',
          entityId: type,
          metadata: {
            format,
            rows: rows.length,
            period: q.filters.period,
          },
        },
      })
      .catch(() => undefined);
    return {
      ...out,
      filename: `fastque-${type}-${q.range.from.toISOString().slice(0, 10)}.${out.ext}`,
    };
  }

  // ---------- Schedules ----------

  async schedules() {
    return this.prisma.viReportSchedule.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSchedule(
    input: {
      reportType: ViReportType;
      format: ViReportFormat;
      frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
      recipientUserIds: string[];
      period: ViPeriod;
    },
    userId: string,
  ) {
    return this.prisma.viReportSchedule.create({
      data: {
        ...input,
        nextRunAt: nextRun(input.frequency, new Date()),
        createdByUserId: userId,
      },
    });
  }

  async deleteSchedule(id: string) {
    await this.prisma.viReportSchedule
      .delete({ where: { id } })
      .catch(() => undefined);
    return { ok: true };
  }

  @Cron('0 * * * *')
  async runDue(now = new Date()): Promise<number> {
    if (!ViConfigService.envEnabled()) return 0;
    const due = await this.prisma.viReportSchedule.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      take: 20,
    });
    for (const s of due) {
      let status: string;
      try {
        // Scheduled reports run with the creator's current rights (re-checked each time).
        const creatorRoles = (
          await this.prisma.userRole.findMany({
            where: { userId: s.createdByUserId },
            select: { role: true },
          })
        ).map((r) => r.role as string);
        const { viCapabilitiesFor } = await import('@barbercue/shared');
        const actor: ViActor = {
          userId: s.createdByUserId,
          roles: creatorRoles,
          staffRoles: [],
          capabilities: viCapabilitiesFor(creatorRoles),
          scope: { kind: 'platform' },
        };
        const period = s.period as ViPeriod;
        const q: ViQuery = {
          filters: { period },
          range: resolveViRange(period, now),
        };
        const file = await this.export(
          s.reportType as ViReportType,
          s.format as ViReportFormat,
          q,
          actor,
        );
        const users = await this.prisma.user.findMany({
          where: { id: { in: s.recipientUserIds } },
          select: { email: true },
        });
        const result = await viSendEmail(
          users.map((u) => u.email).filter((e): e is string => !!e),
          `FastQue ${s.reportType} report`,
          `Your scheduled ${s.frequency.toLowerCase()} report is attached.`,
          { filename: file.filename, content: file.body },
        );
        status =
          result === 'sent'
            ? 'Sent'
            : result === 'not_configured'
              ? 'Generated; not emailed (VI email not configured)'
              : 'Generated; email failed';
      } catch (e) {
        status = `Failed: ${e instanceof Error ? e.message.slice(0, 150) : 'unknown'}`;
        this.logger.warn(status);
      }
      await this.prisma.viReportSchedule.update({
        where: { id: s.id },
        data: {
          lastRunAt: now,
          lastStatus: status,
          nextRunAt: nextRun(s.frequency as 'DAILY', now),
        },
      });
    }
    return due.length;
  }
}

export function nextRun(
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  from: Date,
): Date {
  // 08:00 IST = 02:30 UTC.
  const d = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      2,
      30,
    ),
  );
  if (d <= from) d.setUTCDate(d.getUTCDate() + 1);
  if (freq === 'WEEKLY')
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  if (freq === 'MONTHLY') {
    if (d.getUTCDate() !== 1) {
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(1);
    }
  }
  return d;
}

/** A plain multi-page table PDF (standard Helvetica, no external fonts). Non-Latin text is transliterated to '?'. */
export function tablePdf(title: string, rows: Row[]): Buffer {
  const head = rows.length ? Object.keys(rows[0]) : ['No data for this period'];
  const clean = (s: string) =>
    s
      .replace(/₹/g, 'Rs ')
      .replace(/[^\x20-\x7e]/g, '?')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  const landscape = head.length > 6;
  const W = landscape ? 842 : 595;
  const H = landscape ? 595 : 842;
  const colW = (W - 60) / head.length;
  const maxChars = Math.max(4, Math.floor(colW / 4.6));
  const cut = (v: Cell) => clean(v == null ? '' : String(v)).slice(0, maxChars);
  const pages: string[] = [];
  let lines: string[] = [];
  let y = H - 50;
  const start = () => {
    lines = [
      `BT /F2 12 Tf 30 ${H - 30} Td (${clean(title).slice(0, 120)}) Tj ET`,
    ];
    y = H - 55;
    lines.push(
      ...head.map(
        (h, i) => `BT /F2 7 Tf ${30 + i * colW} ${y} Td (${cut(h)}) Tj ET`,
      ),
    );
    y -= 12;
  };
  start();
  for (const r of rows) {
    if (y < 40) {
      pages.push(lines.join('\n'));
      start();
    }
    lines.push(
      ...head.map(
        (h, i) => `BT /F1 7 Tf ${30 + i * colW} ${y} Td (${cut(r[h])}) Tj ET`,
      ),
    );
    y -= 10;
  }
  lines.push(
    `BT /F1 6 Tf 30 20 Td (Generated ${new Date().toISOString()} - aggregates only, no personal data) Tj ET`,
  );
  pages.push(lines.join('\n'));

  const objs: string[] = [];
  const add = (s: string) => objs.push(s) && objs.length;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES');
  add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  const kids: number[] = [];
  for (const content of pages) {
    const c = add(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${c} 0 R >>`,
      ),
    );
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
