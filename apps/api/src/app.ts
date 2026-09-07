/**
 * app.ts — the application module and the HTTP setup shared by `main.ts` and every integration test.
 *
 * Why it exists: if the tests configured the body parser, the validation pipe or the error filter
 * differently from production, a green suite would prove nothing about the running API. So there is
 * one `configureApp` and one `AppModule.forRoot`, and both entrypoints call them. The JSON body limit
 * is 40 MB because a legal batch is up to 500 events × 64 KiB; anything larger is a 413 from the parser
 * before a byte of it is parsed.
 *
 * The LLM adapter is chosen by the `llm` argument (S3) for the same reason: `main.ts` passes what
 * `loadConfig` read, tests pass nothing and override the port. The `queryToken` and `adminToken` arguments
 * are threaded the same way into `AuthModule.forRoot`, which decides whether the read routes and the
 * project-admin write routes are open ⟨D4⟩ or gated (independently).
 *
 * What it must never do: register a route, or read the environment (config arrives as an argument).
 */
import { Module, type DynamicModule } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ANTHROPIC_DEFAULT_MODEL, OLLAMA_DEFAULT_MODEL, OLLAMA_DEFAULT_NUM_CTX, type LlmConfig } from './infra/config.js';
import { DatabaseModule, type DatabaseOptions } from './infra/database.module.js';
import { HttpErrorFilter } from './infra/http/http-error.filter.js';
import { ZodBodyPipe } from './infra/http/zod-body.pipe.js';
import { AskModule } from './modules/ask/ask.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { IngestModule } from './modules/ingest/ingest.module.js';
import { InsightsModule } from './modules/insights/insights.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';

/** 500 events × 64 KiB of properties, plus envelope. */
const JSON_BODY_LIMIT = '40mb';

/** No model unless the operator configured one; tests override the port itself. */
export const DEFAULT_LLM: LlmConfig = { adapter: 'none', ollamaModel: OLLAMA_DEFAULT_MODEL, ollamaNumCtx: OLLAMA_DEFAULT_NUM_CTX, anthropicModel: ANTHROPIC_DEFAULT_MODEL, anthropicApiKey: undefined };

@Module({})
export class AppModule {
  static forRoot(db: DatabaseOptions, llm: LlmConfig = DEFAULT_LLM, queryToken?: string, adminToken?: string): DynamicModule {
    return {
      module: AppModule,
      imports: [AuthModule.forRoot(queryToken, adminToken), DatabaseModule.forRoot(db), ProjectsModule, IdentityModule, IngestModule, InsightsModule, EventsModule, AuditModule, AskModule.forRoot(llm), HealthModule],
    };
  }
}

export function configureApp(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT, strict: true });
  app.useGlobalPipes(new ZodBodyPipe());
  app.useGlobalFilters(new HttpErrorFilter());
}
