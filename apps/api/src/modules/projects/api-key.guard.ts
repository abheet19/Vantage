/**
 * api-key.guard.ts — the only place an API key is checked (design §6.1), used by ingest routes only ⟨D4⟩.
 *
 * Why it exists: ingest is the one write surface a client reaches, and the project it writes into is
 * decided by the key, never by a body field — so a client cannot write into another project by naming
 * it. The guard resolves `Authorization: Bearer <key>` to a project and attaches it to the request for
 * `@CurrentProject()`. A missing, malformed or unknown key is one 401 with one message: distinguishing
 * "unknown" from "malformed" would tell an attacker which keys are well-formed.
 *
 * What it must never do: accept a project id from the body or a query string, or be applied to the
 * query routes (they are local-only and unauthenticated by design ⟨D4⟩).
 */
import { type CanActivate, createParamDecorator, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ProjectsService, type ProjectRef } from './projects.service.js';

export type RequestWithProject = Request & { project?: ProjectRef };

const BEARER = /^Bearer\s+(\S+)$/i;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithProject>();
    const match = BEARER.exec(req.headers.authorization ?? '');
    const project = match?.[1] ? await this.projects.findByApiKey(match[1]) : null;
    if (!project) {
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'a valid project API key is required: Authorization: Bearer <key>' });
    }
    req.project = project;
    return true;
  }
}

/** The project the guard resolved. Only meaningful on routes that use `ApiKeyGuard`; undefined elsewhere is a programming error, so it throws. */
export const CurrentProject = createParamDecorator((_data: unknown, ctx: ExecutionContext): ProjectRef => {
  const project = ctx.switchToHttp().getRequest<RequestWithProject>().project;
  if (!project) throw new Error('@CurrentProject() used on a route without ApiKeyGuard');
  return project;
});
