/**
 * FastQue Connect local demonstration data (docs/connect/TESTING.md).
 *
 * DISPOSABLE LOCAL DATABASES ONLY. Refuses to run unless DATABASE_URL points at localhost/127.0.0.1
 * and its database is `connect_dev` (or the name in CONNECT_DEMO_SEED_DATABASE). Every salon is
 * named "FastQue Demo …" and every email ends in @example.test. Owner/staff passwords come from
 * CONNECT_DEMO_PASSWORD (required); nothing is printed.
 *
 *   DATABASE_URL=postgresql://…@127.0.0.1:5432/connect_dev CONNECT_DEMO_PASSWORD=… \
 *     npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-connect-demo.ts
 */
import * as bcrypt from 'bcrypt';
import { Prisma, PrismaClient } from '@prisma/client';

const allowed = process.env.CONNECT_DEMO_SEED_DATABASE ?? 'connect_dev';
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/none');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.replace(/^\//, '') !== allowed) {
  console.error(`Refusing: seed-connect-demo only runs against a local database named "${allowed}".`);
  process.exit(2);
}
const password = process.env.CONNECT_DEMO_PASSWORD;
if (!password || password.length < 10) {
  console.error('Set CONNECT_DEMO_PASSWORD (10+ characters) for the demo owner and staff logins.');
  process.exit(2);
}

const prisma = new PrismaClient();
const TZ = 'Asia/Kolkata';
const H = 3_600_000;

async function user(email: string, roles: { role: string; salonId?: string | null }[], withPassword: boolean, phone?: string) {
  const passwordHash = withPassword ? await bcrypt.hash(password!, 10) : null;
  const u = await prisma.user.upsert({
    where: { email },
    create: { email, status: 'ACTIVE', emailVerifiedAt: new Date(), passwordHash, phone: phone ?? null, phoneVerifiedAt: phone ? new Date() : null },
    update: { passwordHash },
  });
  for (const r of roles) {
    const exists = await prisma.userRole.findFirst({ where: { userId: u.id, role: r.role as never, salonId: r.salonId ?? null } });
    if (!exists) await prisma.userRole.create({ data: { userId: u.id, role: r.role as never, salonId: r.salonId ?? null } });
  }
  return u;
}

async function main() {
  const city =
    (await prisma.city.findFirst({ where: { slug: 'connect-demo-city' } })) ??
    (await prisma.city.create({ data: { name: 'Noida', slug: 'connect-demo-city', countryCode: 'IN', state: 'Uttar Pradesh', country: 'India' } }));
  const owner = await user('connect-demo-owner@example.test', [], true);
  const existing = await prisma.salon.findFirst({ where: { slug: 'fastque-demo-connect-salon' } });
  const salon =
    existing ??
    (await prisma.salon.create({
      data: { ownerUserId: owner.id, name: 'FastQue Demo Connect Salon', slug: 'fastque-demo-connect-salon', cityId: city.id, addressLine: '14 Market Road, Sector 18', landmark: 'Opposite Metro Gate 2', postalCode: '201301', lat: 28.5708, lng: 77.3261, status: 'ACTIVE', timezone: TZ, currency: 'INR', serviceBufferMinutes: 0, queueAutoAssignEnabled: false },
    }));
  await user(owner.email!, [{ role: 'SALON_OWNER', salonId: salon.id }], true);
  if (!existing) {
    await prisma.operatingHours.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ salonId: salon.id, dayOfWeek: d, openTime: '09:00', closeTime: '21:00', isClosed: d === 1 })) });
    for (const label of ['Chair 1', 'Chair 2', 'Chair 3']) await prisma.chair.create({ data: { salonId: salon.id, label } });
  }
  const svc = async (name: string, price: string, durationMinutes: number) =>
    (await prisma.service.findFirst({ where: { salonId: salon.id, name } })) ?? prisma.service.create({ data: { salonId: salon.id, name, price, durationMinutes } });
  const haircut = await svc('Haircut', '250.00', 30);
  const beard = await svc('Beard Trim', '120.00', 15);
  const spa = await svc('Hair Spa', '800.00', 45);

  const staffUser = await user('connect-demo-manager@example.test', [{ role: 'SALON_STAFF', salonId: salon.id }], true);
  const stylistUser = await user('connect-demo-stylist@example.test', [{ role: 'SALON_STAFF', salonId: salon.id }], true);
  for (const [u, name] of [[staffUser, 'Meera'], [stylistUser, 'Arjun']] as const) {
    if (!(await prisma.salonStaff.findFirst({ where: { salonId: salon.id, userId: u.id } })))
      await prisma.salonStaff.create({ data: { salonId: salon.id, userId: u.id, displayName: name, roleInSalon: 'BARBER', status: 'ACTIVE', services: { create: [{ serviceId: haircut.id }, { serviceId: beard.id }, { serviceId: spa.id }] } } });
  }
  await prisma.connectStaffGrant.upsert({ where: { salonId_userId: { salonId: salon.id, userId: staffUser.id } }, create: { salonId: salon.id, userId: staffUser.id, role: 'MANAGER', grantedById: owner.id }, update: {} });
  await prisma.connectStaffGrant.upsert({ where: { salonId_userId: { salonId: salon.id, userId: stylistUser.id } }, create: { salonId: salon.id, userId: stylistUser.id, role: 'STYLIST', grantedById: owner.id }, update: {} });
  const meera = await prisma.salonStaff.findFirstOrThrow({ where: { salonId: salon.id, userId: staffUser.id } });

  const settings = { salonId: salon.id, aiMode: 'SUGGEST', autoReplyIntents: ['PRICING', 'LOCATION', 'OPENING_HOURS'], parkingInfo: 'Free two-wheeler and car parking in the basement (entry from the back lane).', directions: 'Take Metro Gate 2, walk 50 m towards the market; we are on the first floor above the pharmacy.', aftercare: 'Avoid washing coloured hair for 48 hours.', faq: [{ q: 'Do you accept UPI and cards?', a: 'Yes, UPI, cards and cash are accepted at the counter.' }] as Prisma.InputJsonValue };
  const st = await prisma.connectSalonSettings.findUnique({ where: { salonId: salon.id } });
  if (!st) await prisma.connectSalonSettings.create({ data: settings });

  const customers = [
    ['connect-demo-asha@example.test', '+919900000101'],
    ['connect-demo-rahul@example.test', '+919900000102'],
    ['connect-demo-priya@example.test', '+919900000103'],
  ] as const;
  const cust: { id: string }[] = [];
  for (const [email, phone] of customers) cust.push(await user(email, [{ role: 'CUSTOMER' }], false, phone));

  if (await prisma.connectConversation.count({ where: { salonId: salon.id } })) {
    console.log('Demo conversations already exist; users and settings refreshed.');
    return;
  }
  const day = (d: number, hh: number) => {
    const ist = new Date(Date.now() + 330 * 60_000 + d * 86_400_000);
    ist.setUTCHours(hh, 0, 0, 0);
    return new Date(ist.getTime() - 330 * 60_000);
  };
  const booking = (customerId: string, start: Date, status: 'CONFIRMED' | 'COMPLETED', services: { id: string; name: string; price: string; durationMinutes: number }[]) =>
    prisma.booking.create({
      data: {
        salonId: salon.id, customerId, serviceId: services[0].id, slotStart: start, slotEnd: new Date(start.getTime() + services.reduce((n, s) => n + s.durationMinutes, 0) * 60_000), status, source: 'WEB', idempotencyKey: `connect-demo-${customerId}-${start.getTime()}`, preferredStaffId: meera.id,
        services: { create: services.map((s, i) => ({ serviceId: s.id, sortOrder: i, serviceName: s.name, durationMinutes: s.durationMinutes, price: s.price })) },
      },
    });
  const conversation = async (b: { id: string; customerId: string | null }, msgs: [string, string | null, Record<string, unknown>?][], extra: Prisma.ConnectConversationUncheckedCreateInput | object = {}) => {
    const c = await prisma.connectConversation.create({ data: { kind: 'SALON_BOOKING', salonId: salon.id, customerId: b.customerId!, bookingId: b.id, lastMessageSeq: msgs.length, lastMessageAt: new Date(), awaiting: msgs[msgs.length - 1][0] === 'CUSTOMER' ? 'SALON' : 'CUSTOMER', ...extra } });
    await prisma.connectParticipant.create({ data: { conversationId: c.id, userId: b.customerId!, side: 'CUSTOMER', lastReadSeq: msgs.length - 1, lastDeliveredSeq: msgs.length } });
    let seq = 0;
    for (const [sender, body, meta] of msgs) {
      seq += 1;
      await prisma.connectMessage.create({ data: { conversationId: c.id, seq, senderKind: sender as never, senderUserId: sender === 'CUSTOMER' ? b.customerId : sender === 'SALON' ? owner.id : null, kind: sender === 'SYSTEM' ? 'SYSTEM' : 'TEXT', body, aiGenerated: sender === 'AI', meta: meta as Prisma.InputJsonValue | undefined, createdAt: new Date(Date.now() - (msgs.length - seq) * 4 * 60_000) } });
    }
    await prisma.connectAnalyticsEvent.create({ data: { salonId: salon.id, conversationId: c.id, type: 'CONVERSATION_CREATED' } });
    return c;
  };

  const b1 = await booking(cust[0].id, day(1, 11), 'CONFIRMED', [{ id: haircut.id, name: 'Haircut', price: '250.00', durationMinutes: 30 }, { id: beard.id, name: 'Beard Trim', price: '120.00', durationMinutes: 15 }]);
  await conversation(b1, [
    ['SYSTEM', 'Conversation opened for your appointment.'],
    ['CUSTOMER', 'Hi! Where can I park near the salon?'],
    ['AI', 'Parking: Free two-wheeler and car parking in the basement (entry from the back lane).', { auto: true, source: 'VERIFIED_FACTS' }],
    ['CUSTOMER', 'Great, thanks. Can I also get a hair spa in the same visit?'],
  ]);
  const b2 = await booking(cust[1].id, day(2, 16), 'CONFIRMED', [{ id: haircut.id, name: 'Haircut', price: '250.00', durationMinutes: 30 }]);
  const c2 = await conversation(b2, [
    ['SYSTEM', 'Conversation opened for your appointment.'],
    ['CUSTOMER', 'Can I move my appointment from 4 PM to 5 PM?'],
    ['SALON', 'Sure, let me send you the open times.'],
  ], { assignedToUserId: staffUser.id });
  await prisma.connectInternalNote.create({ data: { conversationId: c2.id, authorUserId: owner.id, body: 'Regular customer, prefers Meera.' } });
  const b3 = await booking(cust[2].id, day(-2, 12), 'COMPLETED', [{ id: spa.id, name: 'Hair Spa', price: '800.00', durationMinutes: 45 }]);
  const c3 = await conversation(b3, [
    ['SYSTEM', 'Conversation opened for your appointment.'],
    ['CUSTOMER', 'Do you do bridal makeup packages? I need it for 4 people.'],
    ['SALON', 'Yes! I will send you a quotation.'],
  ]);
  const q = await prisma.connectQuotation.create({ data: { conversationId: c3.id, salonId: salon.id, title: 'Bridal party package (4 people)', createdById: owner.id, versions: { create: { version: 1, items: [{ name: 'Bridal makeup', quantity: 1, unitPaise: 800000, durationMinutes: 120 }, { name: 'Party makeup', quantity: 3, unitPaise: 250000, durationMinutes: 60 }], subtotalPaise: 1550000, discountPaise: 50000, taxPaise: 270000, totalPaise: 1770000, durationMinutes: 300, validUntil: new Date(Date.now() + 7 * 86_400_000), terms: '50% advance to confirm the date.', createdById: owner.id } } } });
  await prisma.connectMessage.create({ data: { conversationId: c3.id, seq: 4, senderKind: 'SYSTEM', kind: 'QUOTATION', body: 'Quotation: Bridal party package (4 people) · ₹17,700.00', meta: { quotationId: q.id, version: 1 } } });
  await prisma.connectConversation.update({ where: { id: c3.id }, data: { lastMessageSeq: 4, priority: 'HIGH', tags: ['bridal'] } });
  await prisma.connectAnalyticsEvent.create({ data: { salonId: salon.id, conversationId: c3.id, type: 'QUOTE_SENT', valuePaise: 1770000 } });
  console.log(`Seeded FastQue Connect demo for salon ${salon.id}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
