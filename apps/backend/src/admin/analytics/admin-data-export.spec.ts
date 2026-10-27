import { createHmac } from 'crypto';
import { maskCustomerId } from './admin-customer-analytics.service';
import {
  scheduledMinutes,
  workingMinutes,
} from './admin-staff-analytics.service';
import { AdminDataExportService } from './admin-data-export.service';

const QUERY = { from: '2026-10-01', to: '2026-10-27' };
const USER_ID = '7f1d3c9a-0000-4000-8000-000000000001';

function customerOverview() {
  return {
    from: QUERY.from,
    to: QUERY.to,
    customers: [
      {
        maskedId: maskCustomerId(USER_ID),
        firstVisitAt: '2026-10-02T05:00:00.000Z',
        lastVisitAt: '2026-10-20T05:00:00.000Z',
        completedVisits: 3,
        cancelled: 1,
        noShow: 0,
        serviceValuePaise: 123450,
        preferredCategory: '=HYPERLINK("http://x")',
      },
    ],
  };
}

function makeService(
  contacts: Map<
    string,
    { phone: string | null; email: string | null; createdAt: Date }
  > | null,
  suppressedHashes: string[] = [],
) {
  const prisma = {
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    contactSuppression: {
      findMany: jest.fn(
        ({ where }: { where: { phoneHash: { in: string[] } } }) =>
          Promise.resolve(
            where.phoneHash.in
              .filter((h) => suppressedHashes.includes(h))
              .map((phoneHash) => ({ phoneHash })),
          ),
      ),
    },
  };
  const customers = {
    exportRows: jest.fn((_q: unknown, withContact: boolean) =>
      Promise.resolve({
        overview: customerOverview(),
        contacts: withContact ? contacts : null,
      }),
    ),
  };
  const staff = {
    exportRows: jest.fn((_q: unknown, withContact: boolean) =>
      Promise.resolve({
        overview: {
          staff: [
            {
              id: 'staff-1',
              displayName: 'Marcus',
              salonName: 'Demo Salon',
              salonPublicId: 'BC-1',
              city: 'Pune',
              role: 'BARBER',
              status: 'ACTIVE',
              servingNow: false,
              completedServices: 4,
              distinctServices: 2,
              serviceMinutes: 120,
              averageServiceMinutes: 30,
              serviceValuePaise: 80000,
              scheduledMinutes: 600,
              utilizationPercent: 20,
            },
          ],
        },
        contacts: withContact
          ? new Map([
              [
                'staff-1',
                { phone: '+919000000001', email: 'marcus@example.test' },
              ],
            ])
          : null,
      }),
    ),
  };
  const service = new AdminDataExportService(
    prisma as never,
    customers as never,
    staff as never,
  );
  return { service, prisma, customers, staff };
}

const lines = (body: Buffer) =>
  body.toString('utf8').replace(/^﻿/, '').trim().split('\r\n');

describe('privacy helpers', () => {
  it('masks a customer ID deterministically without exposing the account ID', () => {
    const masked = maskCustomerId(USER_ID);
    expect(masked).toMatch(/^C-[0-9A-F]{10}$/);
    expect(masked).toBe(maskCustomerId(USER_ID));
    expect(masked).not.toContain(USER_ID.slice(0, 8).toUpperCase());
    expect(maskCustomerId('another-user')).not.toBe(masked);
  });

  it('counts scheduled staff minutes only up to today, including overnight shifts', () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      openTime: '10:00',
      closeTime: '20:00',
      isClosed: dayOfWeek === 0,
    }));
    expect(workingMinutes(week[1])).toBe(600);
    expect(
      workingMinutes({
        dayOfWeek: 1,
        openTime: '18:00',
        closeTime: '02:00',
        isClosed: false,
      }),
    ).toBe(480);
    // 26-28 Oct: Mon, Tue, Wed — but "today" is Tue 27th, so Wednesday has not happened yet.
    expect(
      scheduledMinutes(week, '2026-10-26', '2026-10-28', '2026-10-27'),
    ).toBe(1200);
    // A Sunday off counts as zero, and no hours at all means "not measurable".
    expect(
      scheduledMinutes(week, '2026-10-25', '2026-10-25', '2026-10-27'),
    ).toBe(0);
    expect(
      scheduledMinutes([], '2026-10-25', '2026-10-27', '2026-10-27'),
    ).toBeNull();
  });
});

describe('AdminDataExportService', () => {
  const ORIGINAL_KEY = process.env.CONTACT_LEDGER_HASH_KEY;
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.CONTACT_LEDGER_HASH_KEY;
    else process.env.CONTACT_LEDGER_HASH_KEY = ORIGINAL_KEY;
  });

  it('the customer report has no contact columns, neutralises formulas and is audited', async () => {
    const { service, prisma, customers } = makeService(null);
    const file = await service.export('admin-1', 'CUSTOMER_REPORT', QUERY);
    const [meta, header, row] = lines(file.body);

    expect(customers.exportRows).toHaveBeenCalledWith(QUERY, false);
    expect(meta).toContain('No contact details');
    expect(header).not.toMatch(/Phone|Email/);
    expect(row).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(row).toContain('"1234.50"');
    expect(file.filename).toBe(
      'fastque-customers-2026-10-01_to_2026-10-27.csv',
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'admin-1',
        action: 'ADMIN_DATA_EXPORT',
        entityType: 'AdminExport',
        metadata: expect.objectContaining({
          category: 'CUSTOMER_REPORT',
          fields: 'report',
          rows: 1,
          outcome: 'SUCCEEDED',
          from: QUERY.from,
          to: QUERY.to,
        }),
      }),
    });
  });

  it('the contact export adds phone/email but withholds suppressed numbers and records the check', async () => {
    process.env.CONTACT_LEDGER_HASH_KEY = 'test-key';
    const phone = '+919876543210';
    const hash = createHmac('sha256', 'test-key').update(phone).digest('hex');
    const contacts = new Map([
      [
        maskCustomerId(USER_ID),
        {
          phone,
          email: 'c@example.test',
          createdAt: new Date('2026-09-01T00:00:00Z'),
        },
      ],
    ]);
    const { service, prisma } = makeService(contacts, [hash]);

    const file = await service.export('admin-1', 'CUSTOMER_CONTACTS', QUERY);
    const [, header, row] = lines(file.body);
    expect(header).toContain('"Phone","Email","Account created (UTC)"');
    expect(row).toContain('"(suppressed)","c@example.test"');
    expect(row).not.toContain(phone);
    expect(prisma.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject(
      {
        category: 'CUSTOMER_CONTACTS',
        fields: 'report+contact',
        phoneSuppression: { checked: true, withheld: 1 },
      },
    );
  });

  it('fails closed and audits when suppression cannot be checked', async () => {
    delete process.env.CONTACT_LEDGER_HASH_KEY;
    const contacts = new Map([
      [
        maskCustomerId(USER_ID),
        { phone: '+919876543210', email: null, createdAt: new Date() },
      ],
    ]);
    const { service, prisma, customers } = makeService(contacts);

    await expect(
      service.export('admin-1', 'CUSTOMER_CONTACTS', QUERY),
    ).rejects.toThrow('Customer contact export unavailable');

    // No contact rows should even be queried while opt-out suppression is unavailable.
    expect(customers.exportRows).not.toHaveBeenCalled();
    expect(prisma.contactSuppression.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject({
      category: 'CUSTOMER_CONTACTS',
      outcome: 'FAILED',
    });
  });

  it('keeps staff performance and staff contact exports apart', async () => {
    const { service, prisma } = makeService(null);
    const performance = lines(
      (await service.export('hr-1', 'STAFF_PERFORMANCE', QUERY)).body,
    );
    expect(performance[1]).not.toMatch(/Phone|Email/);
    expect(performance[2]).not.toContain('marcus@example.test');

    const contact = lines(
      (await service.export('hr-1', 'STAFF_CONTACTS', QUERY)).body,
    );
    expect(contact[1]).toMatch(/"Phone","Email"$/);
    expect(contact[2]).toContain('"marcus@example.test"');
    expect(
      prisma.auditLog.create.mock.calls.map((c) => c[0].data.metadata.category),
    ).toEqual(['STAFF_PERFORMANCE', 'STAFF_CONTACTS']);
  });

  it('audits a failed export too, then rethrows', async () => {
    const { service, prisma, customers } = makeService(null);
    customers.exportRows.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.export('admin-1', 'CUSTOMER_REPORT', QUERY),
    ).rejects.toThrow('db down');
    expect(prisma.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject(
      { category: 'CUSTOMER_REPORT', outcome: 'FAILED' },
    );
  });
});
