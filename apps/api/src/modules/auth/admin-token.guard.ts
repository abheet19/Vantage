/**
 * admin-token.guard.ts — the env-flagged shared-bearer gate on the project-ADMIN WRITE routes
 * (`POST /v1/projects` create, `POST /v1/projects/:id/rotate-key`).
 *
 * Why it exists: project administration is unauthenticated by design ⟨D4⟩ — the API binds to loopback and
 * these routes have no users (design A4). Hosting the dashboard on a public URL breaks that assumption, so
 * a public deployment would otherwise be an open project-admin surface (anyone could create projects or
 * rotate a project's ingest key). `VANTAGE_ADMIN_TOKEN` closes that gap without changing the loopback
 * default: unset (`undefined`) ⇒ the two write routes stay open, today's exact behaviour; set ⇒ each
 * requires `Authorization: Bearer <that token>` and answers 401 `INVALID_ADMIN_TOKEN` (the standard
 * `{ code, message }` shape the error filter passes through) for a missing or wrong one.
 *
 * It is a single shared ADMIN token for the whole instance, INDEPENDENT of both the shared READ token
 * `VANTAGE_QUERY_TOKEN` (`QueryTokenGuard`, the analytics read surface) and the per-project ingest key
 * (`ApiKeyGuard`). The compare is constant-time over the SHA-256 of each side (reusing `sameToken`, so it
 * never leaks the token's length and never throws on a length mismatch), and the token is never logged.
 *
 * What it must never do: be applied to ingest, identify, the read/insights/ask/audit/events routes, the
 * `GET /v1/projects` list route (it exposes only project ids/names, needed by the dashboard) or `/health`;
 * read a token from the body or a query string; or default to closed when the env is unset (the loopback
 * default must not change).
 */
import { type CanActivate, type ExecutionContext, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ADMIN_TOKEN } from '../../infra/tokens.js';
import { BEARER } from '../projects/api-key.guard.js';
import { sameToken } from './query-token.guard.js';

@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(@Optional() @Inject(ADMIN_TOKEN) private readonly token: string | undefined) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.token) return true; // unset/empty ⇒ open, exactly as before ⟨D4⟩.
    const req = context.switchToHttp().getRequest<Request>();
    const presented = BEARER.exec(req.headers.authorization ?? '')?.[1];
    if (!presented || !sameToken(presented, this.token)) {
      throw new UnauthorizedException({ code: 'INVALID_ADMIN_TOKEN', message: 'a valid admin token is required: Authorization: Bearer <VANTAGE_ADMIN_TOKEN>' });
    }
    return true;
  }
}
