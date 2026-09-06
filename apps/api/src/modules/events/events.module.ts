/**
 * events.module.ts — the event catalog as a module of its own (LLD §3.4; E27 in LLD §11).
 *
 * Why it exists: the LLD left the catalog route to "modules/events or inside insights". It is its own
 * module because two callers with opposite trust need it — AskModule feeds it to a model, and S4's
 * McpModule hands it to an MCP client — and neither should have to import the query path to get it.
 * It reads only through the reader role, inside `QueryRunner.readOnly` (its own stateless instance of the
 * runner: a pool and a clock, both global), and exports one service.
 *
 * What it must never do: import AskModule or InsightsModule, or grow a write.
 */
import { Module } from '@nestjs/common';
import { QueryRunner } from '../../infra/query-runner.js';
import { CatalogService } from './catalog.service.js';
import { EventsController } from './events.controller.js';

@Module({
  controllers: [EventsController],
  providers: [CatalogService, QueryRunner],
  exports: [CatalogService],
})
export class EventsModule {}
