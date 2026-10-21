import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import {
  codeFromNumber,
  HR_CODE_NUMBER_MAX,
  HR_RESERVED_MAX,
  HR_STANDARD_START,
} from './hr-register.util';

type Tx = Prisma.TransactionClient;

/**
 * The single place an employee code is chosen. It serializes on the SAME advisory lock the legacy
 * AdminEmployeeManagementService has always used, and looks at the union of register persons and employee
 * profiles, so two admins, an offer and a direct account creation can never mint the same number. A number is
 * taken only by a committed row; rows are never deleted or edited (DB triggers), so no number is ever reused.
 */
@Injectable()
export class HrCodeAllocator {
  async lock(tx: Tx): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fastque_employee_code'))`;
  }

  /** Next standard (101+) number. The caller must hold the lock (call `lock` first, in the same transaction). */
  async nextStandard(tx: Tx): Promise<{ number: number; code: string }> {
    const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
      SELECT GREATEST(
        COALESCE((SELECT MAX("codeNumber") FROM "hr_persons"), 0),
        COALESCE((SELECT MAX(substr("employeeCode", 7)::int) FROM "employee_profiles" WHERE "employeeCode" ~ '^FQ-FE-[0-9]{5}$'), 0)
      )::int AS "max"`;
    const next = Math.max(HR_STANDARD_START, (rows[0]?.max ?? 0) + 1);
    if (next > HR_CODE_NUMBER_MAX) {
      throw new AppException(
        'HR_CODE_SPACE_EXHAUSTED',
        'The five-digit employee ID space is exhausted.',
        HttpStatus.CONFLICT,
      );
    }
    return { number: next, code: codeFromNumber(next) };
  }

  /** Reserved block (1-100), owner-controlled: the number must be free in BOTH tables. */
  async assertReservedFree(
    tx: Tx,
    value: number,
  ): Promise<{ number: number; code: string }> {
    if (!Number.isInteger(value) || value < 1 || value > HR_RESERVED_MAX) {
      throw new AppException(
        'EMPLOYEE_RESERVED_ID_INVALID',
        'Reserved employee number must be between 1 and 100.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const code = codeFromNumber(value);
    const [person, profile] = await Promise.all([
      tx.hrPerson.findUnique({
        where: { employeeCode: code },
        select: { id: true },
      }),
      tx.employeeProfile.findUnique({
        where: { employeeCode: code },
        select: { id: true },
      }),
    ]);
    if (person || profile) {
      throw new AppException(
        'EMPLOYEE_RESERVED_ID_TAKEN',
        `${code} is already assigned.`,
        HttpStatus.CONFLICT,
      );
    }
    return { number: value, code };
  }
}
