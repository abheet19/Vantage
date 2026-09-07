/**
 * auth.module.ts — provides the shared read/admin tokens and their guards to the whole app.
 *
 * Why it exists: `QueryTokenGuard` (read routes: insights, ask, events, audit) and `AdminTokenGuard`
 * (project-admin write routes: create project, rotate key) are applied with `@UseGuards` on controllers
 * that live in their own modules; a `@Global` module is the one place that makes the guards and their
 * `QUERY_TOKEN` / `ADMIN_TOKEN` values resolvable from all of them without each importing this. The tokens
 * arrive as arguments (`main.ts` passes what `loadConfig` read; tests pass their own or nothing), so this
 * file never reads the environment. The two tokens are independent of each other and of the per-project
 * ingest key (`ApiKeyGuard`).
 *
 * What it must never do: read `process.env`, or apply a guard itself — where each applies is a decision
 * each controller makes visible with `@UseGuards`, so the boundary is readable at the route.
 */
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ADMIN_TOKEN, QUERY_TOKEN } from '../../infra/tokens.js';
import { AdminTokenGuard } from './admin-token.guard.js';
import { QueryTokenGuard } from './query-token.guard.js';

@Global()
@Module({})
export class AuthModule {
  /**
   * `queryToken` unset (or empty) leaves the read routes open ⟨D4⟩; a string requires it as a Bearer on
   * them. `adminToken` does the same, independently, for the two project-admin write routes.
   */
  static forRoot(queryToken: string | undefined, adminToken?: string | undefined): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        { provide: QUERY_TOKEN, useValue: queryToken },
        { provide: ADMIN_TOKEN, useValue: adminToken },
        QueryTokenGuard,
        AdminTokenGuard,
      ],
      exports: [QUERY_TOKEN, ADMIN_TOKEN, QueryTokenGuard, AdminTokenGuard],
    };
  }
}
