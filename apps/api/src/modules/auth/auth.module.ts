/**
 * auth.module.ts — provides the shared read token and `QueryTokenGuard` to the whole app.
 *
 * Why it exists: `QueryTokenGuard` is applied with `@UseGuards` on the read controllers (insights, ask,
 * events, audit), which live in their own modules; a `@Global` module is the one place that makes the
 * guard and its `QUERY_TOKEN` value resolvable from all of them without each importing this. The token
 * arrives as an argument (`main.ts` passes what `loadConfig` read; tests pass their own or nothing), so
 * this file never reads the environment.
 *
 * What it must never do: read `process.env`, or apply the guard itself — where it applies is a decision
 * each controller makes visible with `@UseGuards`, so the boundary is readable at the route.
 */
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { QUERY_TOKEN } from '../../infra/tokens.js';
import { QueryTokenGuard } from './query-token.guard.js';

@Global()
@Module({})
export class AuthModule {
  /** `queryToken` unset (or empty) leaves the read routes open ⟨D4⟩; a string requires it as a Bearer on them. */
  static forRoot(queryToken: string | undefined): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        { provide: QUERY_TOKEN, useValue: queryToken },
        QueryTokenGuard,
      ],
      exports: [QUERY_TOKEN, QueryTokenGuard],
    };
  }
}
