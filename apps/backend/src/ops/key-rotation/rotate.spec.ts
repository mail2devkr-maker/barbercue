import { CryptoService } from '../../auth/services/crypto.service';
import { deriveKey, open, seal, tryOpen } from './cipher';
import {
  UnreadableValuesError,
  VerificationError,
  applyRotation,
  planRotation,
  verifyRotation,
  type RotationTarget,
  type SqlRunner,
} from './rotate';

const OLD = 'old-key-'.padEnd(64, 'a');
const NEW = 'new-key-'.padEnd(64, 'b');

const TARGET: RotationTarget = {
  name: 'users.totpSecret',
  table: 'users',
  idColumn: 'id',
  columns: ['totpSecret'],
};

/** In-memory stand-in for the single-column statements the library issues. */
function fakeDb(initial: Record<string, string | null>, opts: { raceOn?: string } = {}) {
  let rows = new Map(Object.entries(initial));
  const writes: string[] = [];
  const build = (store: () => Map<string, string | null>): SqlRunner => ({
    async query<T>(sql: string, params: unknown[] = []) {
      if (sql.includes('to_regclass')) return [{ present: params[0] === 'public."users"' }] as unknown as T[];
      if (sql.startsWith('SELECT "id"::text')) {
        return [...store().entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([__id, totpSecret]) => ({ __id, totpSecret })) as unknown as T[];
      }
      throw new Error(`unexpected query ${sql}`);
    },
    async execute(sql: string, params: unknown[] = []) {
      expect(sql.startsWith('UPDATE "users" SET "totpSecret" = $1')).toBe(true);
      const id = params[params.length - 1] as string;
      const [sealed, guard] = params as string[];
      if (id === opts.raceOn) return 0; // someone else changed the row after we read it
      if (store().get(id) !== guard) return 0;
      store().set(id, sealed);
      writes.push(id);
      return 1;
    },
    async transaction<T>(work: (tx: SqlRunner) => Promise<T>) {
      const snapshot = new Map(rows);
      try {
        return await work(build(() => rows));
      } catch (error) {
        rows = snapshot; // roll back
        throw error;
      }
    },
  });
  return { db: build(() => rows), rows: () => rows, writes };
}

const sealedWith = (secret: string, plaintext: string) => seal(deriveKey(secret), plaintext);

describe('encryption key rotation library', () => {
  describe('cipher', () => {
    it('is byte-compatible with CryptoService in both directions', () => {
      const previous = process.env.TOTP_ENCRYPTION_KEY;
      process.env.TOTP_ENCRYPTION_KEY = OLD;
      try {
        const service = new CryptoService();
        expect(open(deriveKey(OLD), service.encrypt('JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP');
        expect(service.decrypt(seal(deriveKey(OLD), 'JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP');
        expect(tryOpen(deriveKey(NEW), service.encrypt('x'))).toBeNull();
      } finally {
        process.env.TOTP_ENCRYPTION_KEY = previous;
      }
    });
  });

  describe('CryptoService during a rotation window', () => {
    const run = (env: Record<string, string | undefined>, work: (service: CryptoService) => void) => {
      const saved = {
        current: process.env.TOTP_ENCRYPTION_KEY,
        previous: process.env.TOTP_ENCRYPTION_KEY_SECONDARY,
      };
      process.env.TOTP_ENCRYPTION_KEY = env.TOTP_ENCRYPTION_KEY;
      if (env.TOTP_ENCRYPTION_KEY_SECONDARY === undefined) delete process.env.TOTP_ENCRYPTION_KEY_SECONDARY;
      else process.env.TOTP_ENCRYPTION_KEY_SECONDARY = env.TOTP_ENCRYPTION_KEY_SECONDARY;
      try {
        work(new CryptoService());
      } finally {
        process.env.TOTP_ENCRYPTION_KEY = saved.current;
        if (saved.previous === undefined) delete process.env.TOTP_ENCRYPTION_KEY_SECONDARY;
        else process.env.TOTP_ENCRYPTION_KEY_SECONDARY = saved.previous;
      }
    };

    it('writes with the current key and reads values sealed with either key while the previous key is set', () => {
      const oldValue = sealedWith(OLD, 'SECRET-OLD');
      const newValue = sealedWith(NEW, 'SECRET-NEW');
      run({ TOTP_ENCRYPTION_KEY: NEW, TOTP_ENCRYPTION_KEY_SECONDARY: OLD }, (service) => {
        expect(service.decrypt(oldValue)).toBe('SECRET-OLD');
        expect(service.decrypt(newValue)).toBe('SECRET-NEW');
        const fresh = service.encrypt('SECRET-FRESH');
        expect(tryOpen(deriveKey(NEW), fresh)).toBe('SECRET-FRESH');
        expect(tryOpen(deriveKey(OLD), fresh)).toBeNull();
      });
    });

    it('does not read old-key values once the previous key is retired, and ignores an identical previous key', () => {
      const oldValue = sealedWith(OLD, 'SECRET-OLD');
      run({ TOTP_ENCRYPTION_KEY: NEW }, (service) => {
        expect(() => service.decrypt(oldValue)).toThrow();
      });
      run({ TOTP_ENCRYPTION_KEY: NEW, TOTP_ENCRYPTION_KEY_SECONDARY: NEW }, (service) => {
        expect(() => service.decrypt(oldValue)).toThrow();
        expect(service.decrypt(sealedWith(NEW, 'ok'))).toBe('ok');
      });
    });

    it('still rejects tampered, malformed and foreign-key values with the previous key set', () => {
      const foreign = sealedWith('third-key-'.padEnd(64, 'c'), 'x');
      run({ TOTP_ENCRYPTION_KEY: NEW, TOTP_ENCRYPTION_KEY_SECONDARY: OLD }, (service) => {
        expect(() => service.decrypt(foreign)).toThrow();
        expect(() => service.decrypt('not-a-ciphertext')).toThrow('Malformed ciphertext');
        const [iv, body, tag] = sealedWith(OLD, 'SECRET').split('.');
        const flipped = Buffer.from(body, 'base64');
        flipped[0] ^= 0xff;
        expect(() => service.decrypt([iv, flipped.toString('base64'), tag].join('.'))).toThrow();
      });
    });
  });

  describe('planRotation / applyRotation / verifyRotation', () => {
    const fixture = () => ({
      a: sealedWith(OLD, 'SECRET-A'),
      b: sealedWith(OLD, 'SECRET-B'),
      c: sealedWith(NEW, 'SECRET-C'), // already rotated
      d: null, // admin without 2FA
      e: '', // empty string
    });

    it('plan classifies every value and writes nothing', async () => {
      const { db, rows, writes } = fakeDb(fixture());
      const before = new Map(rows());
      const [report] = await planRotation(db, [TARGET], { oldSecret: OLD, newSecret: NEW });
      expect(report).toMatchObject({ present: true, rows: 5, empty: 2, pending: 2, rotated: 1, changed: 0 });
      expect(report.unreadable).toEqual([]);
      expect(writes).toEqual([]);
      expect(rows()).toEqual(before);
    });

    it('apply re-encrypts old values, preserves plaintext, and leaves rotated and empty values byte-identical', async () => {
      const { db, rows, writes } = fakeDb(fixture());
      const before = new Map(rows());
      const [report] = await applyRotation(db, [TARGET], { oldSecret: OLD, newSecret: NEW });
      expect(report.changed).toBe(2);
      expect(writes.sort()).toEqual(['a', 'b']);
      expect(open(deriveKey(NEW), rows().get('a') as string)).toBe('SECRET-A');
      expect(open(deriveKey(NEW), rows().get('b') as string)).toBe('SECRET-B');
      expect(tryOpen(deriveKey(OLD), rows().get('a') as string)).toBeNull();
      for (const id of ['c', 'd', 'e']) expect(rows().get(id)).toBe(before.get(id));
      expect(rows().get('a')).not.toBe(before.get('a')); // fresh IV: never reuse a ciphertext
    });

    it('is idempotent: a second apply and a resumed half-done run change nothing further', async () => {
      const { db, rows } = fakeDb(fixture());
      await applyRotation(db, [TARGET], { oldSecret: OLD, newSecret: NEW });
      const afterFirst = new Map(rows());
      const [second] = await applyRotation(db, [TARGET], { oldSecret: OLD, newSecret: NEW });
      expect(second).toMatchObject({ changed: 0, pending: 0, rotated: 3 });
      expect(rows()).toEqual(afterFirst);
    });

    it('refuses before writing anything when any value is opened by neither key', async () => {
      const { db, rows, writes } = fakeDb({
        ...fixture(),
        z: sealedWith('third-key-'.padEnd(64, 'c'), 'SECRET-Z'),
        y: 'garbage',
      });
      const before = new Map(rows());
      await expect(applyRotation(db, [TARGET], { oldSecret: OLD, newSecret: NEW })).rejects.toBeInstanceOf(
        UnreadableValuesError,
      );
      expect(writes).toEqual([]);
      expect(rows()).toEqual(before);
      const [plan] = await planRotation(db, [TARGET], { oldSecret: OLD, newSecret: NEW });
      expect(plan.unreadable.sort()).toEqual(['y', 'z']);
    });

    it('rolls everything back when a row changes between the read and the write', async () => {
      const { db, rows } = fakeDb(fixture(), { raceOn: 'b' });
      const before = new Map(rows());
      await expect(applyRotation(db, [TARGET], { oldSecret: OLD, newSecret: NEW })).rejects.toBeInstanceOf(
        VerificationError,
      );
      expect(rows()).toEqual(before); // 'a' was written first and has been rolled back too
    });

    it('refuses identical keys and an absent required table', async () => {
      const { db } = fakeDb(fixture());
      await expect(applyRotation(db, [TARGET], { oldSecret: OLD, newSecret: OLD })).rejects.toThrow('identical');
      await expect(
        planRotation(db, [{ ...TARGET, table: 'orders' }], { oldSecret: OLD, newSecret: NEW }),
      ).rejects.toThrow('Required table is missing');
      const [optional] = await planRotation(db, [{ ...TARGET, table: 'orders', optional: true }], {
        oldSecret: OLD,
        newSecret: NEW,
      });
      expect(optional.present).toBe(false);
    });

    it('verify passes only when every value opens with the new key alone', async () => {
      const { db } = fakeDb(fixture());
      await expect(verifyRotation(db, [TARGET], { newSecret: NEW })).rejects.toBeInstanceOf(VerificationError);
      await applyRotation(db, [TARGET], { oldSecret: OLD, newSecret: NEW });
      const [report] = await verifyRotation(db, [TARGET], { newSecret: NEW });
      expect(report).toMatchObject({ rows: 5, rotated: 3, empty: 2, pending: 0 });
    });

    it('rejects an unsafe table or column identifier', async () => {
      const { db } = fakeDb(fixture());
      await expect(
        planRotation(db, [{ ...TARGET, table: 'users"; DROP TABLE users; --' }], { oldSecret: OLD, newSecret: NEW }),
      ).rejects.toThrow('Unsafe SQL identifier');
    });
  });
});
