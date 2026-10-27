import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import {
  normalizeContactPhone,
  type AdminAnalyticsRangeQuery,
} from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { csvCell } from '../../owner-ops/revenue-report.service';
import { AdminCustomerAnalyticsService } from './admin-customer-analytics.service';
import { AdminStaffAnalyticsService } from './admin-staff-analytics.service';

export type ExportCategory =
  | 'CUSTOMER_REPORT'
  | 'CUSTOMER_CONTACTS'
  | 'STAFF_PERFORMANCE'
  | 'STAFF_CONTACTS';

export interface ExportFile {
  filename: string;
  body: Buffer;
  rows: number;
}

const rupees = (paise: number) => (paise / 100).toFixed(2);

function toCsv(
  meta: string,
  header: string[],
  rows: Array<Array<string | number | null>>,
): Buffer {
  const lines = [[meta], header, ...rows].map((r) => r.map(csvCell).join(','));
  // Byte-order mark so spreadsheet apps read the file as UTF-8 (₹, non-Latin names).
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

/**
 * Server-generated admin data exports. Every file — including a failed attempt — is recorded in the
 * audit log with who asked, what category, the period, the field set and the row count. Contact
 * exports are only reachable through their own routes, whose roles are narrower than the analytics.
 */
@Injectable()
export class AdminDataExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: AdminCustomerAnalyticsService,
    private readonly staff: AdminStaffAnalyticsService,
  ) {}

  async export(
    actorUserId: string,
    category: ExportCategory,
    query: AdminAnalyticsRangeQuery,
  ): Promise<ExportFile> {
    const exportId = randomUUID();
    try {
      const { file, fields, suppression } = await this.build(category, query);
      await this.audit(actorUserId, exportId, category, query, {
        outcome: 'SUCCEEDED',
        fields,
        rows: file.rows,
        ...(suppression ? { phoneSuppression: suppression } : {}),
      });
      return file;
    } catch (error) {
      await this.audit(actorUserId, exportId, category, query, {
        outcome: 'FAILED',
      });
      throw error;
    }
  }

  private async audit(
    actorUserId: string,
    exportId: string,
    category: ExportCategory,
    query: AdminAnalyticsRangeQuery,
    details: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'ADMIN_DATA_EXPORT',
        entityType: 'AdminExport',
        entityId: exportId,
        metadata: {
          category,
          from: query.from,
          to: query.to,
          ...details,
        } as never,
      },
    });
  }

  private async build(
    category: ExportCategory,
    query: AdminAnalyticsRangeQuery,
  ) {
    const period = `${query.from}_to_${query.to}`;
    switch (category) {
      case 'CUSTOMER_REPORT':
      case 'CUSTOMER_CONTACTS': {
        const withContact = category === 'CUSTOMER_CONTACTS';
        const { overview, contacts } = await this.customers.exportRows(
          query,
          withContact,
        );
        const header = [
          'Customer ID (masked)',
          'First visit (UTC)',
          'Last visit (UTC)',
          'Completed visits',
          'Cancelled',
          'No-shows',
          'Service value (INR)',
          'Preferred category',
        ];
        const suppressed = withContact
          ? await this.suppressedPhones(
              [...(contacts?.values() ?? [])].map((c) => c.phone),
            )
          : null;
        if (withContact) header.push('Phone', 'Email', 'Account created (UTC)');
        const rows = overview.customers.map((c) => {
          const row: Array<string | number | null> = [
            c.maskedId,
            c.firstVisitAt,
            c.lastVisitAt,
            c.completedVisits,
            c.cancelled,
            c.noShow,
            rupees(c.serviceValuePaise),
            c.preferredCategory,
          ];
          if (withContact) {
            const contact = contacts?.get(c.maskedId);
            const phone = contact?.phone ?? null;
            const hidden = phone !== null && suppressed?.blocked.has(phone);
            row.push(
              hidden ? '(suppressed)' : phone,
              contact?.email ?? null,
              contact?.createdAt.toISOString() ?? null,
            );
          }
          return row;
        });
        const note = withContact
          ? suppressed?.checked
            ? 'Phones on the contact-suppression list are withheld.'
            : 'Contact-suppression list could not be checked (CONTACT_LEDGER_HASH_KEY not set).'
          : 'No contact details.';
        return {
          file: {
            filename: `fastque-customers${withContact ? '-contacts' : ''}-${period}.csv`,
            body: toCsv(
              `FastQue customers ${query.from} to ${query.to} (IST). Account customers only. ${note} Confidential.`,
              header,
              rows,
            ),
            rows: rows.length,
          },
          fields: withContact ? 'report+contact' : 'report',
          suppression: withContact
            ? {
                checked: suppressed?.checked ?? false,
                withheld: suppressed?.blocked.size ?? 0,
              }
            : null,
        };
      }
      case 'STAFF_PERFORMANCE':
      case 'STAFF_CONTACTS': {
        const withContact = category === 'STAFF_CONTACTS';
        const { overview, contacts } = await this.staff.exportRows(
          query,
          withContact,
        );
        const header = [
          'Staff ID',
          'Display name',
          'Salon',
          'Salon ID',
          'City',
          'Role',
          'Status',
          'Completed services',
          'Distinct services',
          'Service minutes',
          'Average minutes',
          'Service value (INR, menu price)',
          'Scheduled minutes',
          'Utilisation %',
        ];
        if (withContact) header.push('Phone', 'Email');
        const rows = overview.staff.map((s) => {
          const row: Array<string | number | null> = [
            s.id,
            s.displayName,
            s.salonName,
            s.salonPublicId,
            s.city,
            s.role,
            s.status,
            s.completedServices,
            s.distinctServices,
            s.serviceMinutes,
            s.averageServiceMinutes,
            rupees(s.serviceValuePaise),
            s.scheduledMinutes,
            s.utilizationPercent,
          ];
          if (withContact) {
            const contact = contacts?.get(s.id);
            row.push(contact?.phone ?? null, contact?.email ?? null);
          }
          return row;
        });
        return {
          file: {
            filename: `fastque-salon-staff${withContact ? '-contacts' : ''}-${period}.csv`,
            body: toCsv(
              `FastQue salon staff ${query.from} to ${query.to} (IST). ${withContact ? 'Includes contact details. Confidential.' : 'No contact details.'}`,
              header,
              rows,
            ),
            rows: rows.length,
          },
          fields: withContact ? 'performance+contact' : 'performance',
          suppression: null,
        };
      }
    }
  }

  /** Phones on the global contact-suppression list (same keyed hash as the consent ledger). */
  private async suppressedPhones(
    phones: Array<string | null>,
  ): Promise<{ checked: boolean; blocked: Set<string> }> {
    const key = process.env.CONTACT_LEDGER_HASH_KEY;
    if (!key) return { checked: false, blocked: new Set() };
    const byHash = new Map<string, string>();
    for (const phone of phones) {
      const e164 = phone ? normalizeContactPhone(phone) : null;
      if (phone && e164)
        byHash.set(createHmac('sha256', key).update(e164).digest('hex'), phone);
    }
    if (byHash.size === 0) return { checked: true, blocked: new Set() };
    const rows = await this.prisma.contactSuppression.findMany({
      where: { phoneHash: { in: [...byHash.keys()] } },
      select: { phoneHash: true },
    });
    return {
      checked: true,
      blocked: new Set(rows.map((r) => byHash.get(r.phoneHash)!)),
    };
  }
}
