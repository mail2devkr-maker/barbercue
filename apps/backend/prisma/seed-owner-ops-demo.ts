/**
 * LOCAL DEVELOPMENT ONLY - seeds a clearly-labelled demo shop with a realistic day of operations
 * (staff, services, bookings, a live queue, invoices, recorded payments, cancellations) so the Owner
 * Dashboard can be exercised and screenshotted. It refuses to run against any database that is not
 * on localhost, writes only rows it creates, and every name/phone/e-mail uses reserved test values.
 *
 *   DATABASE_URL=postgresql://...@127.0.0.1:.../db npx ts-node --compiler-options '{"module":"CommonJS"}' \
 *     prisma/seed-owner-ops-demo.ts <output-credentials-file>
 *
 * Every demo account uses the fixed local-only password DEMO_PASSWORD below; the e-mails are written
 * to the given file.
 */
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const url = process.env.DATABASE_URL ?? '';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  throw new Error('Refusing to seed demo data into a non-local database.');
}
const out = process.argv[2];
if (!out) throw new Error('Pass an output file for the generated credentials.');

const DEMO_PASSWORD = 'FastQue-Local-Demo-1';
const prisma = new PrismaClient();
const TZ = 'Asia/Kolkata';
const minutes = (n: number) => new Date(Date.now() + n * 60_000);
const daysAgo = (d: number, hour: number, min = 0) => {
  const base = new Date(Date.now() - d * 86_400_000);
  const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(base); // YYYY-MM-DD
  return new Date(`${istDate}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+05:30`);
};

async function main() {
  const tag = randomUUID().slice(0, 6);
  // A fixed, documented password: these are throwaway accounts on a local-only database (the script
  // refuses to run anywhere else), and a known value lets a developer sign in without a secrets file.
  const password = DEMO_PASSWORD;
  const hash = await bcrypt.hash(password, 10);
  const phone = (n: number) => `+9199${String(parseInt(tag, 16) % 1_000_000).padStart(6, '0')}${String(n).padStart(2, '0')}`;
  const city = await prisma.city.findFirstOrThrow({ where: { slug: 'jharsuguda' } });

  const owner = await prisma.user.create({
    data: { email: `owner.${tag}@fastque-demo.test`, passwordHash: hash, status: 'ACTIVE', emailVerifiedAt: new Date(), preferredLanguage: 'EN' },
  });
  const salon = await prisma.salon.create({
    data: {
      ownerUserId: owner.id,
      name: 'Studio 360 Barbers',
      slug: `studio-360-${tag}`,
      cityId: city.id,
      addressLine: '14 Station Road, Jharsuguda',
      lat: 21.855,
      lng: 84.006,
      status: 'ACTIVE',
      timezone: TZ,
      currency: 'INR',
      phone: '+919800012345',
      salonType: 'UNISEX',
      description: 'Demo shop for local development.',
    },
  });
  await prisma.userRole.create({ data: { userId: owner.id, role: 'SALON_OWNER', salonId: salon.id } });
  for (let day = 0; day < 7; day++) {
    await prisma.operatingHours.create({ data: { salonId: salon.id, dayOfWeek: day, openTime: '09:00', closeTime: '21:00', isClosed: false } });
  }
  await prisma.salonBillingProfile.create({
    data: { salonId: salon.id, legalName: 'Studio 360 Barbers', billingAddress: '14 Station Road, Jharsuguda, Odisha', contactPhone: '+919800012345', taxEnabled: false, invoicePrefix: 'S360' },
  });

  const svc = {
    cut: await prisma.service.create({ data: { salonId: salon.id, name: 'Classic Haircut', price: '250.00', durationMinutes: 30, category: 'Hair' } }),
    beard: await prisma.service.create({ data: { salonId: salon.id, name: 'Beard Trim', price: '120.00', durationMinutes: 20, category: 'Beard' } }),
    combo: await prisma.service.create({ data: { salonId: salon.id, name: 'Haircut + Beard', price: '340.00', durationMinutes: 45, category: 'Combo' } }),
    spa: await prisma.service.create({ data: { salonId: salon.id, name: 'Hair Spa', price: '600.00', durationMinutes: 50, category: 'Hair' } }),
    massage: await prisma.service.create({ data: { salonId: salon.id, name: 'Head Massage', price: '150.00', durationMinutes: 20, category: 'Wellness' } }),
  };
  const chairs = [] as { id: string; label: string }[];
  for (const label of ['Chair 1', 'Chair 2', 'Chair 3', 'Chair 4']) chairs.push(await prisma.chair.create({ data: { salonId: salon.id, label } }));

  const barbers: Record<string, { staffId: string; userId: string; email: string }> = {};
  for (const [key, name, services] of [
    ['arjun', 'Arjun Mehta', [svc.cut, svc.beard, svc.combo, svc.massage]],
    ['bilal', 'Bilal Khan', [svc.cut, svc.beard, svc.combo, svc.spa]],
    ['chitra', 'Chitra Nayak', [svc.cut, svc.spa, svc.massage]],
  ] as const) {
    const user = await prisma.user.create({
      data: { email: `${key}.${tag}@fastque-demo.test`, passwordHash: hash, status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
    await prisma.userRole.create({ data: { userId: user.id, role: 'SALON_STAFF', salonId: salon.id } });
    const staff = await prisma.salonStaff.create({
      data: { salonId: salon.id, userId: user.id, displayName: name, roleInSalon: 'BARBER', status: 'ACTIVE', services: { create: services.map((s) => ({ serviceId: s.id })) } },
    });
    barbers[key] = { staffId: staff.id, userId: user.id, email: user.email! };
  }

  const customers: { id: string; phone: string }[] = [];
  for (let i = 1; i <= 6; i++) {
    const c = await prisma.user.create({ data: { email: `customer${i}.${tag}@fastque-demo.test`, phone: phone(i), status: 'ACTIVE', emailVerifiedAt: new Date() } });
    await prisma.userRole.create({ data: { userId: c.id, role: 'CUSTOMER' } });
    customers.push({ id: c.id, phone: c.phone! });
  }

  // ---- 14 days of finished, invoiced and paid visits (real rows, same shape live operation produces)
  let invoiceSeq = 0;
  const staffKeys = Object.keys(barbers);
  const catalog = [svc.cut, svc.beard, svc.combo, svc.spa, svc.massage];
  async function finishedVisit(when: Date, service: (typeof catalog)[number], staffKey: string, cust: number | null, paid: 'full' | 'partial' | 'none', guest?: string) {
    const staff = barbers[staffKey];
    const chair = chairs[Math.floor(Math.random() * 3)];
    const start = new Date(when.getTime());
    const end = new Date(start.getTime() + service.durationMinutes * 60_000);
    const entry = await prisma.queueEntry.create({
      data: {
        salonId: salon.id, serviceId: service.id, source: 'WALK_IN', tokenNumber: 1 + Math.floor(Math.random() * 40), status: 'COMPLETED',
        customerId: cust ? customers[cust - 1].id : null, contactName: guest ?? null, contactPhone: guest ? null : null,
        assignedStaffId: staff.staffId, assignedChairId: chair.id, arrivedAt: start, joinedAt: new Date(start.getTime() - 8 * 60_000),
        calledAt: start, serviceStartedAt: start, serviceCompletedAt: end, createdByUserId: guest ? owner.id : null,
      },
    });
    await prisma.serviceSession.create({ data: { queueEntryId: entry.id, staffId: staff.staffId, chairId: chair.id, serviceId: service.id, status: 'COMPLETED', startedAt: start, endedAt: end } });
    if (paid === 'none' && Math.random() < 0.6) return; // many visits are simply never invoiced
    invoiceSeq += 1;
    const price = Number(service.price);
    const invoice = await prisma.invoice.create({
      data: {
        salonId: salon.id, sequence: invoiceSeq, number: `S360-${String(invoiceSeq).padStart(6, '0')}`, sourceType: 'QUEUE_ENTRY', queueEntryId: entry.id,
        customerId: cust ? customers[cust - 1].id : null, customerName: guest ?? null, customerPhone: cust ? customers[cust - 1].phone : null, staffName: staffKey,
        currency: 'INR', subtotal: price.toFixed(2), discountTotal: '0', taxTotal: '0', total: price.toFixed(2),
        sellerLegalName: 'Studio 360 Barbers', sellerAddress: '14 Station Road, Jharsuguda, Odisha', sellerPhone: '+919800012345',
        serviceDate: start, issuedAt: end, issuedByUserId: owner.id,
        lines: { create: [{ serviceId: service.id, description: service.name, quantity: 1, unitPrice: price.toFixed(2), discount: '0', lineTotal: price.toFixed(2), sortOrder: 0 }] },
      },
    });
    if (paid !== 'none') {
      const amount = paid === 'full' ? price : Math.round(price / 2);
      await prisma.invoicePayment.create({
        data: { invoiceId: invoice.id, salonId: salon.id, kind: 'PAYMENT', method: (['CASH', 'UPI', 'CARD'] as const)[Math.floor(Math.random() * 3)], amount: amount.toFixed(2), recordedByUserId: owner.id, recordedAt: new Date(end.getTime() + 5 * 60_000) },
      });
    }
  }
  for (let d = 13; d >= 1; d--) {
    const count = 3 + ((d * 7) % 5) + (d % 7 === 5 || d % 7 === 6 ? 3 : 0);
    for (let k = 0; k < count; k++) {
      const service = catalog[(d + k) % catalog.length];
      const key = staffKeys[(d + k) % staffKeys.length];
      const qualified = service === svc.spa ? (key === 'arjun' ? 'bilal' : key) : service === svc.massage && key === 'bilal' ? 'arjun' : key;
      await finishedVisit(daysAgo(d, 10 + k * 1.5 < 20 ? 10 + Math.floor(k * 1.3) : 19, (k * 17) % 60), service, qualified, k % 3 === 0 ? ((d + k) % 6) + 1 : null, k % 5 === 4 ? 'partial' : 'full', k % 3 === 0 ? undefined : `Guest ${d}-${k}`);
    }
  }
  // today: finished visits
  const nowIst = new Date();
  for (let k = 0; k < 5; k++) {
    await finishedVisit(new Date(nowIst.getTime() - (200 - k * 30) * 60_000), catalog[k % catalog.length], staffKeys[k % 3], k % 2 ? ((k + 1) % 6) + 1 : null, k < 3 ? 'full' : 'none', k % 2 ? undefined : `Queue Guest ${k + 1}`);
  }

  // ---- today's live queue
  const seats: Array<[string, string, (typeof catalog)[number], string]> = [
    ['arjun', chairs[0].id, svc.combo, 'Rohit S.'],
    ['chitra', chairs[1].id, svc.spa, 'Meera K.'],
  ];
  let token = 60;
  for (const [key, chairId, service, name] of seats) {
    const entry = await prisma.queueEntry.create({
      data: { salonId: salon.id, serviceId: service.id, source: 'WALK_IN', tokenNumber: ++token, status: 'IN_SERVICE', contactName: name, assignedStaffId: barbers[key].staffId, assignedChairId: chairId, arrivedAt: minutes(-30), joinedAt: minutes(-40), calledAt: minutes(-20), serviceStartedAt: minutes(-18), createdByUserId: owner.id },
    });
    await prisma.serviceSession.create({ data: { queueEntryId: entry.id, staffId: barbers[key].staffId, chairId, serviceId: service.id, status: 'ACTIVE', startedAt: minutes(-18) } });
  }
  for (const [name, service, arrived, joined] of [
    ['Vikram Rao', svc.cut, true, -14],
    ['Sanjay P.', svc.beard, true, -9],
    ['Deepak J.', svc.massage, false, -4],
  ] as const) {
    await prisma.queueEntry.create({
      data: { salonId: salon.id, serviceId: service.id, source: 'WALK_IN', tokenNumber: ++token, status: 'WAITING', contactName: name, contactPhone: arrived ? null : phone(9), arrivedAt: arrived ? minutes(joined + 2) : null, joinedAt: minutes(joined), createdByUserId: arrived ? owner.id : null },
    });
  }
  await prisma.queueEntry.create({ data: { salonId: salon.id, serviceId: svc.cut.id, source: 'WALK_IN', tokenNumber: ++token, status: 'CANCELLED', contactName: 'Left before turn', joinedAt: minutes(-90), arrivedAt: minutes(-88), createdByUserId: owner.id } });
  await prisma.queueEntry.create({ data: { salonId: salon.id, serviceId: svc.beard.id, source: 'WALK_IN', tokenNumber: ++token, status: 'NO_SHOW', contactName: 'Did not respond', joinedAt: minutes(-120), calledAt: minutes(-100), createdByUserId: owner.id } });

  // ---- bookings: upcoming today/tomorrow, plus attributed and legacy cancellations
  const slotToday = (offsetMin: number, svcs: (typeof catalog)[number][], who: number | null, guest?: string, staffKey?: string) =>
    prisma.booking.create({
      data: {
        salonId: salon.id, customerId: who ? customers[who - 1].id : null, serviceId: svcs[0].id, slotStart: minutes(offsetMin),
        slotEnd: minutes(offsetMin + svcs.reduce((a, s) => a + s.durationMinutes, 0)), status: 'CONFIRMED', source: guest ? 'IN_SHOP' : 'APP',
        idempotencyKey: randomUUID(), preferredStaffId: staffKey ? barbers[staffKey].staffId : null,
        guestName: guest ?? null, guestPhone: null, createdByUserId: guest ? owner.id : null,
        checkInOpensMinutesBefore: 15, checkInDueGraceMinutes: 15,
        services: { create: svcs.map((s, i) => ({ serviceId: s.id, sortOrder: i, serviceName: s.name, durationMinutes: s.durationMinutes, price: s.price })) },
      },
    });
  await slotToday(40, [svc.cut], 1, undefined, 'bilal');
  await slotToday(75, [svc.combo], 2, undefined, 'arjun');
  await slotToday(120, [svc.spa], null, 'Anita D.', 'chitra');
  await slotToday(180, [svc.cut, svc.beard], 3);
  await slotToday(60 * 24 + 30, [svc.cut], 4, undefined, 'bilal');
  const cancelled = async (hoursAgo: number, who: number, actor: string | null, byUser: string | null, reason: string | null, service = svc.cut) => {
    const b = await prisma.booking.create({
      data: {
        salonId: salon.id, customerId: customers[who - 1].id, serviceId: service.id, slotStart: minutes(60 * 30 + hoursAgo), slotEnd: minutes(60 * 30 + hoursAgo + 30),
        status: 'CANCELLED', source: 'APP', idempotencyKey: randomUUID(), cancelledAt: minutes(-hoursAgo * 60), cancelledById: byUser, cancelledByActor: actor as never, cancellationReason: reason,
        services: { create: [{ serviceId: service.id, sortOrder: 0, serviceName: service.name, durationMinutes: service.durationMinutes, price: service.price }] },
      },
    });
    return b;
  };
  await cancelled(2, 1, 'CUSTOMER', customers[0].id, null);
  await cancelled(26, 2, 'CUSTOMER', customers[1].id, null, svc.combo);
  await cancelled(50, 3, 'OWNER', owner.id, 'Barber unwell');
  await cancelled(70, 4, 'STAFF', barbers.arjun.userId, 'Equipment issue', svc.spa);
  await cancelled(90, 5, null, null, null); // legacy row: no attribution recorded
  await cancelled(110, 6, 'CUSTOMER', customers[5].id, null);

  writeFileSync(
    out,
    JSON.stringify({ salonId: salon.id, ownerEmail: owner.email, barberEmail: barbers.arjun.email }, null, 2),
  );
  console.log(`seeded demo shop ${salon.id} (credentials written to the output file)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
