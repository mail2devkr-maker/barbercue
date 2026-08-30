import { z } from 'zod';
import type { ArgumentMetadata } from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';
import { ZodValidationPipe } from './zod-validation.pipe';

const bodyMeta: ArgumentMetadata = { type: 'body' };
const queryMeta: ArgumentMetadata = { type: 'query' };
const paramMeta: ArgumentMetadata = { type: 'param', data: 'salonId' };
const customMeta: ArgumentMetadata = { type: 'custom', data: undefined };

const schema = z.object({ evidenceNotes: z.string().optional() });

describe('ZodValidationPipe', () => {
  it('validates and returns a body value matching the schema', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform({ evidenceNotes: 'hello' }, bodyMeta)).toEqual({
      evidenceNotes: 'hello',
    });
  });

  it('throws VALIDATION_ERROR for a body value that fails the schema', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(() => pipe.transform({ evidenceNotes: 5 }, bodyMeta)).toThrow(
      AppException,
    );
  });

  it('validates a query value matching the schema (city/salon search use this)', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform({ evidenceNotes: 'q' }, queryMeta)).toEqual({
      evidenceNotes: 'q',
    });
  });

  // Regression test: a method-scoped @UsePipes() runs this pipe on every decorated parameter,
  // not just @Body(). Before this fix, a plain route-param string (e.g. salonId from
  // @Param('salonId')) or the @CurrentUser() object was run through the same body/query schema
  // and always failed — breaking shop/staff verification submit, owner review response, admin
  // verification decide, language preference, premium dev-activate, and review create/update.
  it('passes a param value through unchanged even though it fails the schema', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform('some-salon-id', paramMeta)).toBe('some-salon-id');
  });

  it('passes a custom-decorator value (e.g. @CurrentUser()) through unchanged', () => {
    const pipe = new ZodValidationPipe(schema);
    const user = { id: 'u1', roles: ['SALON_OWNER'] };
    expect(pipe.transform(user, customMeta)).toBe(user);
  });
});
