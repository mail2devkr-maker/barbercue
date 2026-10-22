import { deriveKey, open, seal, tryOpen, type DerivedKey } from './cipher';

/**
 * Re-encryption of every value sealed with TOTP_ENCRYPTION_KEY from an outgoing key to an incoming key.
 *
 * Safety properties (each is covered by the spec and the disposable-database e2e):
 *  - plan and verify are read-only; apply is all-or-nothing (one transaction over every target, rows locked FOR UPDATE);
 *  - a value that neither key opens aborts the run before anything is written (nothing is guessed or dropped);
 *  - every rewritten value is re-opened with the incoming key and compared with the original plaintext before commit;
 *  - already-rotated values are left byte-for-byte alone, so a run can be repeated or resumed;
 *  - nothing secret (keys, plaintext, ciphertext, URLs) is ever returned or logged, only counts and row ids.
 */
export interface RotationTarget {
  /** Stable label, e.g. "users.totpSecret". */
  name: string;
  table: string;
  idColumn: string;
  /** Ciphertext columns of one row, rewritten together. */
  columns: string[];
  /**
   * Columns derived from the plaintext with the INCOMING secret (e.g. keyed blind indexes). Receives every decrypted
   * column; returns column -> new value. Applied only to rows that are rewritten.
   */
  derive?: (
    plaintexts: Record<string, string | null>,
    ctx: { newSecret: string },
  ) => Record<string, string | null>;
  /** The table belongs to an optional feature: an absent table is reported, not an error. */
  optional?: boolean;
  /**
   * Code-defined SQL predicate restricting the rows in scope (never user input). Production targets leave it unset:
   * every row is in scope. Tests use it to confine a run to their own fixtures in a shared database.
   */
  where?: string;
}

export interface SqlRunner {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<number>;
  transaction<T>(work: (tx: SqlRunner) => Promise<T>): Promise<T>;
}

export interface RotationKeys {
  oldSecret: string | null;
  newSecret: string;
}

export interface TargetReport {
  name: string;
  present: boolean;
  rows: number;
  /** All ciphertext columns empty: nothing to protect or rotate. */
  empty: number;
  /** At least one column is still sealed with the outgoing key. */
  pending: number;
  /** Every non-empty column already opens with the incoming key. */
  rotated: number;
  /** Row ids with a column that neither key opens. */
  unreadable: string[];
  /** Rows rewritten by this run (apply only). */
  changed: number;
}

export class UnreadableValuesError extends Error {
  constructor(public readonly reports: TargetReport[]) {
    super(
      `Refusing to continue: ${reports.reduce((n, r) => n + r.unreadable.length, 0)} row(s) hold a value that neither the old nor the new key opens.`,
    );
    this.name = 'UnreadableValuesError';
  }
}

export class VerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationError';
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const quote = (identifier: string): string => {
  if (!IDENTIFIER.test(identifier))
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `"${identifier}"`;
};

type ColumnState = 'empty' | 'new' | 'old' | 'unreadable';

function classify(
  value: string | null,
  oldKey: DerivedKey | null,
  newKey: DerivedKey,
): ColumnState {
  if (value === null || value === '') return 'empty';
  if (tryOpen(newKey, value) !== null) return 'new';
  if (oldKey && tryOpen(oldKey, value) !== null) return 'old';
  return 'unreadable';
}

type Row = Record<string, string | null> & { __id: string };

async function tablePresent(
  db: SqlRunner,
  target: RotationTarget,
): Promise<boolean> {
  const found = await db.query<{ present: boolean }>(
    `SELECT to_regclass($1::text) IS NOT NULL AS present`,
    [`public.${quote(target.table)}`],
  );
  return found[0]?.present === true;
}

async function selectRows(
  db: SqlRunner,
  target: RotationTarget,
  lock: boolean,
): Promise<Row[]> {
  const cols = target.columns.map(quote).join(', ');
  const rows = await db.query<Record<string, string | null>>(
    `SELECT ${quote(target.idColumn)}::text AS "__id", ${cols} FROM ${quote(target.table)}${target.where ? ` WHERE ${target.where}` : ''} ORDER BY ${quote(target.idColumn)}${lock ? ' FOR UPDATE' : ''}`,
  );
  return rows as Row[];
}

function emptyReport(target: RotationTarget, present: boolean): TargetReport {
  return {
    name: target.name,
    present,
    rows: 0,
    empty: 0,
    pending: 0,
    rotated: 0,
    unreadable: [],
    changed: 0,
  };
}

function inspect(
  target: RotationTarget,
  rows: Row[],
  oldKey: DerivedKey | null,
  newKey: DerivedKey,
): { report: TargetReport; states: Map<string, ColumnState[]> } {
  const report = emptyReport(target, true);
  const states = new Map<string, ColumnState[]>();
  for (const row of rows) {
    report.rows += 1;
    const perColumn = target.columns.map((column) =>
      classify(row[column] ?? null, oldKey, newKey),
    );
    states.set(row.__id, perColumn);
    if (perColumn.includes('unreadable')) report.unreadable.push(row.__id);
    else if (perColumn.includes('old')) report.pending += 1;
    else if (perColumn.includes('new')) report.rotated += 1;
    else report.empty += 1;
  }
  return { report, states };
}

/** Read-only: classifies every value and reports what an apply would do. */
export async function planRotation(
  db: SqlRunner,
  targets: RotationTarget[],
  keys: RotationKeys,
): Promise<TargetReport[]> {
  const oldKey = keys.oldSecret ? deriveKey(keys.oldSecret) : null;
  const newKey = deriveKey(keys.newSecret);
  const reports: TargetReport[] = [];
  for (const target of targets) {
    if (!(await tablePresent(db, target))) {
      if (!target.optional)
        throw new Error(`Required table is missing: ${target.table}`);
      reports.push(emptyReport(target, false));
      continue;
    }
    reports.push(
      inspect(target, await selectRows(db, target, false), oldKey, newKey)
        .report,
    );
  }
  return reports;
}

/** Everything must open with the incoming key alone: the check to run after the old key is retired. */
export async function verifyRotation(
  db: SqlRunner,
  targets: RotationTarget[],
  keys: Pick<RotationKeys, 'newSecret'>,
): Promise<TargetReport[]> {
  const reports = await planRotation(db, targets, {
    oldSecret: null,
    newSecret: keys.newSecret,
  });
  const failures = reports.filter(
    (r) => r.unreadable.length > 0 || r.pending > 0,
  );
  if (failures.length > 0) {
    throw new VerificationError(
      `Verification failed for ${failures.map((r) => r.name).join(', ')}: ${failures.reduce((n, r) => n + r.unreadable.length, 0)} value(s) do not open with the new key.`,
    );
  }
  return reports;
}

/** All-or-nothing re-encryption. Repeating it after success changes nothing. */
export async function applyRotation(
  db: SqlRunner,
  targets: RotationTarget[],
  keys: RotationKeys & { oldSecret: string },
): Promise<TargetReport[]> {
  if (keys.oldSecret === keys.newSecret) {
    throw new Error(
      'The old and the new key are identical: nothing to rotate.',
    );
  }
  const oldKey = deriveKey(keys.oldSecret);
  const newKey = deriveKey(keys.newSecret);

  return db.transaction(async (tx) => {
    const reports: TargetReport[] = [];
    const work: Array<{
      target: RotationTarget;
      rows: Row[];
      states: Map<string, ColumnState[]>;
    }> = [];

    // Lock and classify everything first: an unreadable value anywhere aborts before the first write.
    for (const target of targets) {
      if (!(await tablePresent(tx, target))) {
        if (!target.optional)
          throw new Error(`Required table is missing: ${target.table}`);
        reports.push(emptyReport(target, false));
        continue;
      }
      const rows = await selectRows(tx, target, true);
      const { report, states } = inspect(target, rows, oldKey, newKey);
      reports.push(report);
      work.push({ target, rows, states });
    }
    if (reports.some((r) => r.unreadable.length > 0))
      throw new UnreadableValuesError(reports);

    for (const { target, rows, states } of work) {
      const report = reports.find(
        (r) => r.name === target.name,
      ) as TargetReport;
      for (const row of rows) {
        const perColumn = states.get(row.__id) ?? [];
        if (!perColumn.includes('old')) continue;

        const plaintexts: Record<string, string | null> = {};
        const sets: string[] = [];
        const params: unknown[] = [];
        const guards: string[] = [];
        target.columns.forEach((column, index) => {
          const state = perColumn[index];
          const current = row[column] ?? null;
          if (state === 'empty') {
            plaintexts[column] = null;
            return;
          }
          const plaintext = open(
            state === 'old' ? oldKey : newKey,
            current as string,
          );
          plaintexts[column] = plaintext;
          if (state === 'new') return;
          const sealed = seal(newKey, plaintext);
          if (open(newKey, sealed) !== plaintext) {
            throw new VerificationError(
              `Round-trip check failed for ${target.name} row ${row.__id}.`,
            );
          }
          params.push(sealed);
          sets.push(`${quote(column)} = $${params.length}`);
          params.push(current);
          guards.push(`${quote(column)} = $${params.length}`);
        });
        for (const [column, value] of Object.entries(
          target.derive?.(plaintexts, { newSecret: keys.newSecret }) ?? {},
        )) {
          params.push(value);
          sets.push(`${quote(column)} = $${params.length}`);
        }
        params.push(row.__id);
        const written = await tx.execute(
          `UPDATE ${quote(target.table)} SET ${sets.join(', ')} WHERE ${quote(target.idColumn)}::text = $${params.length} AND ${guards.join(' AND ')}`,
          params,
        );
        if (written !== 1) {
          throw new VerificationError(
            `Concurrent change detected on ${target.name} row ${row.__id}; nothing was committed.`,
          );
        }
        report.changed += 1;
      }

      // Read back inside the same transaction: every value must now open with the incoming key.
      const after = inspect(
        target,
        await selectRows(tx, target, false),
        oldKey,
        newKey,
      ).report;
      if (after.pending > 0 || after.unreadable.length > 0) {
        throw new VerificationError(
          `Post-write check failed for ${target.name}; nothing was committed.`,
        );
      }
    }
    return reports;
  });
}
