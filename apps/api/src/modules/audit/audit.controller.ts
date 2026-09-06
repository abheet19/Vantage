/**
 * audit.controller.ts — `GET /v1/asks?project=&limit=` (LLD §3.4): the Ask history, newest first.
 *
 * Why it exists: design §4.2 L4 says the audit log is browsable — it is what the operator hands a
 * reviewer. The query string is validated against `AsksQuery` the way bodies are validated against their
 * schemas (a bad `limit` is 422 `INVALID_QUERY`), and the cap of 200 rows is the contract's, not a
 * default the handler could forget.
 *
 * What it must never do: filter, redact or reshape rows — the log is shown as written.
 */
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AsksQuery, type AskRow } from '@vantage/contracts';
import { QueryTokenGuard } from '../auth/query-token.guard.js';
import { AuditService } from './audit.service.js';

@Controller('v1')
@UseGuards(QueryTokenGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get('asks')
  recent(@Query({ schema: AsksQuery }) query: AsksQuery): Promise<AskRow[]> {
    return this.audit.recent(query.project, query.limit);
  }
}
