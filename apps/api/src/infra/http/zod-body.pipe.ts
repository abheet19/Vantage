/**
 * zod-body.pipe.ts — the body pipe: one Zod schema per `@Body({ schema })`, three Vantage decisions on top.
 *
 * Why it exists: Nest 12 validates `@Body({ schema })` through Standard Schema, which is exactly the
 * "one Zod schema is the DTO" rule from design §0 A5, but its stock pipe makes three choices that are
 * wrong for this API. (1) It silently deletes `__proto__`/`constructor`/`prototype` keys before
 * validating; LLD §9 requires a hostile key to be *rejected with the index*, not laundered, so this pipe
 * hands the raw body to the schema and `JsonObject` reports the key at its path. (2) Its error is a 400
 * with flat strings; Vantage answers `{ code, message, path, index? }` — 422 naming the failing field
 * (and the event's index in a batch), or 413 `BATCH_TOO_LARGE` when the batch itself has more than 500
 * events — so a client can fix the one thing instead of guessing. (3) A bad query spec is a different
 * fact from a bad ingest body — LLD §5 names it `INVALID_SPEC` so a model or an MCP client can
 * self-correct in one round — and the pipe knows which it is from the schema it was given; a bad query
 * string (`GET /v1/asks?limit=abc`) is `INVALID_QUERY` for the same reason (S3).
 *
 * What it must never do: mutate the body, or let a validation failure through as anything other than a
 * 4xx — a 500 here would mean validation happened too late.
 */
import { type ArgumentMetadata, HttpException, HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { isQuerySpecSchema } from '@vantage/contracts';

export type BodyErrorCode = 'INVALID_BODY' | 'INVALID_SPEC' | 'INVALID_QUERY';

export interface ValidationErrorBody {
  code: BodyErrorCode | 'BATCH_TOO_LARGE';
  message: string;
  path: string;
  /** Present when the failing field belongs to one event of a batch: `events[index]`. */
  index?: number;
}

/** Standard Schema promises only `message` and `path`; Zod's issues also carry `code` and, for a strict object, the smuggled `keys`. */
type Issue = StandardSchemaV1.Issue & { code?: string; keys?: readonly string[] };

/** The issue's path as strings; an unrecognised key is reported at the key itself, not at the object that refused it. */
function segmentsOf(issue: Issue): string[] {
  const base = (issue.path ?? []).map((p) => (typeof p === 'object' && p !== null && 'key' in p ? p.key : p)).map(String);
  const smuggled = issue.code === 'unrecognized_keys' ? issue.keys?.[0] : undefined;
  return smuggled === undefined ? base : [...base, smuggled];
}

/** Maps Standard Schema issues to the LLD's error shape; exported so tests can pin the mapping. */
export function issueToHttpException(issues: readonly StandardSchemaV1.Issue[], code: BodyErrorCode = 'INVALID_BODY'): HttpException {
  const tooManyEvents = (issues as readonly Issue[]).find((i) => i.code === 'too_big' && segmentsOf(i).join('.') === 'events');
  if (tooManyEvents) {
    const body: ValidationErrorBody = { code: 'BATCH_TOO_LARGE', message: tooManyEvents.message, path: 'events' };
    return new HttpException(body, HttpStatus.PAYLOAD_TOO_LARGE);
  }

  const first = issues[0] as Issue | undefined;
  const segments = first === undefined ? [] : segmentsOf(first);
  const path = segments.join('.');
  const message = first?.message ?? 'invalid body';
  const index = segments[0] === 'events' && segments[1] !== undefined && /^\d+$/.test(segments[1]) ? Number(segments[1]) : undefined;
  const body: ValidationErrorBody = index === undefined ? { code, message, path } : { code, message, path, index };
  return new HttpException(body, HttpStatus.UNPROCESSABLE_ENTITY);
}

/** A bad query spec, a bad query string and a bad body are three different facts (LLD §5, S3); the pipe knows which from the schema and the parameter kind. */
function codeFor(metadata: ArgumentMetadata): BodyErrorCode {
  if (isQuerySpecSchema(metadata.schema)) return 'INVALID_SPEC';
  return metadata.type === 'query' ? 'INVALID_QUERY' : 'INVALID_BODY';
}

@Injectable()
export class ZodBodyPipe implements PipeTransform {
  /** Parameters without a schema (custom decorators such as `@CurrentProject()`) pass through untouched. */
  async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const schema = metadata.schema;
    if (!schema) return value;
    const result = await schema['~standard'].validate(value);
    if (result.issues) throw issueToHttpException(result.issues, codeFor(metadata));
    return result.value;
  }
}
