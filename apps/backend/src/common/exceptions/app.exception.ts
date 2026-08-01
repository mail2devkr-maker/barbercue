import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Every deliberate, expected error in this API is thrown as an AppException so the response body
 * always matches API.md's convention: `{ error: { code, message, details? } }`, with `code` the
 * stable machine-readable string clients branch on — never `message`.
 */
export class AppException extends HttpException {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
    this.code = code;
    this.message = message;
    this.details = details;
  }
}
