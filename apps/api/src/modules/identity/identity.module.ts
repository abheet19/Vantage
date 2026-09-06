/**
 * identity.module.ts — exposes IdentityService to IngestModule (LLD §1.1).
 *
 * Why it exists: ingest creates persons for unknown distinct ids and `/v1/identify` merges them; both
 * paths must agree on the locking rule, so both go through one service.
 *
 * What it must never do: own a controller — the HTTP surface for identify lives in IngestModule because
 * it shares the ingest API-key guard.
 */
import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service.js';

@Module({ providers: [IdentityService], exports: [IdentityService] })
export class IdentityModule {}
