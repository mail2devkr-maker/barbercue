import { HttpStatus, Injectable } from '@nestjs/common';
import type { MaintenanceStatusDto } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';

const DEFAULT_MAINTENANCE_MESSAGE =
  'FastQue is temporarily unavailable for scheduled maintenance. Please try again shortly.';
const MAX_MAINTENANCE_MESSAGE_LENGTH = 500;

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

export interface MaintenanceConfiguration {
  enabled: boolean;
  message: string | null;
}

export function readMaintenanceConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): MaintenanceConfiguration {
  const rawMode = environment.FASTQUE_MAINTENANCE_MODE?.trim().toLowerCase();
  if (rawMode && rawMode !== 'true' && rawMode !== 'false') {
    throw new Error('FASTQUE_MAINTENANCE_MODE must be true or false');
  }

  const enabled = rawMode === 'true';
  const configuredMessage = environment.FASTQUE_MAINTENANCE_MESSAGE?.trim();
  if (
    configuredMessage &&
    configuredMessage.length > MAX_MAINTENANCE_MESSAGE_LENGTH
  ) {
    throw new Error(
      `FASTQUE_MAINTENANCE_MESSAGE must be at most ${MAX_MAINTENANCE_MESSAGE_LENGTH} characters`,
    );
  }

  return {
    enabled,
    message: enabled ? configuredMessage || DEFAULT_MAINTENANCE_MESSAGE : null,
  };
}

export function isFastQueMaintenanceEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return readMaintenanceConfiguration(environment).enabled;
}

@Injectable()
export class MaintenanceModeService {
  private readonly configuration = readMaintenanceConfiguration();

  isEnabled(): boolean {
    return this.configuration.enabled;
  }

  getStatus(): MaintenanceStatusDto {
    return {
      enabled: this.configuration.enabled,
      message: this.configuration.message,
    };
  }

  assertDatabaseOperationAllowed(operation: string): void {
    if (!this.configuration.enabled || READ_OPERATIONS.has(operation)) return;

    throw new AppException(
      'MAINTENANCE_MODE',
      this.configuration.message ?? DEFAULT_MAINTENANCE_MESSAGE,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
