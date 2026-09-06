/**
 * http-error.filter.ts — one shape for every error the API returns, and a 4xx for every client fault.
 *
 * Why it exists: every error leaves as `{ code, message, … }`, whoever raised it. Nest's built-in
 * exceptions carry `{ statusCode, message, error }` and are reshaped with the label as the code: the 404
 * for an unknown route becomes `NOT_FOUND`, and a body that is not JSON — which Nest's adapter turns into
 * its own `BadRequestException` before any filter runs — becomes `BAD_REQUEST`. Express's body parser
 * throws plain errors for a body that is too large or wrongly encoded; those are client faults and must
 * be 413 / 415 / 400, because LLD §9 treats "any 500" on hostile input as the signal that validation ran
 * too late. A statement that lost a race PostgreSQL detected (deadlock 40P01,
 * serialization failure 40001) was rolled back whole and can simply be retried, so it is a 409 `RETRY`,
 * not a fault. Genuine server faults are logged with their stack and answered with a fixed
 * `{ code: 'INTERNAL' }` — never the pg message, which can carry table names and values.
 *
 * What it must never do: echo an internal error message to the client, or change the body of an
 * `HttpException` that already carries a `code` (the pipe, the guard and the health route chose theirs).
 */
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

interface ErrorLike {
  type?: string;
  message?: string;
  /** pg's SQLSTATE on a DatabaseError. */
  code?: string;
}

const BODY_PARSER_STATUS: Record<string, { status: number; code: string }> = {
  'entity.too.large': { status: HttpStatus.PAYLOAD_TOO_LARGE, code: 'BODY_TOO_LARGE' },
  'encoding.unsupported': { status: HttpStatus.UNSUPPORTED_MEDIA_TYPE, code: 'UNSUPPORTED_ENCODING' },
  'charset.unsupported': { status: HttpStatus.UNSUPPORTED_MEDIA_TYPE, code: 'UNSUPPORTED_CHARSET' },
  'entity.verify.failed': { status: HttpStatus.BAD_REQUEST, code: 'INVALID_BODY' },
  'request.aborted': { status: HttpStatus.BAD_REQUEST, code: 'REQUEST_ABORTED' },
  'request.size.invalid': { status: HttpStatus.BAD_REQUEST, code: 'INVALID_CONTENT_LENGTH' },
};

/** SQLSTATEs where PostgreSQL rolled the statement back because it lost a race it can win on retry. */
const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set(['40P01', '40001']);

/** A Vantage exception already carries `code`; a Nest built-in carries `{ statusCode, message, error }` and gets its `error` label as the code. */
function bodyOf(exception: HttpException): Record<string, unknown> {
  const body = exception.getResponse();
  if (typeof body === 'string') return { code: 'ERROR', message: body };
  const raw = body as Record<string, unknown>;
  if (typeof raw['code'] === 'string') return raw;
  const label = typeof raw['error'] === 'string' ? raw['error'] : HttpStatus[exception.getStatus()] ?? 'ERROR';
  const message = Array.isArray(raw['message']) ? raw['message'].join('; ') : String(raw['message'] ?? label);
  return { code: label.toUpperCase().replace(/\W+/g, '_'), message };
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(bodyOf(exception));
      return;
    }

    const error = (exception ?? {}) as ErrorLike;
    const parser = error.type === undefined ? undefined : BODY_PARSER_STATUS[error.type];
    if (parser) {
      res.status(parser.status).json({ code: parser.code, message: error.message ?? error.type });
      return;
    }
    if (error.code !== undefined && RETRYABLE_SQLSTATES.has(error.code)) {
      this.logger.warn(`statement rolled back with ${error.code}; answered 409 RETRY`);
      res.status(HttpStatus.CONFLICT).json({ code: 'RETRY', message: 'the request lost a race with a concurrent write and was rolled back whole; send it again' });
      return;
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ code: 'INTERNAL', message: 'internal error' });
  }
}
