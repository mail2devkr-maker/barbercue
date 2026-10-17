import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  BookingSource,
  BookingStatus,
  InvoiceStatus,
  QueueEntrySource,
  QueueEntryStatus,
  ServiceSessionStatus,
  decimalStringToPaise,
  paiseToRupees,
  type OwnerRevenueReportCustomerDto,
  type OwnerRevenueReportDto,
  type OwnerRevenueReportMetricDto,
  type OwnerRevenueReportPeriodDto,
  type OwnerRevenueReportQuery,
  type OwnerRevenueReportServiceDto,
  type OwnerRevenueReportStaffDto,
} from '@barbercue/shared';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import {
  addZonedCalendarDays,
  resolveSalonTimeZone,
  utcToZonedDateStr,
} from '../common/timezone/timezone';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import {
  mondayOf,
  firstOfMonth,
  addMonths,
  daysBetween,
  localRange,
} from './local-time';

type Source = (typeof BookingSource)[keyof typeof BookingSource] | 'UNKNOWN';

type MetricAccumulator = {
  completedVisits: number;
  grossServiceValuePaise: number;
  estimatedServiceValuePaise: number;
  invoiceCount: number;
  invoiceDiscountsPaise: number;
  invoicedAmountPaise: number;
  recordedCollectionsPaise: number;
  refundsPaise: number;
  invoicedIds: Set<string>;
};

type GroupAccumulator = MetricAccumulator & {
  key: string;
  label: string;
  id: string | null;
  identityVerified?: boolean;
};

type InvoiceRecord = Prisma.InvoiceGetPayload<{
  include: {
    lines: true;
    booking: { select: { source: true } };
  };
}>;

const MAX_REPORT_SOURCE_ROWS = 25_000;

const ZERO_METRIC = (): MetricAccumulator => ({
  completedVisits: 0,
  grossServiceValuePaise: 0,
  estimatedServiceValuePaise: 0,
  invoiceCount: 0,
  invoiceDiscountsPaise: 0,
  invoicedAmountPaise: 0,
  recordedCollectionsPaise: 0,
  refundsPaise: 0,
  invoicedIds: new Set<string>(),
});

function addAllocation(
  target: MetricAccumulator,
  field: keyof Omit<MetricAccumulator, 'invoicedIds'>,
  amount: number,
) {
  target[field] += amount;
}

function money(value: number): number {
  return paiseToRupees(value);
}

function metricDto(value: MetricAccumulator): OwnerRevenueReportMetricDto {
  return {
    completedVisits: value.completedVisits,
    grossServiceValue: money(value.grossServiceValuePaise),
    estimatedServiceValue: money(value.estimatedServiceValuePaise),
    invoiceCount: value.invoiceCount,
    invoiceDiscounts: money(value.invoiceDiscountsPaise),
    invoicedAmount: money(value.invoicedAmountPaise),
    recordedCollections: money(value.recordedCollectionsPaise),
    refunds: money(value.refundsPaise),
    netRecordedCollections: money(
      value.recordedCollectionsPaise - value.refundsPaise,
    ),
  };
}

/** Deterministic integer-paise allocation that preserves the source total exactly. */
export function allocatePaise(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const safeWeights = weights.map((weight) => Math.max(0, weight));
  const denominator = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (denominator === 0) {
    const each = Math.floor(total / weights.length);
    return weights.map((_, index) =>
      index === weights.length - 1 ? total - each * index : each,
    );
  }
  let allocated = 0;
  return safeWeights.map((weight, index) => {
    if (index === safeWeights.length - 1) return total - allocated;
    const part = Math.floor((total * weight) / denominator);
    allocated += part;
    return part;
  });
}

function bucketFor(
  date: string,
  groupBy: OwnerRevenueReportQuery['groupBy'],
): string {
  if (groupBy === 'month') return firstOfMonth(date);
  if (groupBy === 'week') return mondayOf(date);
  return date;
}

function newGroup(
  key: string,
  label: string,
  id: string | null,
  identityVerified?: boolean,
): GroupAccumulator {
  return { key, label, id, identityVerified, ...ZERO_METRIC() };
}

function groupFor(
  groups: Map<string, GroupAccumulator>,
  key: string,
  label: string,
  id: string | null,
  identityVerified?: boolean,
): GroupAccumulator {
  let group = groups.get(key);
  if (!group) {
    group = newGroup(key, label, id, identityVerified);
    groups.set(key, group);
  }
  return group;
}

function addVisitMetrics(
  metric: MetricAccumulator,
  visit: { valuePaise: number },
): void {
  metric.completedVisits += 1;
  metric.grossServiceValuePaise += visit.valuePaise;
  metric.estimatedServiceValuePaise += visit.valuePaise;
}

function sourceOfInvoice(
  invoice: InvoiceRecord,
  queueSources: Map<string, string>,
): Source {
  if (invoice.booking?.source) return invoice.booking.source;
  if (!invoice.queueEntryId) return 'UNKNOWN';
  return queueSources.get(invoice.queueEntryId) === QueueEntrySource.WALK_IN
    ? BookingSource.WALK_IN
    : 'UNKNOWN';
}

function includedBySource(
  source: Source,
  requested?: OwnerRevenueReportQuery['source'],
): boolean {
  return !requested || source === requested;
}

@Injectable()
export class RevenueReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async getReport(
    userId: string,
    salonId: string,
    query: OwnerRevenueReportQuery,
  ): Promise<OwnerRevenueReportDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        currency: true,
        timezone: true,
        city: { select: { countryCode: true } },
      },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const timeZone = resolveSalonTimeZone({
      timezone: salon.timezone,
      countryCode: salon.city.countryCode,
    });
    if (!timeZone) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'Set your shop’s timezone before viewing reports.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (daysBetween(query.from, query.to) > 365) {
      throw new AppException(
        BookingErrorCode.INVALID_FILTER,
        'A report may cover at most 366 calendar days.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const range = localRange(
      query.from,
      addZonedCalendarDays(query.to, 1),
      timeZone,
    );
    if (!range) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'Could not resolve the report dates in this shop’s timezone.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const [bookings, queueEntries, invoices] = await Promise.all([
          tx.booking.findMany({
            where: {
              salonId,
              status: BookingStatus.COMPLETED,
              OR: [
                { slotStart: { gte: range.start, lt: range.end } },
                {
                  queueEntries: {
                    some: {
                      status: QueueEntryStatus.COMPLETED,
                      serviceCompletedAt: { gte: range.start, lt: range.end },
                    },
                  },
                },
                {
                  queueEntries: {
                    some: {
                      status: QueueEntryStatus.COMPLETED,
                      serviceSessions: {
                        some: {
                          status: ServiceSessionStatus.COMPLETED,
                          endedAt: { gte: range.start, lt: range.end },
                        },
                      },
                    },
                  },
                },
              ],
              ...(query.source ? { source: query.source } : {}),
            },
            select: {
              id: true,
              customerId: true,
              guestName: true,
              slotStart: true,
              source: true,
              service: { select: { id: true, name: true, price: true } },
              services: {
                orderBy: { sortOrder: 'asc' },
                select: { serviceId: true, serviceName: true, price: true },
              },
              queueEntries: {
                where: { status: QueueEntryStatus.COMPLETED },
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: {
                  serviceCompletedAt: true,
                  serviceSessions: {
                    where: { status: ServiceSessionStatus.COMPLETED },
                    orderBy: { endedAt: 'desc' },
                    take: 1,
                    select: {
                      endedAt: true,
                      staff: { select: { id: true, displayName: true } },
                    },
                  },
                },
              },
              customer: { select: { id: true } },
            },
            orderBy: [{ slotStart: 'asc' }, { id: 'asc' }],
            take: MAX_REPORT_SOURCE_ROWS + 1,
          }),
          tx.queueEntry.findMany({
            where: {
              salonId,
              bookingId: null,
              source:
                query.source && query.source !== BookingSource.WALK_IN
                  ? { in: [] }
                  : QueueEntrySource.WALK_IN,
              status: QueueEntryStatus.COMPLETED,
              OR: [
                { serviceCompletedAt: { gte: range.start, lt: range.end } },
                {
                  serviceCompletedAt: null,
                  serviceSessions: {
                    some: {
                      status: ServiceSessionStatus.COMPLETED,
                      endedAt: { gte: range.start, lt: range.end },
                    },
                  },
                },
              ],
            },
            select: {
              id: true,
              customerId: true,
              contactName: true,
              serviceCompletedAt: true,
              serviceSessions: {
                where: { status: ServiceSessionStatus.COMPLETED },
                orderBy: { endedAt: 'desc' },
                take: 1,
                select: {
                  endedAt: true,
                  service: { select: { id: true, name: true, price: true } },
                  staff: { select: { id: true, displayName: true } },
                },
              },
              customer: { select: { id: true } },
            },
            orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
            take: MAX_REPORT_SOURCE_ROWS + 1,
          }),
          tx.invoice.findMany({
            where: {
              salonId,
              OR: [
                {
                  status: InvoiceStatus.ISSUED,
                  serviceDate: { gte: range.start, lt: range.end },
                },
                {
                  payments: {
                    some: { recordedAt: { gte: range.start, lt: range.end } },
                  },
                },
              ],
            },
            include: {
              lines: { orderBy: { sortOrder: 'asc' } },
              booking: { select: { source: true } },
            },
            orderBy: [{ serviceDate: 'asc' }, { id: 'asc' }],
            take: MAX_REPORT_SOURCE_ROWS + 1,
          }),
        ]);

        if (
          [bookings.length, queueEntries.length, invoices.length].some(
            (count) => count > MAX_REPORT_SOURCE_ROWS,
          )
        ) {
          throw new AppException(
            BookingErrorCode.INVALID_FILTER,
            `This report contains more than ${MAX_REPORT_SOURCE_ROWS.toLocaleString()} source rows. Narrow the date range and retry.`,
            HttpStatus.PAYLOAD_TOO_LARGE,
          );
        }

        const invoiceCurrencies = [
          ...new Set(invoices.map((invoice) => invoice.currency)),
        ];
        if (invoiceCurrencies.length > 1) {
          throw new AppException(
            BookingErrorCode.INVALID_FILTER,
            'This date range contains invoices in multiple currencies. Narrow the date range before comparing amounts.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const reportCurrency =
          salon.currency ??
          invoiceCurrencies[0] ??
          (salon.city.countryCode === 'IN' ? 'INR' : null);
        if (
          invoiceCurrencies.length === 1 &&
          reportCurrency &&
          invoiceCurrencies[0] !== reportCurrency
        ) {
          throw new AppException(
            BookingErrorCode.INVALID_FILTER,
            'This date range contains invoices in a currency different from the shop’s configured currency.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const invoicePayments = invoices.length
          ? await tx.invoicePayment.findMany({
              where: {
                salonId,
                invoiceId: { in: invoices.map((invoice) => invoice.id) },
                recordedAt: { gte: range.start, lt: range.end },
              },
              orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
              take: MAX_REPORT_SOURCE_ROWS + 1,
            })
          : [];
        if (invoicePayments.length > MAX_REPORT_SOURCE_ROWS) {
          throw new AppException(
            BookingErrorCode.INVALID_FILTER,
            `This report contains more than ${MAX_REPORT_SOURCE_ROWS.toLocaleString()} payment events. Narrow the date range and retry.`,
            HttpStatus.PAYLOAD_TOO_LARGE,
          );
        }
        const paymentsByInvoice = new Map<string, typeof invoicePayments>();
        for (const payment of invoicePayments) {
          const list = paymentsByInvoice.get(payment.invoiceId) ?? [];
          list.push(payment);
          paymentsByInvoice.set(payment.invoiceId, list);
        }

        const queueInvoiceIds = invoices.flatMap((invoice) =>
          invoice.queueEntryId ? [invoice.queueEntryId] : [],
        );
        const queueSources: Map<string, string> = queueInvoiceIds.length
          ? new Map<string, string>(
              (
                await tx.queueEntry.findMany({
                  where: { salonId, id: { in: queueInvoiceIds } },
                  select: { id: true, source: true },
                })
              ).map((entry) => [entry.id, entry.source]),
            )
          : new Map<string, string>();

        const totals = ZERO_METRIC();
        const byService = new Map<string, GroupAccumulator>();
        const byStaff = new Map<string, GroupAccumulator>();
        const byCustomer = new Map<string, GroupAccumulator>();
        const periodMap = new Map<string, MetricAccumulator>();
        let periodCursor =
          query.groupBy === 'month'
            ? firstOfMonth(query.from)
            : query.groupBy === 'week'
              ? mondayOf(query.from)
              : query.from;
        while (periodCursor <= query.to) {
          periodMap.set(periodCursor, ZERO_METRIC());
          periodCursor =
            query.groupBy === 'month'
              ? addMonths(periodCursor, 1)
              : addZonedCalendarDays(
                  periodCursor,
                  query.groupBy === 'week' ? 7 : 1,
                );
        }

        const periodAt = (date: Date): MetricAccumulator | undefined =>
          periodMap.get(
            bucketFor(utcToZonedDateStr(date, timeZone), query.groupBy),
          );

        const addCompletedVisit = (args: {
          id: string;
          date: Date;
          customerId: string | null;
          customerLabel: string;
          staffId: string | null;
          staffLabel: string | null;
          services: Array<{
            id: string | null;
            name: string;
            pricePaise: number;
          }>;
        }) => {
          const period = periodAt(args.date);
          const totalEstimate = args.services.reduce(
            (sum, service) => sum + service.pricePaise,
            0,
          );
          totals.completedVisits += 1;
          totals.grossServiceValuePaise += totalEstimate;
          totals.estimatedServiceValuePaise += totalEstimate;
          if (period) {
            period.completedVisits += 1;
            period.grossServiceValuePaise += totalEstimate;
            period.estimatedServiceValuePaise += totalEstimate;
          }

          const customerKey = args.customerId
            ? `customer:${args.customerId}`
            : `guest:${args.id}`;
          const customer = groupFor(
            byCustomer,
            customerKey,
            args.customerLabel,
            args.customerId,
            Boolean(args.customerId),
          );
          addVisitMetrics(customer, { valuePaise: totalEstimate });

          const staffKey = args.staffId
            ? `staff:${args.staffId}`
            : `unattributed:${args.staffLabel ?? 'unknown'}`;
          const staff = groupFor(
            byStaff,
            staffKey,
            args.staffLabel ?? 'Unattributed staff',
            args.staffId,
            Boolean(args.staffId),
          );
          addVisitMetrics(staff, { valuePaise: totalEstimate });

          for (const service of args.services) {
            const serviceKey = service.id
              ? `service:${service.id}`
              : `service-name:${service.name}`;
            const group = groupFor(
              byService,
              serviceKey,
              service.name,
              service.id,
              Boolean(service.id),
            );
            addVisitMetrics(group, { valuePaise: service.pricePaise });
          }
        };

        for (const booking of bookings) {
          const completedQueueEntry = booking.queueEntries[0];
          const completedSession = completedQueueEntry?.serviceSessions[0];
          const actualStaff = completedSession?.staff;
          const services = booking.services.length
            ? booking.services.map((service) => ({
                id: service.serviceId,
                name: service.serviceName,
                pricePaise: decimalStringToPaise(service.price.toString()),
              }))
            : [
                {
                  id: booking.service.id,
                  name: booking.service.name,
                  pricePaise: decimalStringToPaise(
                    booking.service.price.toString(),
                  ),
                },
              ];
          addCompletedVisit({
            id: booking.id,
            date:
              completedQueueEntry?.serviceCompletedAt ??
              completedSession?.endedAt ??
              booking.slotStart,
            customerId: booking.customerId,
            customerLabel: booking.customer?.id
              ? 'FastQue customer'
              : (booking.guestName ?? 'Guest visit'),
            staffId: actualStaff?.id ?? null,
            staffLabel: actualStaff?.displayName ?? null,
            services,
          });
        }

        for (const entry of queueEntries) {
          const session = entry.serviceSessions[0];
          const date = entry.serviceCompletedAt ?? session?.endedAt;
          if (!date) continue;
          addCompletedVisit({
            id: entry.id,
            date,
            customerId: entry.customerId,
            customerLabel: entry.customer?.id
              ? 'FastQue customer'
              : (entry.contactName ?? 'Guest visit'),
            staffId: session?.staff.id ?? null,
            staffLabel: session?.staff.displayName ?? null,
            services: session
              ? [
                  {
                    id: session.service.id,
                    name: session.service.name,
                    pricePaise: decimalStringToPaise(
                      session.service.price.toString(),
                    ),
                  },
                ]
              : [{ id: null, name: 'Service unavailable', pricePaise: 0 }],
          });
        }

        const invoiceStaffLinks = invoices.flatMap((invoice) =>
          invoice.bookingId ? [invoice.bookingId] : [],
        );
        const queueLinkIds = invoices.flatMap((invoice) =>
          invoice.queueEntryId ? [invoice.queueEntryId] : [],
        );
        const linkedQueue =
          invoiceStaffLinks.length || queueLinkIds.length
            ? await tx.queueEntry.findMany({
                where: {
                  salonId,
                  OR: [
                    ...(invoiceStaffLinks.length
                      ? [{ bookingId: { in: invoiceStaffLinks } }]
                      : []),
                    ...(queueLinkIds.length
                      ? [{ id: { in: queueLinkIds } }]
                      : []),
                  ],
                },
                select: {
                  id: true,
                  bookingId: true,
                  serviceSessions: {
                    where: { status: ServiceSessionStatus.COMPLETED },
                    orderBy: { endedAt: 'desc' },
                    take: 1,
                    select: {
                      staff: { select: { id: true, displayName: true } },
                    },
                  },
                },
              })
            : [];
        const staffForSource = new Map<
          string,
          { id: string; displayName: string }
        >();
        for (const entry of linkedQueue) {
          const staff = entry.serviceSessions[0]?.staff;
          if (staff) {
            staffForSource.set(entry.id, staff);
            if (entry.bookingId) staffForSource.set(entry.bookingId, staff);
          }
        }

        const sourceInvoices = invoices.filter((invoice) =>
          includedBySource(
            sourceOfInvoice(invoice, queueSources),
            query.source,
          ),
        );
        for (const invoice of sourceInvoices) {
          const serviceInRange =
            invoice.serviceDate >= range.start &&
            invoice.serviceDate < range.end;
          const sourceStaff = staffForSource.get(
            invoice.bookingId ?? invoice.queueEntryId ?? '',
          );
          const staffLabel =
            sourceStaff?.displayName ??
            invoice.staffName ??
            'Unattributed staff';
          const staffKey = sourceStaff
            ? `staff:${sourceStaff.id}`
            : invoice.staffName
              ? `label:${invoice.staffName}`
              : 'unattributed:unknown';
          const staffGroup = groupFor(
            byStaff,
            staffKey,
            staffLabel,
            sourceStaff?.id ?? null,
            Boolean(sourceStaff),
          );
          const guestSourceId =
            invoice.bookingId ?? invoice.queueEntryId ?? invoice.id;
          const customerKey = invoice.customerId
            ? `customer:${invoice.customerId}`
            : `guest:${guestSourceId}`;
          const customerLabel =
            invoice.customerName ??
            (invoice.customerId ? 'FastQue customer' : 'Guest visit');
          const customerGroup = groupFor(
            byCustomer,
            customerKey,
            customerLabel,
            invoice.customerId,
            Boolean(invoice.customerId),
          );

          const lines = invoice.lines.map((line) => ({
            line,
            netPaise: Math.max(
              0,
              decimalStringToPaise(line.lineTotal.toString()),
            ),
            discountPaise: decimalStringToPaise(line.discount.toString()),
          }));
          const netWeights = lines.map((line) => line.netPaise);
          const amountAllocations = allocatePaise(
            decimalStringToPaise(invoice.total.toString()),
            netWeights,
          );
          const discountAllocations = allocatePaise(
            decimalStringToPaise(invoice.discountTotal.toString()),
            lines.map((line) => line.discountPaise),
          );

          if (invoice.status === InvoiceStatus.ISSUED && serviceInRange) {
            const invoiceAmount = decimalStringToPaise(
              invoice.total.toString(),
            );
            const discounts = decimalStringToPaise(
              invoice.discountTotal.toString(),
            );
            totals.invoiceCount += 1;
            totals.invoiceDiscountsPaise += discounts;
            totals.invoicedAmountPaise += invoiceAmount;
            const servicePeriod = periodAt(invoice.serviceDate);
            if (servicePeriod) {
              servicePeriod.invoiceCount += 1;
              servicePeriod.invoiceDiscountsPaise += discounts;
              servicePeriod.invoicedAmountPaise += invoiceAmount;
            }
            for (const group of [staffGroup, customerGroup]) {
              if (!group.invoicedIds.has(invoice.id)) {
                group.invoicedIds.add(invoice.id);
                group.invoiceCount += 1;
              }
            }
            for (let index = 0; index < lines.length; index++) {
              const item = lines[index];
              const serviceKey = item.line.serviceId
                ? `service:${item.line.serviceId}`
                : `service-name:${item.line.description}`;
              const group = groupFor(
                byService,
                serviceKey,
                item.line.description,
                item.line.serviceId,
                Boolean(item.line.serviceId),
              );
              if (!group.invoicedIds.has(invoice.id)) {
                group.invoicedIds.add(invoice.id);
                group.invoiceCount += 1;
              }
              group.invoiceDiscountsPaise += discountAllocations[index] ?? 0;
              group.invoicedAmountPaise += amountAllocations[index] ?? 0;
            }
          }

          const invoiceCashEvents = paymentsByInvoice.get(invoice.id) ?? [];
          if (invoiceCashEvents.length) {
            for (const payment of invoiceCashEvents) {
              const amount = decimalStringToPaise(payment.amount.toString());
              const isRefund = payment.kind === 'REFUND';
              const totalField = isRefund
                ? 'refundsPaise'
                : 'recordedCollectionsPaise';
              addAllocation(totals, totalField, amount);
              addAllocation(staffGroup, totalField, amount);
              addAllocation(customerGroup, totalField, amount);
              const cashPeriod = periodAt(payment.recordedAt);
              if (cashPeriod) addAllocation(cashPeriod, totalField, amount);
              const allocations = allocatePaise(amount, netWeights);
              for (let index = 0; index < lines.length; index++) {
                const item = lines[index];
                const serviceKey = item.line.serviceId
                  ? `service:${item.line.serviceId}`
                  : `service-name:${item.line.description}`;
                const serviceGroup = groupFor(
                  byService,
                  serviceKey,
                  item.line.description,
                  item.line.serviceId,
                  Boolean(item.line.serviceId),
                );
                addAllocation(
                  serviceGroup,
                  totalField,
                  allocations[index] ?? 0,
                );
              }
            }
          }
        }

        const serviceDtos: OwnerRevenueReportServiceDto[] = [
          ...byService.values(),
        ]
          .map((group) => ({
            serviceId: group.id,
            key: group.key,
            label: group.label,
            ...metricDto(group),
          }))
          .sort(
            (a, b) =>
              b.invoicedAmount - a.invoicedAmount ||
              b.estimatedServiceValue - a.estimatedServiceValue ||
              a.label.localeCompare(b.label) ||
              a.key.localeCompare(b.key),
          );
        const staffDtos: OwnerRevenueReportStaffDto[] = [...byStaff.values()]
          .map((group) => ({
            staffId: group.id,
            identityVerified: group.identityVerified ?? false,
            key: group.key,
            label: group.label,
            ...metricDto(group),
          }))
          .sort(
            (a, b) =>
              b.netRecordedCollections - a.netRecordedCollections ||
              b.estimatedServiceValue - a.estimatedServiceValue ||
              a.label.localeCompare(b.label) ||
              a.key.localeCompare(b.key),
          );
        const customerDtos: OwnerRevenueReportCustomerDto[] = [
          ...byCustomer.values(),
        ]
          .map((group) => ({
            customerId: group.id,
            identityVerified: group.identityVerified ?? false,
            key: group.key,
            label: group.label,
            ...metricDto(group),
          }))
          .sort(
            (a, b) =>
              b.netRecordedCollections - a.netRecordedCollections ||
              b.estimatedServiceValue - a.estimatedServiceValue ||
              a.label.localeCompare(b.label) ||
              a.key.localeCompare(b.key),
          );
        const periods: OwnerRevenueReportPeriodDto[] = [
          ...periodMap.entries(),
        ].map(([period, value]) => ({ period, ...metricDto(value) }));

        return {
          salonId,
          currency: reportCurrency,
          timeZone,
          from: query.from,
          to: query.to,
          groupBy: query.groupBy,
          source: query.source ?? null,
          periods,
          totals: metricDto(totals),
          byService: serviceDtos,
          byStaff: staffDtos,
          byCustomer: customerDtos,
          dataSemantics: {
            estimateBasis:
              'BOOKING_PRICE_SNAPSHOT_AND_CURRENT_QUEUE_SERVICE_PRICE',
            cashSource: 'SHOP_RECORDED_INVOICE_PAYMENT_LEDGER',
            serviceCashAllocation: 'PRO_RATA_BY_INVOICE_LINE_TOTAL',
            externalAttribution: 'NOT_CAPTURED_BY_EXISTING_SOURCE_FIELDS',
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async getCsv(
    userId: string,
    salonId: string,
    query: OwnerRevenueReportQuery,
  ): Promise<Buffer> {
    const report = await this.getReport(userId, salonId, query);
    const rows: Array<Array<string | number | null>> = [
      [
        'section',
        'id',
        'label',
        'completed_visits',
        'gross_service_value',
        'estimated_service_value',
        'invoice_count',
        'invoice_discounts',
        'invoiced_amount',
        'recorded_collections',
        'refunds',
        'net_recorded_collections',
      ],
      [
        'TOTAL',
        report.salonId,
        'Report total',
        report.totals.completedVisits,
        report.totals.grossServiceValue,
        report.totals.estimatedServiceValue,
        report.totals.invoiceCount,
        report.totals.invoiceDiscounts,
        report.totals.invoicedAmount,
        report.totals.recordedCollections,
        report.totals.refunds,
        report.totals.netRecordedCollections,
      ],
      ...report.periods.map((period) => [
        'PERIOD',
        period.period,
        period.period,
        period.completedVisits,
        period.grossServiceValue,
        period.estimatedServiceValue,
        period.invoiceCount,
        period.invoiceDiscounts,
        period.invoicedAmount,
        period.recordedCollections,
        period.refunds,
        period.netRecordedCollections,
      ]),
      ...report.byService.map((row) => [
        'SERVICE',
        row.serviceId,
        row.label,
        row.completedVisits,
        row.grossServiceValue,
        row.estimatedServiceValue,
        row.invoiceCount,
        row.invoiceDiscounts,
        row.invoicedAmount,
        row.recordedCollections,
        row.refunds,
        row.netRecordedCollections,
      ]),
      ...report.byStaff.map((row) => [
        'STAFF',
        row.staffId,
        row.label,
        row.completedVisits,
        row.grossServiceValue,
        row.estimatedServiceValue,
        row.invoiceCount,
        row.invoiceDiscounts,
        row.invoicedAmount,
        row.recordedCollections,
        row.refunds,
        row.netRecordedCollections,
      ]),
      ...report.byCustomer.map((row) => [
        'CUSTOMER',
        row.customerId,
        row.label,
        row.completedVisits,
        row.grossServiceValue,
        row.estimatedServiceValue,
        row.invoiceCount,
        row.invoiceDiscounts,
        row.invoicedAmount,
        row.recordedCollections,
        row.refunds,
        row.netRecordedCollections,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    return Buffer.from(`\uFEFF${csv}\r\n`, 'utf8');
  }
}

export function csvCell(value: string | number | null): string {
  if (value === null) return '""';
  if (typeof value === 'number') return String(value);
  // Spreadsheet programs execute cells beginning with formula tokens. Prefix dangerous text with
  // an apostrophe (including after whitespace); numeric values remain numeric cells.
  let firstContentIndex = 0;
  while (firstContentIndex < value.length) {
    const code = value.charCodeAt(firstContentIndex);
    const character = value[firstContentIndex] ?? '';
    if (
      code <= 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      /\s/u.test(character)
    ) {
      firstContentIndex += 1;
    } else {
      break;
    }
  }
  const firstContentCharacter = value[firstContentIndex] ?? '';
  const safe = ['=', '+', '@', '-'].includes(firstContentCharacter)
    ? `'${value}`
    : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
