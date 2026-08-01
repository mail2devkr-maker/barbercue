import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppException } from '../exceptions/app.exception';

/**
 * Validates request bodies against a zod schema imported from @barbercue/shared — the same
 * schema the web/mobile clients use for form validation, so the rules never drift between server
 * and client (the server is still the sole authority; clients validating too is just UX).
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
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
