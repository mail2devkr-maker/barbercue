import {
  DEMO_WORKSPACE_BANNER,
  type DemoWorkspaceDatasetDto,
} from '@barbercue/shared';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONEY_INR_MINOR = [25000, 12000, 34000, 60000, 15000, 45000, 8000, 22000];
const SERVICES = [
  ['Classic Haircut', 'Hair', 30],
  ['Beard Trim', 'Beard', 20],
  ['Haircut + Beard', 'Combo', 45],
  ['Hair Spa', 'Hair', 50],
  ['Head Massage', 'Wellness', 20],
  ['Facial', 'Skin', 45],
  ['Hair Colour', 'Hair', 90],
  ['Kids Cut', 'Hair', 25],
] as const;
const STAFF = [
  { name: 'Sample Barber A', role: 'BARBER' as const },
  { name: 'Sample Barber B', role: 'BARBER' as const },
  { name: 'Sample Barber C', role: 'BARBER' as const },
  { name: 'Sample Manager', role: 'MANAGER' as const },
];
const CUSTOMER_NAMES = [
  'Sample Customer 01',
  'Sample Customer 02',
  'Sample Customer 03',
  'Sample Customer 04',
  'Sample Customer 05',
  'Sample Customer 06',
  'Sample Customer 07',
  'Sample Customer 08',
  'Sample Customer 09',
  'Sample Customer 10',
  'Sample Customer 11',
  'Sample Customer 12',
];
const STATUS_SEQUENCE = [
  'COMPLETED',
  'COMPLETED',
  'COMPLETED',
  'COMPLETED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
  'COMPLETED',
  'WAITING',
  'COMPLETED',
  'COMPLETED',
  'IN_SERVICE',
  'COMPLETED',
  'CANCELLED',
  'COMPLETED',
  'COMPLETED',
  'NO_SHOW',
  'COMPLETED',
  'WAITING',
  'COMPLETED',
  'CANCELLED',
  'COMPLETED',
  'IN_SERVICE',
  'COMPLETED',
  'COMPLETED',
  'NO_SHOW',
  'COMPLETED',
  'WAITING',
  'COMPLETED',
  'CANCELLED',
  'COMPLETED',
  'COMPLETED',
  'WAITING',
  'COMPLETED',
  'COMPLETED',
  'CANCELLED',
] as const;

const iso = (date: Date) => date.toISOString();
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const mondayKey = (date: Date) => {
  const day = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return dateKey(day);
};

/**
 * Creates bounded, deterministic, fictional records. The result is a projection document only;
 * the caller persists it in owner_demo_workspaces, never in any live operational/finance model.
 */
export function createDemoWorkspaceDataset(input: {
  workspaceId: string;
  generatedAt: Date;
  timezone: string;
  currency: string;
}): DemoWorkspaceDatasetDto {
  const { workspaceId, generatedAt, timezone } = input;
  const prefix = `demo:${workspaceId}`;
  const serviceIds = SERVICES.map(
    (_, index) => `${prefix}:service:${index + 1}`,
  );
  const staffIds = STAFF.map((_, index) => `${prefix}:staff:${index + 1}`);
  const customerIds = CUSTOMER_NAMES.map(
    (_, index) => `${prefix}:customer:${index + 1}`,
  );
  const services = SERVICES.map(([name, category, durationMinutes], index) => ({
    id: serviceIds[index],
    name,
    category,
    durationMinutes,
    listPriceMinor: MONEY_INR_MINOR[index],
  }));
  const staff = STAFF.map((member, index) => ({
    id: staffIds[index],
    name: member.name,
    role: member.role,
    serviceIds: serviceIds.filter(
      (_, serviceIndex) => (serviceIndex + index) % 3 !== 2,
    ),
  }));
  const customers = CUSTOMER_NAMES.map((name, index) => {
    const firstVisitAt = new Date(
      generatedAt.getTime() - (48 + index) * DAY_MS,
    );
    const lastVisitAt = new Date(generatedAt.getTime() - (index % 17) * DAY_MS);
    return {
      id: customerIds[index],
      name,
      email: `sample-${String(index + 1).padStart(2, '0')}@example.invalid`,
      phone: null,
      firstVisitAt: iso(firstVisitAt),
      lastVisitAt: iso(lastVisitAt),
      visitCount: 1 + (index % 5),
    };
  });

  const visits = STATUS_SEQUENCE.map((status, index) => {
    const serviceIndex = (index * 3 + 1) % services.length;
    const staffIndex = index % staff.length;
    const customerIndex = index % 6 === 5 ? null : index % customers.length;
    const joined = new Date(
      generatedAt.getTime() -
        (index % 42) * DAY_MS -
        (index % 9) * 60 * 60 * 1000,
    );
    const completed = status === 'COMPLETED';
    const value = completed ? services[serviceIndex].listPriceMinor : 0;
    return {
      id: `${prefix}:visit:${String(index + 1).padStart(2, '0')}`,
      source: 'LIVE_QUEUE' as const,
      status,
      customerId: customerIndex === null ? null : customerIds[customerIndex],
      customerName:
        customerIndex === null
          ? `Sample Guest ${String(index + 1).padStart(2, '0')}`
          : CUSTOMER_NAMES[customerIndex],
      serviceId: serviceIds[serviceIndex],
      staffId:
        status === 'WAITING' || status === 'CANCELLED' || status === 'NO_SHOW'
          ? null
          : staffIds[staffIndex],
      chairId:
        status === 'IN_SERVICE' ? `${prefix}:chair:${(index % 4) + 1}` : null,
      joinedAt: iso(joined),
      completedAt: completed
        ? iso(
            new Date(
              joined.getTime() +
                services[serviceIndex].durationMinutes * 60_000,
            ),
          )
        : null,
      estimatedValueMinor: value,
      simulatedCollectionMinor: completed
        ? Math.floor(value * [1, 0.5, 0.8, 0][index % 4])
        : 0,
      paymentProjection: 'SIMULATED_ONLY' as const,
    };
  });

  const bookings = Array.from({ length: 15 }, (_, index) => {
    const status =
      index < 7
        ? ('COMPLETED' as const)
        : index < 10
          ? ('CANCELLED' as const)
          : ('CONFIRMED' as const);
    const slotStart =
      status === 'CONFIRMED'
        ? new Date(
            generatedAt.getTime() +
              (index - 9) * DAY_MS +
              (index + 9) * 60 * 60 * 1000,
          )
        : new Date(
            generatedAt.getTime() -
              ((index * 2) % 35) * DAY_MS +
              (index + 1) * 60 * 60 * 1000,
          );
    return {
      id: `${prefix}:booking:${String(index + 1).padStart(2, '0')}`,
      source:
        index % 2 === 0 ? ('FASTQUE_WEB' as const) : ('FASTQUE_APP' as const),
      status,
      customerId: customerIds[index % customerIds.length],
      serviceIds: [serviceIds[index % serviceIds.length]],
      slotStart: iso(slotStart),
      slotEnd: iso(
        new Date(
          slotStart.getTime() +
            services[index % services.length].durationMinutes * 60_000,
        ),
      ),
      linkedQueueVisitId: null,
    };
  });

  const completedVisits = visits.filter(
    (visit) => visit.status === 'COMPLETED',
  );
  const daily = Array.from({ length: 30 }, (_, offset) => {
    const date = new Date(generatedAt.getTime() - (29 - offset) * DAY_MS);
    const key = dateKey(date);
    const rows = completedVisits.filter(
      (visit) => dateKey(new Date(visit.joinedAt)) === key,
    );
    return {
      date: key,
      estimatedValueMinor: rows.reduce(
        (sum, visit) => sum + visit.estimatedValueMinor,
        0,
      ),
      collectionProjectionMinor: rows.reduce(
        (sum, visit) => sum + visit.simulatedCollectionMinor,
        0,
      ),
    };
  });
  const currentMonday = new Date(
    Date.UTC(
      generatedAt.getUTCFullYear(),
      generatedAt.getUTCMonth(),
      generatedAt.getUTCDate(),
    ),
  );
  currentMonday.setUTCDate(
    currentMonday.getUTCDate() - ((currentMonday.getUTCDay() + 6) % 7),
  );
  const weekly = Array.from({ length: 8 }, (_, offset) => {
    const weekStart = new Date(
      currentMonday.getTime() + (offset - 7) * 7 * DAY_MS,
    );
    const key = mondayKey(weekStart);
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
    const rows = completedVisits.filter((visit) => {
      const joined = new Date(visit.joinedAt).getTime();
      return joined >= weekStart.getTime() && joined < weekEnd.getTime();
    });
    return {
      weekStarting: key,
      estimatedValueMinor: rows.reduce(
        (sum, visit) => sum + visit.estimatedValueMinor,
        0,
      ),
      collectionProjectionMinor: rows.reduce(
        (sum, visit) => sum + visit.simulatedCollectionMinor,
        0,
      ),
    };
  });
  const monthly = Array.from({ length: 6 }, (_, offset) => {
    const monthDate = new Date(
      Date.UTC(
        generatedAt.getUTCFullYear(),
        generatedAt.getUTCMonth() - (5 - offset),
        1,
      ),
    );
    const month = monthDate.toISOString().slice(0, 7);
    const rows = completedVisits.filter(
      (visit) => new Date(visit.joinedAt).toISOString().slice(0, 7) === month,
    );
    return {
      month,
      estimatedValueMinor: rows.reduce(
        (sum, visit) => sum + visit.estimatedValueMinor,
        0,
      ),
      collectionProjectionMinor: rows.reduce(
        (sum, visit) => sum + visit.simulatedCollectionMinor,
        0,
      ),
    };
  });
  const byService = services.map((service) => {
    const rows = completedVisits.filter(
      (visit) => visit.serviceId === service.id,
    );
    return {
      serviceId: service.id,
      completedVisits: rows.length,
      estimatedValueMinor: rows.reduce(
        (sum, visit) => sum + visit.estimatedValueMinor,
        0,
      ),
      collectionProjectionMinor: rows.reduce(
        (sum, visit) => sum + visit.simulatedCollectionMinor,
        0,
      ),
    };
  });
  const byStaff = staff.map((member) => {
    const rows = completedVisits.filter((visit) => visit.staffId === member.id);
    return {
      staffId: member.id,
      completedVisits: rows.length,
      estimatedValueMinor: rows.reduce(
        (sum, visit) => sum + visit.estimatedValueMinor,
        0,
      ),
      collectionProjectionMinor: rows.reduce(
        (sum, visit) => sum + visit.simulatedCollectionMinor,
        0,
      ),
    };
  });
  const byCustomer = customers.map((customer) => {
    const rows = completedVisits.filter(
      (visit) => visit.customerId === customer.id,
    );
    return {
      customerId: customer.id,
      completedVisits: rows.length,
      estimatedValueMinor: rows.reduce(
        (sum, visit) => sum + visit.estimatedValueMinor,
        0,
      ),
      collectionProjectionMinor: rows.reduce(
        (sum, visit) => sum + visit.simulatedCollectionMinor,
        0,
      ),
    };
  });
  const invoices: DemoWorkspaceDatasetDto['invoices'] = completedVisits
    .slice(0, 9)
    .map((visit, index) => ({
      id: `${prefix}:invoice:${String(index + 1).padStart(2, '0')}`,
      status:
        index % 3 === 0
          ? 'AWAITING_PAYMENT'
          : index % 3 === 1
            ? 'PARTIALLY_PAID'
            : 'PAID',
      totalMinor: visit.estimatedValueMinor,
      simulatedCollectionProjectionMinor: visit.simulatedCollectionMinor,
      isRecordedPayment: false as const,
    }));

  return {
    schemaVersion: 1,
    banner: DEMO_WORKSPACE_BANNER,
    generatedAt: iso(generatedAt),
    timezone: timezone || 'UTC',
    currency: input.currency || 'INR',
    demoShop: {
      id: `${prefix}:shop`,
      name: 'FastQue Sample Studio',
      synthetic: true,
    },
    counts: {
      customers: customers.length,
      staff: staff.length,
      chairs: 4,
      services: services.length,
      visits: visits.length,
      bookings: bookings.length,
      invoices: invoices.length,
      reviews: 5,
    },
    customers,
    staff,
    chairs: Array.from({ length: 4 }, (_, index) => ({
      id: `${prefix}:chair:${index + 1}`,
      label: `Sample Chair ${index + 1}`,
      status: index < 2 ? ('OCCUPIED' as const) : ('AVAILABLE' as const),
    })),
    services,
    visits,
    bookings,
    invoices,
    reviews: [
      {
        id: `${prefix}:review:1`,
        customerName: CUSTOMER_NAMES[0],
        rating: 5 as const,
        comment: 'Sample feedback — not a real customer review.',
      },
      {
        id: `${prefix}:review:2`,
        customerName: CUSTOMER_NAMES[3],
        rating: 4 as const,
        comment: 'Synthetic sample review for dashboard preview.',
      },
      {
        id: `${prefix}:review:3`,
        customerName: CUSTOMER_NAMES[5],
        rating: 5 as const,
        comment: 'Fictional demo content only.',
      },
      {
        id: `${prefix}:review:4`,
        customerName: CUSTOMER_NAMES[8],
        rating: 3 as const,
        comment: 'Not submitted to the public rating system.',
      },
      {
        id: `${prefix}:review:5`,
        customerName: CUSTOMER_NAMES[11],
        rating: 4 as const,
        comment: 'Sample data — no public review exists.',
      },
    ],
    revenue: {
      disclaimer:
        'All amounts below are synthetic projections, not recorded revenue or payments.',
      daily,
      weekly,
      monthly,
      byService,
      byStaff,
      byCustomer,
    },
  };
}
