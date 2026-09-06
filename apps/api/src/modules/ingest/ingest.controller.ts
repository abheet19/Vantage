/**
 * ingest.controller.ts — `POST /v1/events` and `POST /v1/identify` (LLD §3.4); the only authenticated routes.
 *
 * Why it exists: both routes take the project from the API key (guard), the body from the contract
 * (pipe), and hand a validated object to a service. HTTP 200 (not Nest's default 201 for POST) because
 * the LLD's contract says 200 and because an ingest response describes what happened to a batch —
 * `duplicates: 500` is a success, not a creation.
 *
 * What it must never do: read `project_id` from the body, or catch errors (the filter shapes them).
 */
import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { IdentifyBody, type IdentifyResponse, IngestBatch, type IngestResponse } from '@vantage/contracts';
import { IdentityService } from '../identity/identity.service.js';
import { ApiKeyGuard, CurrentProject } from '../projects/api-key.guard.js';
import type { ProjectRef } from '../projects/projects.service.js';
import { IngestService } from './ingest.service.js';

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class IngestController {
  constructor(
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  @Post('events')
  @HttpCode(200)
  events(@CurrentProject() project: ProjectRef, @Body({ schema: IngestBatch }) batch: IngestBatch): Promise<IngestResponse> {
    return this.ingest.ingest(project.project_id, batch);
  }

  @Post('identify')
  @HttpCode(200)
  identify(@CurrentProject() project: ProjectRef, @Body({ schema: IdentifyBody }) body: IdentifyBody): Promise<IdentifyResponse> {
    return this.identity.identify(project.project_id, body.anonymous_id, body.user_id);
  }
}
