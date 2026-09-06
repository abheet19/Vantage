/**
 * mcp.module.ts — wires the MCP surface (LLD §1.1 `McpModule`) and the root the stdio process boots.
 *
 * Why it exists: `McpModule` is the eight tools over the query path and the catalog — it imports
 * `InsightsModule` and `EventsModule` and nothing that writes, so "the MCP surface cannot write" is a
 * module edge, and a unit test holds the whole directory to it (no `PG_RW`, no `pg`, no LlmPort, no
 * `infra/llm`). `McpRootModule` is what `mcp.ts` boots: the database module (whose `onModuleInit` runs the
 * same migration check and boot self-test the HTTP API runs) plus `McpModule` — no HTTP, no AskModule, no
 * model adapter, because the MCP client's own model does the English → spec step (design A2) and this
 * process must be fully usable with no LLM key of its own.
 *
 * What it must never do: import IngestModule, IdentityModule, AskModule or AuditModule, or accept an
 * `LlmConfig`.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { DatabaseModule, type DatabaseOptions } from '../../infra/database.module.js';
import { QueryRunner } from '../../infra/query-runner.js';
import { EventsModule } from '../events/events.module.js';
import { InsightsModule } from '../insights/insights.module.js';
import { MCP_OPTIONS, type McpOptions } from './mcp-options.js';
import { McpReads } from './mcp-reads.js';
import { McpServerFactory } from './mcp-server.factory.js';
import { McpTools } from './mcp-tools.js';
import { PlanReader } from './plan-reader.js';

@Module({})
export class McpModule {
  static forRoot(options: McpOptions): DynamicModule {
    return {
      module: McpModule,
      imports: [InsightsModule, EventsModule],
      // QueryRunner is not exported by InsightsModule (its service is the query path's front door); the module's own reads get their own instance over the same read-only pool.
      providers: [{ provide: MCP_OPTIONS, useValue: options }, QueryRunner, McpReads, PlanReader, McpTools, McpServerFactory],
      exports: [McpServerFactory],
    };
  }
}

/** The stdio process's root: two pools with the boot self-test, and the tools. Nothing else is constructed. */
@Module({})
export class McpRootModule {
  static forRoot(db: DatabaseOptions, options: McpOptions): DynamicModule {
    return { module: McpRootModule, imports: [DatabaseModule.forRoot(db), McpModule.forRoot(options)] };
  }
}
