import { createHash } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CRM_LEAD_STATUS_META,
  CRM_MANUAL_LEAD_STATUSES,
  CRM_WORKFLOW_LOCKED_STATUSES,
  CrmLeadSource,
  type CrmActivityDto,
  type CrmEmployeeRefDto,
  type CrmImportPreviewDto,
  type CrmLeadDto,
  type CrmLeadInput,
  type CrmLeadListQuery,
  type CrmLeadStatus,
  type CrmLeadUpdateInput,
  type CrmPageDto,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { readSpreadsheet } from '../inventory/upload/spreadsheet-reader';
import {
  CrmAccessService,
  forbidden,
  notFound,
  type CrmActor,
} from './crm-access.service';
import { logLeadActivity, notifyCrm } from './crm-events';

export const employeeSelect = {
  id: true,
  employeeCode: true,
  fullName: true,
  territory: true,
} as const;
export const toEmployeeRef = (e: {
  id: string;
  employeeCode: string;
  fullName: string;
  territory: string | null;
}): CrmEmployeeRefDto => ({
  id: e.id,
  employeeCode: e.employeeCode,
  fullName: e.fullName,
  territory: e.territory,
});

const leadInclude = {
  employeeProfile: { select: employeeSelect },
  onboardingApplication: {
    select: { id: true, reference: true, status: true },
  },
} satisfies Prisma.EmployeeCrmLeadInclude;
type LeadRow = Prisma.EmployeeCrmLeadGetPayload<{
  include: typeof leadInclude;
}>;

export function toLeadDto(l: LeadRow): CrmLeadDto {
  return {
    id: l.id,
    shopName: l.shopName,
    businessType: l.businessType,
    ownerName: l.ownerName,
    managerName: l.managerName,
    contactName: l.contactName,
    phone: l.phone,
    alternatePhone: l.alternatePhone,
    whatsappPhone: l.whatsappPhone,
    email: l.email,
    addressLine: l.addressLine,
    locality: l.locality,
    city: l.city,
    state: l.state,
    postalCode: l.postalCode,
    mapsUrl: l.mapsUrl,
    latitude: l.latitude,
    longitude: l.longitude,
    source: l.source,
    salonSize: l.salonSize,
    chairCount: l.chairCount,
    existingSoftware: l.existingSoftware,
    territory: l.territory,
    status: l.status,
    statusLabel: CRM_LEAD_STATUS_META[l.status].label,
    priority: l.priority,
    interestLevel: l.interestLevel,
    nextAction: l.nextAction,
    nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null,
    lastContactedAt: l.lastContactedAt?.toISOString() ?? null,
    contactAttempts: l.contactAttempts,
    meetingAt: l.meetingAt?.toISOString() ?? null,
    notes: l.notes,
    objections: l.objections,
    lostReason: l.lostReason,
    assignedEmployee: toEmployeeRef(l.employeeProfile),
    assignedAt: l.assignedAt?.toISOString() ?? null,
    onboarding: l.onboardingApplication
      ? {
          id: l.onboardingApplication.id,
          reference: l.onboardingApplication.reference,
          status: l.onboardingApplication.status,
        }
      : null,
    onboardedSalonId: l.onboardedSalonId,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

/** Digits only, last 10 (Indian mobile numbers) — used for duplicate detection. */
export const phoneKey = (p: string | null | undefined) => {
  const d = (p ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d || null;
};
const nameKey = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function leadData(
  input: Partial<CrmLeadInput>,
): Prisma.EmployeeCrmLeadUncheckedUpdateInput {
  const d: Prisma.EmployeeCrmLeadUncheckedUpdateInput = {};
  const set = <K extends keyof CrmLeadInput>(k: K, v: unknown) => {
    if (input[k] !== undefined) (d as Record<string, unknown>)[k] = v;
  };
  set('shopName', input.shopName?.trim());
  for (const k of [
    'businessType',
    'ownerName',
    'managerName',
    'contactName',
    'phone',
    'alternatePhone',
    'whatsappPhone',
    'email',
    'addressLine',
    'locality',
    'city',
    'state',
    'postalCode',
    'mapsUrl',
    'salonSize',
    'existingSoftware',
    'territory',
    'nextAction',
    'notes',
    'objections',
  ] as const)
    set(
      k,
      typeof input[k] === 'string'
        ? input[k].trim() || null
        : (input[k] ?? null),
    );
  for (const k of [
    'latitude',
    'longitude',
    'chairCount',
    'interestLevel',
  ] as const)
    set(k, input[k] ?? null);
  set('source', input.source);
  set('priority', input.priority);
  set(
    'nextFollowUpAt',
    input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null,
  );
  return d;
}

// ---- Import column mapping (flexible header names → lead fields) ----
export const LEAD_IMPORT_FIELDS: Record<string, string> = {
  shopName: 'Salon name',
  businessType: 'Business type',
  ownerName: 'Owner name',
  managerName: 'Manager name',
  phone: 'Phone',
  alternatePhone: 'Alternate phone',
  whatsappPhone: 'WhatsApp',
  email: 'Email',
  addressLine: 'Address',
  locality: 'Area / locality',
  city: 'City',
  state: 'State',
  postalCode: 'PIN code',
  mapsUrl: 'Google Maps link',
  latitude: 'Latitude',
  longitude: 'Longitude',
  source: 'Lead source',
  salonSize: 'Salon size',
  chairCount: 'Chairs',
  existingSoftware: 'Existing software',
  territory: 'Territory',
  priority: 'Priority',
  assignTo: 'Assigned employee (code or name)',
  notes: 'Notes',
};
const ALIASES: Array<[RegExp, string]> = [
  [
    /^(salon|shop|business|parlou?r)( name)?$|^name of (the )?(salon|shop)$|^salon$/,
    'shopName',
  ],
  [/business type|salon type|^category$|^type$/, 'businessType'],
  [/^owner( name)?$|proprietor/, 'ownerName'],
  [/manager/, 'managerName'],
  [/whats ?app/, 'whatsappPhone'],
  [
    /alternate|alt(ernative)? (phone|mobile|number)|second(ary)? (phone|number)/,
    'alternatePhone',
  ],
  [
    /^(primary )?(phone|mobile|contact)( (no|number))?$|^contact phone$|^phone number$|^mobile number$/,
    'phone',
  ],
  [/e ?mail/, 'email'],
  [/^(full )?address|street/, 'addressLine'],
  [/area|locality|neighbou?rhood|sector/, 'locality'],
  [/^city|^town/, 'city'],
  [/^state/, 'state'],
  [/pin ?code|postal|zip/, 'postalCode'],
  [/maps?( link| url)?$|google maps/, 'mapsUrl'],
  [/^lat(itude)?$/, 'latitude'],
  [/^(lng|lon|long|longitude)$/, 'longitude'],
  [/source/, 'source'],
  [/size/, 'salonSize'],
  [/chairs?/, 'chairCount'],
  [/software|provider|existing (app|system)/, 'existingSoftware'],
  [/territory|zone|region/, 'territory'],
  [/priority/, 'priority'],
  [/assign|employee|executive|sales ?(person|rep)|owner of lead/, 'assignTo'],
  [/notes?|remarks?|comments?/, 'notes'],
];
export function guessLeadField(header: string): string | null {
  const k = header
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!k) return null;
  for (const [re, field] of ALIASES) if (re.test(k)) return field;
  return null;
}
const SOURCE_ALIASES: Record<string, CrmLeadSource> = {
  field: 'FIELD_VISIT',
  'field visit': 'FIELD_VISIT',
  'field discovery': 'FIELD_VISIT',
  referral: 'REFERRAL',
  'cold call': 'COLD_CALL',
  calling: 'COLD_CALL',
  whatsapp: 'WHATSAPP',
  social: 'SOCIAL_MEDIA',
  instagram: 'SOCIAL_MEDIA',
  facebook: 'SOCIAL_MEDIA',
  website: 'INBOUND',
  inbound: 'INBOUND',
  'imported database': 'OTHER',
};

interface ImportRow {
  rowNumber: number;
  data: Record<string, string | number | null>;
  assignTo: string | null;
  issues: string[];
  status: 'NEW' | 'DUPLICATE' | 'ERROR';
}

@Injectable()
export class CrmLeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CrmAccessService,
  ) {}

  async list(
    a: CrmActor,
    q: CrmLeadListQuery,
  ): Promise<CrmPageDto<CrmLeadDto>> {
    const statuses = q.status
      ?.split(',')
      .filter((s) => s in CRM_LEAD_STATUS_META) as CrmLeadStatus[] | undefined;
    const text = q.q?.trim();
    const digits = text?.replace(/\D/g, '');
    const where: Prisma.EmployeeCrmLeadWhereInput = {
      AND: [
        this.access.leadScope(a),
        ...(a.team && q.employeeId
          ? [{ employeeProfileId: q.employeeId }]
          : []),
        ...(statuses?.length ? [{ status: { in: statuses } }] : []),
        ...(q.territory
          ? [
              {
                territory: {
                  equals: q.territory,
                  mode: 'insensitive' as const,
                },
              },
            ]
          : []),
        ...(q.city
          ? [{ city: { equals: q.city, mode: 'insensitive' as const } }]
          : []),
        ...(q.source ? [{ source: q.source }] : []),
        ...(q.priority ? [{ priority: q.priority }] : []),
        ...(q.followUpDue === 'true'
          ? [{ nextFollowUpAt: { lte: new Date() } }]
          : []),
        ...(text
          ? [
              {
                OR: [
                  {
                    shopName: { contains: text, mode: 'insensitive' as const },
                  },
                  {
                    ownerName: { contains: text, mode: 'insensitive' as const },
                  },
                  {
                    contactName: {
                      contains: text,
                      mode: 'insensitive' as const,
                    },
                  },
                  { city: { contains: text, mode: 'insensitive' as const } },
                  {
                    locality: { contains: text, mode: 'insensitive' as const },
                  },
                  ...(digits && digits.length >= 4
                    ? [
                        { phone: { contains: digits } },
                        { whatsappPhone: { contains: digits } },
                        { alternatePhone: { contains: digits } },
                      ]
                    : []),
                ],
              },
            ]
          : []),
      ],
    };
    const orderBy: Prisma.EmployeeCrmLeadOrderByWithRelationInput[] =
      q.sort === 'created'
        ? [{ createdAt: 'desc' }]
        : q.sort === 'followUp'
          ? [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }]
          : q.sort === 'name'
            ? [{ shopName: 'asc' }]
            : q.sort === 'priority'
              ? [{ priority: 'desc' }, { updatedAt: 'desc' }]
              : [{ updatedAt: 'desc' }];
    const [total, rows] = await Promise.all([
      this.prisma.employeeCrmLead.count({ where }),
      this.prisma.employeeCrmLead.findMany({
        where,
        include: leadInclude,
        orderBy: [...orderBy, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
    ]);
    return {
      items: rows.map(toLeadDto),
      total,
      page: q.page,
      pageSize: q.limit,
    };
  }

  async get(a: CrmActor, id: string): Promise<CrmLeadDto> {
    await this.access.lead(a, id);
    return toLeadDto(
      await this.prisma.employeeCrmLead.findUniqueOrThrow({
        where: { id },
        include: leadInclude,
      }),
    );
  }

  /** Possible duplicates (same phone, or same name in the same city) the actor may know about. */
  private async duplicateOf(
    input: {
      shopName?: string | null;
      phone?: string | null;
      city?: string | null;
    },
    excludeId?: string,
  ) {
    const pk = phoneKey(input.phone);
    const or: Prisma.EmployeeCrmLeadWhereInput[] = [];
    if (pk && pk.length === 10)
      or.push({ phone: { endsWith: pk } }, { whatsappPhone: { endsWith: pk } });
    if (input.shopName && input.city)
      or.push({
        shopName: { equals: input.shopName.trim(), mode: 'insensitive' },
        city: { equals: input.city.trim(), mode: 'insensitive' },
      });
    if (!or.length) return null;
    return this.prisma.employeeCrmLead.findFirst({
      where: { OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: {
        id: true,
        shopName: true,
        employeeProfile: { select: { fullName: true } },
      },
    });
  }

  async create(a: CrmActor, input: CrmLeadInput): Promise<CrmLeadDto> {
    this.access.assertWrite(a);
    const owner = await this.access.ownerFor(a, input.assignToEmployeeId);
    const dup = await this.duplicateOf(input);
    if (dup)
      throw new AppException(
        'CRM_DUPLICATE_LEAD',
        `This looks like an existing lead: "${dup.shopName}" (assigned to ${dup.employeeProfile.fullName}).`,
        HttpStatus.CONFLICT,
        { leadId: a.team || undefined ? dup.id : undefined },
      );
    const row = await this.prisma.$transaction(async (tx) => {
      const lead = await tx.employeeCrmLead.create({
        data: {
          ...(leadData(input) as Prisma.EmployeeCrmLeadUncheckedCreateInput),
          shopName: input.shopName.trim(),
          employeeProfileId: owner,
          status: owner === a.employeeProfileId ? 'NEW' : 'ASSIGNED',
          assignedAt: new Date(),
          assignedByUserId: a.userId,
          createdByUserId: a.userId,
        },
        include: leadInclude,
      });
      await logLeadActivity(
        tx,
        lead.id,
        a.userId,
        'CREATED',
        `Lead created${owner !== a.employeeProfileId ? ` and assigned to ${lead.employeeProfile.fullName}` : ''}`,
      );
      if (owner !== a.employeeProfileId)
        await this.notifyAssigned(tx, owner, [lead]);
      return lead;
    });
    return toLeadDto(row);
  }

  async update(
    a: CrmActor,
    id: string,
    input: CrmLeadUpdateInput,
  ): Promise<CrmLeadDto> {
    this.access.assertWrite(a);
    const lead = await this.access.lead(a, id);
    if (
      input.status &&
      input.status !== lead.status &&
      !CRM_MANUAL_LEAD_STATUSES.includes(input.status) &&
      a.kind !== 'ADMIN'
    )
      throw new AppException(
        'CRM_STATUS_NOT_MANUAL',
        `"${CRM_LEAD_STATUS_META[input.status].label}" is set by the onboarding workflow, not by hand.`,
        HttpStatus.BAD_REQUEST,
      );
    if (
      input.status &&
      input.status !== lead.status &&
      CRM_WORKFLOW_LOCKED_STATUSES.includes(lead.status) &&
      !a.manage
    )
      throw new AppException(
        'CRM_STATUS_LOCKED',
        'This salon has been submitted for approval, so only a manager or admin can change its status.',
        HttpStatus.CONFLICT,
      );
    if (input.assignToEmployeeId)
      throw new AppException(
        'CRM_USE_ASSIGN',
        'Use the assign action to reassign a lead.',
        HttpStatus.BAD_REQUEST,
      );
    if (input.phone || input.shopName || input.city) {
      const dup = await this.duplicateOf(
        {
          shopName: input.shopName ?? lead.shopName,
          phone: input.phone ?? lead.phone,
          city: input.city ?? lead.city,
        },
        id,
      );
      if (dup)
        throw new AppException(
          'CRM_DUPLICATE_LEAD',
          `Another lead already has these details: "${dup.shopName}".`,
          HttpStatus.CONFLICT,
        );
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.employeeCrmLead.update({
        where: { id },
        data: {
          ...leadData(input),
          ...(input.status ? { status: input.status } : {}),
          ...(input.lostReason !== undefined
            ? { lostReason: input.lostReason?.trim() || null }
            : {}),
        },
        include: leadInclude,
      });
      if (input.status && input.status !== lead.status)
        await logLeadActivity(
          tx,
          id,
          a.userId,
          'STATUS_CHANGED',
          `Status: ${CRM_LEAD_STATUS_META[lead.status].label} → ${CRM_LEAD_STATUS_META[input.status].label}`,
          { from: lead.status, to: input.status },
        );
      const changed = Object.keys(input).filter((k) => k !== 'status');
      if (changed.length)
        await logLeadActivity(
          tx,
          id,
          a.userId,
          'UPDATED',
          `Updated ${changed.join(', ')}`,
        );
      return updated;
    });
    return toLeadDto(row);
  }

  private async notifyAssigned(
    tx: Prisma.TransactionClient,
    employeeProfileId: string,
    leads: Array<{ id: string; shopName: string }>,
  ) {
    const emp = await tx.employeeProfile.findUnique({
      where: { id: employeeProfileId },
      select: { userId: true },
    });
    if (!emp) return;
    const title =
      leads.length === 1
        ? `New lead assigned: ${leads[0].shopName}`
        : `${leads.length} new leads assigned to you`;
    await notifyCrm(
      tx,
      emp.userId,
      'crm.lead_assigned',
      title,
      null,
      leads.length === 1
        ? `/employee/leads?lead=${leads[0].id}`
        : '/employee/leads',
      `assign:${leads
        .map((l) => l.id)
        .join(',')
        .slice(0, 300)}`,
    );
  }

  /**
   * Reassign (managers/admins). Visits and follow-ups keep their original author; leads with field
   * voice notes are not moved because those notes are keyed to the lead's owner and would change author.
   */
  async assign(
    a: CrmActor,
    ids: string[],
    employeeId: string,
    note?: string | null,
  ): Promise<{
    assigned: number;
    skipped: Array<{ id: string; reason: string }>;
  }> {
    this.access.assertManage(a);
    const target = await this.prisma.employeeProfile.findUnique({
      where: { id: employeeId },
      select: { id: true, fullName: true },
    });
    if (!target) throw notFound('Employee');
    const leads = await this.prisma.employeeCrmLead.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        shopName: true,
        employeeProfileId: true,
        status: true,
        _count: { select: { voiceVisitLogs: true } },
        employeeProfile: { select: { fullName: true } },
      },
    });
    const skipped: Array<{ id: string; reason: string }> = ids
      .filter((id) => !leads.some((l) => l.id === id))
      .map((id) => ({ id, reason: 'Lead not found' }));
    const movable = leads.filter((l) => {
      if (l.employeeProfileId === employeeId) {
        skipped.push({ id: l.id, reason: 'Already assigned to this employee' });
        return false;
      }
      if (l._count.voiceVisitLogs > 0) {
        skipped.push({
          id: l.id,
          reason: `Has field voice notes by ${l.employeeProfile.fullName}; reassigning would change their author`,
        });
        return false;
      }
      return true;
    });
    if (movable.length)
      await this.prisma.$transaction(async (tx) => {
        for (const l of movable) {
          await tx.employeeCrmLead.update({
            where: { id: l.id },
            data: {
              employeeProfileId: employeeId,
              assignedAt: new Date(),
              assignedByUserId: a.userId,
              ...(l.status === 'NEW' ? { status: 'ASSIGNED' } : {}),
            },
          });
          await logLeadActivity(
            tx,
            l.id,
            a.userId,
            'ASSIGNED',
            `Reassigned from ${l.employeeProfile.fullName} to ${target.fullName}${note ? ` — ${note}` : ''}`,
            { from: l.employeeProfileId, to: employeeId },
          );
        }
        await this.notifyAssigned(tx, employeeId, movable);
        await tx.auditLog.create({
          data: {
            actorUserId: a.userId,
            action: 'CRM_LEADS_ASSIGNED',
            entityType: 'EmployeeCrmLead',
            entityId: movable[0].id,
            metadata: { count: movable.length, to: employeeId },
          },
        });
      });
    return { assigned: movable.length, skipped };
  }

  async timeline(a: CrmActor, id: string): Promise<CrmActivityDto[]> {
    await this.access.lead(a, id);
    const rows = await this.prisma.crmLeadActivity.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        actor: {
          select: {
            email: true,
            employeeProfile: { select: { fullName: true } },
          },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      summary: r.summary,
      actor: r.actor?.employeeProfile?.fullName ?? r.actor?.email ?? null,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addNote(
    a: CrmActor,
    id: string,
    body: string,
  ): Promise<CrmActivityDto[]> {
    this.access.assertWrite(a);
    await this.access.lead(a, id);
    await logLeadActivity(this.prisma, id, a.userId, 'NOTE', body.trim());
    return this.timeline(a, id);
  }

  async employees(a: CrmActor): Promise<CrmEmployeeRefDto[]> {
    if (!a.team) {
      const me = await this.prisma.employeeProfile.findUnique({
        where: { id: a.employeeProfileId! },
        select: employeeSelect,
      });
      return me ? [toEmployeeRef(me)] : [];
    }
    const rows = await this.prisma.employeeProfile.findMany({
      where: { user: { status: 'ACTIVE' } },
      select: employeeSelect,
      orderBy: { fullName: 'asc' },
      take: 500,
    });
    return rows.map(toEmployeeRef);
  }

  // ---------- Import ----------

  async importPreview(
    a: CrmActor,
    file: Express.Multer.File,
    mappingJson: string | undefined,
    defaultEmployeeId: string | undefined,
  ): Promise<CrmImportPreviewDto> {
    this.access.assertManage(a);
    const workbook = readSpreadsheet(
      file.buffer,
      file.originalname || 'leads.csv',
    );
    const sheet =
      workbook.sheets.find((s) =>
        s.rows.some((r) =>
          r.some((c) => guessLeadField(c.text) === 'shopName'),
        ),
      ) ?? workbook.sheets[0];
    const headerIndex = Math.max(
      0,
      sheet.rows.findIndex((r) =>
        r.some((c) => guessLeadField(c.text) === 'shopName'),
      ),
    );
    const headers = (sheet.rows[headerIndex] ?? []).map((c) => c.text.trim());
    let mapping: Array<string | null> = headers.map(guessLeadField);
    if (mappingJson) {
      try {
        const parsed = JSON.parse(mappingJson) as unknown;
        if (!Array.isArray(parsed) || parsed.length !== headers.length)
          throw new Error('length');
        mapping = parsed.map((f) =>
          typeof f === 'string' && f in LEAD_IMPORT_FIELDS ? f : null,
        );
      } catch {
        throw new AppException(
          'CRM_IMPORT_MAPPING',
          'The column mapping does not match the file.',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    // A field may only come from one column.
    const seen = new Set<string>();
    mapping = mapping.map((f) => (f && !seen.has(f) ? (seen.add(f), f) : null));
    if (!mapping.includes('shopName'))
      throw new AppException(
        'CRM_IMPORT_NO_NAME',
        'No salon name column was found. Map a column to "Salon name".',
        HttpStatus.BAD_REQUEST,
      );
    if (
      defaultEmployeeId &&
      !(await this.prisma.employeeProfile.findUnique({
        where: { id: defaultEmployeeId },
        select: { id: true },
      }))
    )
      throw notFound('Employee');

    const employees = await this.prisma.employeeProfile.findMany({
      select: { id: true, employeeCode: true, fullName: true },
    });
    const byCode = new Map(
      employees.map((e) => [e.employeeCode.toLowerCase(), e.id]),
    );
    const byName = new Map<string, string[]>();
    for (const e of employees)
      byName.set(nameKey(e.fullName), [
        ...(byName.get(nameKey(e.fullName)) ?? []),
        e.id,
      ]);

    const dataRows = sheet.rows
      .slice(headerIndex + 1)
      .filter((r) => r.some((c) => c.text.trim()));
    if (dataRows.length > 5000)
      throw new AppException(
        'CRM_IMPORT_TOO_MANY',
        'At most 5,000 leads per file.',
        HttpStatus.BAD_REQUEST,
      );
    const rows: ImportRow[] = dataRows.map((cells, i) => {
      const issues: string[] = [];
      const data: ImportRow['data'] = {};
      let assignTo: string | null = null;
      mapping.forEach((field, col) => {
        if (!field) return;
        const v = (cells[col]?.text ?? '').replace(/\u00a0/g, ' ').trim();
        if (!v) return;
        if (field === 'assignTo') assignTo = v;
        else data[field] = v;
      });
      if (!data.shopName) issues.push('Salon name is missing.');
      for (const f of ['phone', 'alternatePhone', 'whatsappPhone'] as const) {
        if (data[f] && !/^\+?[0-9][0-9\s-]{6,18}$/.test(String(data[f])))
          issues.push(
            `${LEAD_IMPORT_FIELDS[f]} "${data[f]}" is not a valid phone number.`,
          );
      }
      if (data.email && !/^\S+@\S+\.\S+$/.test(String(data.email)))
        issues.push(`Email "${data.email}" is not valid.`);
      if (data.postalCode && !/^\d{6}$/.test(String(data.postalCode)))
        issues.push('PIN code must have 6 digits.');
      for (const f of ['latitude', 'longitude', 'chairCount'] as const) {
        if (data[f] === undefined) continue;
        const n = Number(data[f]);
        if (!Number.isFinite(n))
          issues.push(`${LEAD_IMPORT_FIELDS[f]} must be a number.`);
        else data[f] = f === 'chairCount' ? Math.round(n) : n;
      }
      if (data.source)
        data.source =
          SOURCE_ALIASES[String(data.source).toLowerCase()] ?? 'OTHER';
      if (data.priority) {
        const p = String(data.priority).toUpperCase();
        data.priority = ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(p)
          ? p
          : 'NORMAL';
      }
      let assigneeId: string | null = defaultEmployeeId ?? null;
      if (assignTo) {
        const key: string = assignTo;
        const viaCode = byCode.get(key.toLowerCase());
        const viaName = byName.get(nameKey(key));
        if (viaCode) assigneeId = viaCode;
        else if (viaName?.length === 1) assigneeId = viaName[0];
        else
          issues.push(
            viaName && viaName.length > 1
              ? `Several employees are called "${key}"; use the employee code.`
              : `No employee "${key}".`,
          );
      }
      if (!assigneeId)
        issues.push(
          'No employee to assign: add an "Assigned employee" column or choose a default employee.',
        );
      return {
        rowNumber: headerIndex + i + 2,
        data: { ...data, assigneeId },
        assignTo,
        issues,
        status: issues.length ? 'ERROR' : 'NEW',
      };
    });

    // Duplicates: inside the file, and against existing leads (same phone, or same name + city).
    const fileKeys = new Map<string, number>();
    const phones = rows
      .map((r) => phoneKey(r.data.phone as string))
      .filter((p): p is string => !!p && p.length === 10);
    const existing = phones.length
      ? await this.prisma.employeeCrmLead.findMany({
          where: { OR: phones.map((p) => ({ phone: { endsWith: p } })) },
          select: { phone: true, shopName: true },
        })
      : [];
    const existingPhones = new Set(existing.map((e) => phoneKey(e.phone)));
    const namesCities = rows
      .filter((r) => r.data.shopName && r.data.city)
      .map((r) => ({
        shopName: {
          equals: String(r.data.shopName),
          mode: 'insensitive' as const,
        },
        city: { equals: String(r.data.city), mode: 'insensitive' as const },
      }));
    const existingNames = namesCities.length
      ? new Set(
          (
            await this.prisma.employeeCrmLead.findMany({
              where: { OR: namesCities.slice(0, 2000) },
              select: { shopName: true, city: true },
            })
          ).map((e) => `${nameKey(e.shopName)}|${nameKey(e.city ?? '')}`),
        )
      : new Set<string>();
    for (const r of rows) {
      if (r.status === 'ERROR') continue;
      const pk = phoneKey(r.data.phone as string);
      const nk = r.data.city
        ? `${nameKey(String(r.data.shopName))}|${nameKey(String(r.data.city))}`
        : null;
      const key = pk && pk.length === 10 ? `p:${pk}` : nk ? `n:${nk}` : null;
      if (key && fileKeys.has(key)) {
        r.status = 'DUPLICATE';
        r.issues.push(`Same salon as row ${fileKeys.get(key)} in this file.`);
      } else if (
        (pk && existingPhones.has(pk)) ||
        (nk && existingNames.has(nk))
      ) {
        r.status = 'DUPLICATE';
        r.issues.push(
          'Already in the CRM (same phone, or same name in the same city).',
        );
      }
      if (key && !fileKeys.has(key)) fileKeys.set(key, r.rowNumber);
    }
    const job = await this.prisma.crmLeadImportJob.create({
      data: {
        uploadedByUserId: a.userId,
        fileName: (file.originalname || 'leads').slice(0, 255),
        fileSha256: createHash('sha256').update(file.buffer).digest('hex'),
        columnMapping: mapping,
        parsedRows: rows as unknown as Prisma.InputJsonValue,
        defaultEmployeeProfileId: defaultEmployeeId ?? null,
        totalRows: rows.length,
        duplicateCount: rows.filter((r) => r.status === 'DUPLICATE').length,
        errorCount: rows.filter((r) => r.status === 'ERROR').length,
      },
    });
    const empName = new Map(employees.map((e) => [e.id, e.fullName]));
    return {
      jobId: job.id,
      headers,
      mapping,
      fieldLabels: LEAD_IMPORT_FIELDS,
      totalRows: rows.length,
      valid: rows.filter((r) => r.status === 'NEW').length,
      duplicates: job.duplicateCount,
      errors: job.errorCount,
      rows: rows.slice(0, 300).map((r) => ({
        rowNumber: r.rowNumber,
        shopName: (r.data.shopName as string) ?? null,
        phone: (r.data.phone as string) ?? null,
        city: (r.data.city as string) ?? null,
        assignTo: r.data.assigneeId
          ? (empName.get(String(r.data.assigneeId)) ?? null)
          : null,
        status: r.status,
        issues: r.issues,
      })),
    };
  }

  /** Creates the previewed NEW rows (duplicates and errors are left out). A job imports once. */
  async importCommit(
    a: CrmActor,
    jobId: string,
  ): Promise<{ created: number; skipped: number }> {
    this.access.assertManage(a);
    const claimed = await this.prisma.crmLeadImportJob.updateMany({
      where: { id: jobId, status: 'PREVIEWED', uploadedByUserId: a.userId },
      data: { status: 'PROCESSING' },
    });
    if (!claimed.count)
      throw new AppException(
        'CRM_IMPORT_DONE',
        'This import was already processed (or is not yours).',
        HttpStatus.CONFLICT,
      );
    const job = await this.prisma.crmLeadImportJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    const rows = (job.parsedRows ?? []) as unknown as ImportRow[];
    const toCreate = rows.filter((r) => r.status === 'NEW');
    const byEmployee = new Map<
      string,
      Array<{ id: string; shopName: string }>
    >();
    let created = 0;
    for (let i = 0; i < toCreate.length; i += 200) {
      const chunk = toCreate.slice(i, i + 200);
      await this.prisma.$transaction(async (tx) => {
        for (const r of chunk) {
          const { assigneeId, ...data } = r.data;
          const lead = await tx.employeeCrmLead.create({
            data: {
              ...(data as unknown as Prisma.EmployeeCrmLeadUncheckedCreateInput),
              shopName: String(data.shopName).slice(0, 160),
              source: (data.source as CrmLeadSource) ?? 'OTHER',
              employeeProfileId: String(assigneeId),
              status: 'ASSIGNED',
              assignedAt: new Date(),
              assignedByUserId: a.userId,
              createdByUserId: a.userId,
              importJobId: job.id,
            },
            select: { id: true, shopName: true },
          });
          await logLeadActivity(
            tx,
            lead.id,
            a.userId,
            'IMPORTED',
            `Imported from ${job.fileName} (row ${r.rowNumber})`,
            { importJobId: job.id },
          );
          byEmployee.set(String(assigneeId), [
            ...(byEmployee.get(String(assigneeId)) ?? []),
            lead,
          ]);
          created += 1;
        }
      });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [emp, leads] of byEmployee)
        await this.notifyAssigned(tx, emp, leads);
      await tx.crmLeadImportJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          createdCount: created,
          completedAt: new Date(),
          parsedRows: Prisma.DbNull,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: a.userId,
          action: 'CRM_LEADS_IMPORTED',
          entityType: 'CrmLeadImportJob',
          entityId: job.id,
          metadata: { created, rows: rows.length },
        },
      });
    });
    return { created, skipped: rows.length - created };
  }

  async imports(a: CrmActor) {
    this.access.assertManage(a);
    const rows = await this.prisma.crmLeadImportJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        fileName: true,
        status: true,
        totalRows: true,
        createdCount: true,
        duplicateCount: true,
        errorCount: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
  }

  templateCsv(): string {
    const head = [
      'Salon Name',
      'Business Type',
      'Owner Name',
      'Manager Name',
      'Phone',
      'Alternate Phone',
      'WhatsApp',
      'Email',
      'Address',
      'Area',
      'City',
      'State',
      'PIN Code',
      'Google Maps Link',
      'Latitude',
      'Longitude',
      'Lead Source',
      'Salon Size',
      'Chairs',
      'Existing Software',
      'Territory',
      'Priority',
      'Assigned Employee',
      'Notes',
    ];
    const ex = [
      'Urban Edge Salon',
      'Unisex salon',
      'Amit Verma',
      '',
      '9876543210',
      '',
      '9876543210',
      '',
      'Shop 12, Market Road',
      'Sector 62',
      'Noida',
      'Uttar Pradesh',
      '201301',
      '',
      '',
      '',
      'Field discovery',
      'Medium',
      '6',
      '',
      'Noida West',
      'High',
      'FQ-EMP-101',
      'Prefers afternoon calls',
    ];
    return `${String.fromCharCode(0xfeff)}${head.join(',')}\r\n${ex.join(',')}\r\n`;
  }
}

export { forbidden };
