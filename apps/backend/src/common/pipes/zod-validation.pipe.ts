import {
  HttpStatus,
  Injectable,
  PipeTransform,
  type ArgumentMetadata,
} from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppException } from '../exceptions/app.exception';

/**
 * Validates request bodies against a zod schema imported from @barbercue/shared — the same
 * schema the web/mobile clients use for form validation, so the rules never drift between server
 * and client (the server is still the sole authority; clients validating too is just UX).
 *
 * Defense in depth against a real bug this exact pipe caused across 8 endpoints: NestJS's
 * `@UsePipes()` at the METHOD level (as opposed to attaching the pipe directly to `@Body()` or
 * `@Query()`) runs on every decorated parameter, not just the one the schema is actually meant
 * for — so a handler like `respond(@CurrentUser() user, @Param('id') id, @Body() body)` would
 * also run this pipe on `id` (a plain string) and `user` (an object with the wrong shape), both
 * of which legitimately fail `schema.safeParse(...)` since neither is the body. Every one of
 * those call sites has been moved to the correct `@Body(new ZodValidationPipe(...))` attachment,
 * but metadata.type is checked here too so a future method-scoped `@UsePipes()` degrades to a
 * harmless no-op on 'param'/'custom' parameters instead of silently breaking the endpoint again.
 * 'query' stays validated: two existing routes (city/salon search) legitimately validate
 * `@Query()` this way, with no other decorated parameter to collide with.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, unknown> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'param' || metadata.type === 'custom') return value;
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Request validation failed',
        HttpStatus.BAD_REQUEST,
        {
          issues: result.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
      );
    }
    return result.data;
  }
}
