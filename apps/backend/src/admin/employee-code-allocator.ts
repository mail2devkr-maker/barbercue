import { HttpStatus } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { EMPLOYEE_STANDARD_ID_START } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';

/**
 * The same transaction lock and non-cycling sequence are used by offer issuance and ordinary
 * employee provisioning. The SQL namespace guard also protects overlap with older API instances.
 */
export async function lockEmployeeCodeNamespace(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fastque_employee_code'))`;
}

export async function allocateNextEmployeeCode(
  tx: Prisma.TransactionClient,
): Promise<string> {
  await lockEmployeeCodeNamespace(tx);

  // nextval is non-transactional: a failed request may create a gap, but can never recycle an ID.
  // Skip any code reserved by a legacy profile or an offer-only identity during rollout overlap.
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const rows = await tx.$queryRaw<Array<{ employeeNumber: bigint }>>`
      SELECT nextval('employee_code_sequence') AS "employeeNumber"
    `;
    const employeeNumber = Number(rows[0]?.employeeNumber);
    if (
      !Number.isSafeInteger(employeeNumber) ||
      employeeNumber < EMPLOYEE_STANDARD_ID_START
    ) {
      throw new AppException(
        'EMPLOYEE_ID_SEQUENCE_INVALID',
        'The employee ID allocator is unavailable.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const employeeCode = `FQ-FE-${String(employeeNumber).padStart(5, '0')}`;
    const [profile, identity] = await Promise.all([
      tx.employeeProfile.findUnique({
        where: { employeeCode },
        select: { id: true },
      }),
      tx.employeeIdentity.findUnique({
        where: { employeeCode },
        select: { id: true },
      }),
    ]);
    if (!profile && !identity) return employeeCode;
  }

  throw new AppException(
    'EMPLOYEE_ID_SEQUENCE_EXHAUSTED',
    'The employee ID allocator could not reserve a unique code.',
    HttpStatus.CONFLICT,
  );
}

export function reservedEmployeeCode(employeeNumber: number): string {
  return `FQ-FE-${String(employeeNumber).padStart(5, '0')}`;
}
