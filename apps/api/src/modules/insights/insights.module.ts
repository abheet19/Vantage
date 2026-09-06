/**
 * insights.module.ts — wires the query path (LLD §1.1 InsightsModule).
 *
 * Why it exists: this module is the whole read side of the API — the compilers, the runner on the
 * read-only pool, and the three routes. Keeping it apart from IngestModule is what makes "the query path
 * cannot write" a module edge: nothing here asks for `PG_RW`, and `tools/lint-deps.mjs` forbids it from
 * ever importing an LlmPort. `QueryRunner` is stateless (a pool and a clock, both global), so each module
 * that reads as the reader provides its own instance rather than importing the query path for it.
 *
 * `InsightsService` is exported for AskModule (S3), which depends on it and never the reverse. The
 * timezone lookup is `CatalogService`'s `timezoneIn` (one lookup for every reader), imported as a
 * function — EventsModule stays free of any import of this module.
 *
 * What it must never do: import IngestModule, IdentityModule or AskModule.
 */
import { Module } from '@nestjs/common';
import { QueryRunner } from '../../infra/query-runner.js';
import { InsightsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';

@Module({
  controllers: [InsightsController],
  providers: [InsightsService, QueryRunner],
  exports: [InsightsService],
})
export class InsightsModule {}
