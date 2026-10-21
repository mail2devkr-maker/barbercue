import { MaintenanceModeService } from '../maintenance/maintenance-mode.service';
import { PrismaService } from './prisma.service';

describe('PrismaService maintenance write barrier', () => {
  const originalMode = process.env.FASTQUE_MAINTENANCE_MODE;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let prisma: PrismaService;

  afterEach(async () => {
    await prisma?.onModuleDestroy();
    if (originalMode === undefined) delete process.env.FASTQUE_MAINTENANCE_MODE;
    else process.env.FASTQUE_MAINTENANCE_MODE = originalMode;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('rejects model and raw writes before the database client can execute them', async () => {
    process.env.FASTQUE_MAINTENANCE_MODE = 'true';
    process.env.DATABASE_URL =
      'postgresql://qa:qa@127.0.0.1:5432/maintenance_gate_qa?schema=public';
    prisma = new PrismaService(new MaintenanceModeService());

    await expect(
      prisma.user.update({
        where: { id: 'synthetic' },
        data: { status: 'ACTIVE' },
      }),
    ).rejects.toMatchObject({ code: 'MAINTENANCE_MODE' });
    await expect(prisma.$executeRawUnsafe('SELECT 1')).rejects.toMatchObject({
      code: 'MAINTENANCE_MODE',
    });
  });
});
