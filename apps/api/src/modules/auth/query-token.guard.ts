/**
 * query-token.guard.ts — the env-flagged shared-bearer gate on the READ routes (insights, ask, events, audit).
 *
 * Why it exists: the query side is unauthenticated by design ⟨D4⟩ — the API binds to loopback and the
 * read routes have no users (design A4). Hosting the dashboard on a public URL breaks that assumption, so
 * `VANTAGE_QUERY_TOKEN` closes the gap without changing the loopback default: unset (`undefined`) ⇒ the
 * routes stay open, today's exact behaviour; set ⇒ every read route requires `Authorization: Bearer <that
 * token>` and answers 401 `INVALID_QUERY_TOKEN` (the standard `{ code, message }` shape the error filter
 * passes through) for a missing or wrong one. It is a single shared READ token for the whole instance, not
 * a project key — ingest keeps its own per-project `ApiKeyGuard`, and the two are independent.
 *
 * The compare is constant-time over the SHA-256 of each side (fixed 32 bytes, so it never leaks the
 * token's length and never throws on a length mismatch the way a raw `timingSafeEqual` would), and the
 * token is never logged.
 *
 * What it must never do: be applied to ingest (that would replace its per-project key with one shared
 * token), read a token from the body or a query string, or default to closed when the env is unset (the
 * loopback default must not change).
 */
import { type CanActivate, type ExecutionContext, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { QUERY_TOKEN } from '../../infra/tokens.js';
import { BEARER } from '../projects/api-key.guard.js';

/** Constant-time equality that neither leaks length nor throws on unequal lengths: compare fixed-width digests. */
function sameToken(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

@Injectable()
export class QueryTokenGuard implements CanActivate {
  constructor(@Optional() @Inject(QUERY_TOKEN) private readonly token: string | undefined) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.token) return true; // unset/empty ⇒ open, exactly as before ⟨D4⟩.
    const req = context.switchToHttp().getRequest<Request>();
    const presented = BEARER.exec(req.headers.authorization ?? '')?.[1];
    if (!presented || !sameToken(presented, this.token)) {
      throw new UnauthorizedException({ code: 'INVALID_QUERY_TOKEN', message: 'a valid query token is required: Authorization: Bearer <VANTAGE_QUERY_TOKEN>' });
    }
    return true;
  }
}
