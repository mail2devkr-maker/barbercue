/**
 * Growth AI local demonstration data (spec section 26): 20 active salons in Greater Noida offering
 * haircuts, with 60 days of completed bookings, and two QA admins (an Admin and a Marketing Manager).
 *
 * DISPOSABLE LOCAL DATABASES ONLY. Refuses to run unless DATABASE_URL points at localhost/127.0.0.1
 * and its database is `growth_qa` (or the name in GROWTH_DEMO_SEED_DATABASE). Every salon is named
 * "FastQue Demo …" and every email ends in @example.test, so nothing can be mistaken for real data.
 *
 *   DATABASE_URL=postgresql://…@127.0.0.1:5432/growth_qa npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-growth-demo.ts
 */
import { PrismaClient } from '@prisma/client';

const allowed = process.env.GROWTH_DEMO_SEED_DATABASE ?? 'growth_qa';
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/none');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.replace(/^\//, '') !== allowed) {
  console.error(`Refusing: seed-growth-demo only runs against a local database named "${allowed}".`);
  process.exit(2);
}

const prisma = new PrismaClient();
const AREAS = ['Alpha 1', 'Alpha 2', 'Beta 1', 'Gamma 2', 'Delta 1', 'Pari Chowk', 'Knowledge Park', 'Omicron', 'Chi', 'Sigma'];
const HAIRCUTS = ["Men's Haircut", 'Haircut', 'Kids Hair Cut', 'Haircut & Beard'];

// Small deterministic generator so every run produces the same demo.
let seed = 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

async function main() {
  const city =
    (await prisma.city.findFirst({ where: { countryCode: 'IN', slug: 'greater-noida' } })) ??
    (await prisma.city.create({ data: { name: 'Greater Noida', slug: 'greater-noida', countryCode: 'IN', state: 'Uttar Pradesh', country: 'India' } }));

  const user = (email: string, role: string) =>
    prisma.user.upsert({ where: { email }, create: { email, status: 'ACTIVE', roles: { create: [{ role: role as never }] } }, update: {} });
  const owner = await user('growth-demo-owner@example.test', 'SALON_OWNER');
  const admin = await user('growth-qa-admin@example.test', 'PLATFORM_ADMIN');
  const manager = await user('growth-qa-manager@example.test', 'CO_FOUNDER');
  await prisma.growthStaffRole.upsert({ where: { userId: manager.id }, create: { userId: manager.id, role: 'MARKETING_MANAGER', grantedByUserId: admin.id }, update: {} });

  const customers: Array<{ id: string }> = [];
  for (let i = 1; i <= 120; i++) customers.push(await user(`growth-demo-customer-${i}@example.test`, 'CUSTOMER'));

  const existing = await prisma.salon.count({ where: { cityId: city.id, name: { startsWith: 'FastQue Demo' } } });
  if (existing >= 20) {
    console.log('Demo salons already exist; nothing to do.');
    return;
  }
  let bookingNo = 0;
  for (let n = 1; n <= 20; n++) {
    const salon = await prisma.salon.create({
      data: {
        ownerUserId: owner.id,
        name: `FastQue Demo Salon ${String(n).padStart(2, '0')}`,
        slug: `fastque-demo-salon-${n}`,
        cityId: city.id,
        localityText: `Sector ${AREAS[n % AREAS.length]}`,
        addressLine: `Demo address ${n}`,
        status: 'ACTIVE',
        services: {
          create: [
            { name: HAIRCUTS[n % HAIRCUTS.length], durationMinutes: 30, price: String(150 + (n % 6) * 50) },
            { name: 'Beard Trim', durationMinutes: 15, price: '100' },
          ],
        },
      },
      include: { services: true },
    });
    const haircut = salon.services[0];
    // 60 days of history; busier salons get more bookings.
    const perDay = 0.4 + (n % 5) * 0.35;
    for (let d = 60; d >= 0; d--) {
      const count = Math.floor(perDay + rand());
      for (let k = 0; k < count; k++) {
        const start = new Date(Date.now() - d * 86400_000 - 3 * 3600_000 - k * 1800_000);
        if (start > new Date()) continue;
        const customer = customers[Math.floor(rand() * customers.length)];
        await prisma.booking.create({
          data: {
            salonId: salon.id,
            serviceId: haircut.id,
            customerId: customer.id,
            slotStart: start,
            slotEnd: new Date(start.getTime() + 30 * 60_000),
            status: rand() < 0.88 ? 'COMPLETED' : 'CANCELLED',
            source: rand() < 0.5 ? 'WEB' : 'APP',
            idempotencyKey: `growth-demo-${n}-${++bookingNo}`,
            services: { create: [{ serviceId: haircut.id, sortOrder: 0, serviceName: haircut.name, durationMinutes: 30, price: haircut.price }] },
          },
        });
      }
    }
  }
  console.log(`Seeded 20 demo salons and ${bookingNo} demo bookings in ${city.name}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
