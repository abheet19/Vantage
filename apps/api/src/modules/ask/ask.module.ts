/**
 * ask.module.ts — wires the boundary (LLD §1.1 AskModule): the port, the adapter name, the service, the route.
 *
 * Why it exists: design §6.3 — this directory holds the only import of any LlmPort adapter, and the
 * adapter is chosen here, once, from the configuration `main.ts` read (`createLlm`). Everything else the
 * ask path needs arrives as an exported service from a module that owns the trust: `AuditModule` writes
 * the log through the app role, `InsightsModule` compiles and runs through the reader, `EventsModule`
 * reads the catalog through the reader. None of the pool tokens is mentioned in this directory, and
 * `tools/lint-deps.mjs` fails the build if one ever is (V7d). Tests keep this wiring and override
 * `LLM_PORT` with a scripted adapter.
 *
 * What it must never do: import `PG_RW`, `pg`, IngestModule or IdentityModule, or provide a second port.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import type { LlmConfig } from '../../infra/config.js';
import { LLM_ADAPTER, LLM_PORT } from '../../infra/llm/port.js';
import { createLlm } from '../../infra/llm/select.js';
import { AuditModule } from '../audit/audit.module.js';
import { EventsModule } from '../events/events.module.js';
import { InsightsModule } from '../insights/insights.module.js';
import { AskController } from './ask.controller.js';
import { AskService } from './ask.service.js';

@Module({})
export class AskModule {
  static forRoot(llm: LlmConfig): DynamicModule {
    return {
      module: AskModule,
      imports: [AuditModule, EventsModule, InsightsModule],
      controllers: [AskController],
      providers: [AskService, { provide: LLM_PORT, useFactory: () => createLlm(llm) }, { provide: LLM_ADAPTER, useValue: llm.adapter }],
    };
  }
}
