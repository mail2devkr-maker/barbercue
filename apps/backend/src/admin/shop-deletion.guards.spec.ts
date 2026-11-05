import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';
import { databaseGuardRefusal } from '../common/filters/all-exceptions.filter';

/** Issue #381 structural guards that must hold for every future change. */
describe('recoverable shop deletion guards', () => {
  const srcRoot = join(__dirname, '..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory()
        ? files(p)
        : p.endsWith('.ts')
          ? [p]
          : [];
    });

  it('no application code opts into the synthetic-shop hard-delete escape hatch', () => {
    const offenders = files(srcRoot)
      .filter((f) => !f.endsWith('.spec.ts'))
      .filter((f) =>
        readFileSync(f, 'utf8').includes('app.fastque_synthetic_shop_cleanup'),
      );
    expect(offenders).toEqual([]);
  });

  it('only ShopDeletionService sets the restore marker that passes the quarantine guard', () => {
    const users = files(srcRoot)
      .filter((f) => !f.endsWith('.spec.ts'))
      .filter((f) =>
        readFileSync(f, 'utf8').includes('app.fastque_restore_salon_id'),
      )
      .map((f) => f.split(sep).join('/').split('/src/')[1]);
    expect(users).toEqual(['admin/shop-deletion.service.ts']);
  });

  it('no application code hard-deletes a shop', () => {
    const offenders = files(srcRoot)
      .filter((f) => !f.endsWith('.spec.ts'))
      .filter((f) =>
        /\.salon\.(delete|deleteMany)\(/.test(readFileSync(f, 'utf8')),
      );
    expect(offenders).toEqual([]);
  });

  it('maps database guard refusals to stable 409 codes and ignores other errors', () => {
    class PrismaClientUnknownRequestError extends Error {}
    expect(
      databaseGuardRefusal(
        new PrismaClientUnknownRequestError('ERROR: SHOP_QUARANTINED'),
      ),
    ).toEqual(expect.objectContaining({ code: 'SHOP_QUARANTINED' }));
    expect(
      databaseGuardRefusal(
        new PrismaClientUnknownRequestError('db: SALON_HARD_DELETE_DISABLED'),
      ),
    ).toEqual(expect.objectContaining({ code: 'SALON_HARD_DELETE_DISABLED' }));
    expect(databaseGuardRefusal(new Error('SHOP_QUARANTINED'))).toBeNull();
    expect(
      databaseGuardRefusal(new PrismaClientUnknownRequestError('other')),
    ).toBeNull();
  });
});
