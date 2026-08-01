import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/** Marks an endpoint as requiring an Idempotency-Key header, enforced by IdempotencyInterceptor. */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
