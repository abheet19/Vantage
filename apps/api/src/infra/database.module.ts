/**
 * database.module.ts — two pools, two roles, and the refusal to start on the wrong database.
 *
 * Why it exists: LLD §1.1 — `PG_RW` is `vantage_app`, `PG_RO` is `vantage_reader` (max 4), and the
 * module refuses to start unless the live database matches what the code assumes: schema at the
 * version this build was written against, each pool connected as its role, the reader's defaults, and
 * both roles' privileges equal to the allowlist in `self-test.ts`. `onModuleInit` does that, and Nest
 * awaits it before any controller is reachable: pending migrations are applied first when an owner URL
 * is configured (otherwise only verified), then the self-test. A failure throws, `app.init()` rejects,
 * and nothing listens. The results stay on the provider so `/health` can show what was checked.
 *
 * What it must never do: create roles, hand the RW pool to anything that asked for RO, or swallow a
 * failed check into a log line — the process must not come up.
 */
import { Global, Inject, Injectable, Module, type DynamicModule, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { SystemClock } from './clock.js';
import { MigrationRunner, migrationStatus, type MigrationStatus } from './migration-runner.js';
import { runBootSelfTest, type SelfTestResult } from './self-test.js';
import { CLOCK, DATABASE_OPTIONS, PG_RO, PG_RW } from './tokens.js';

export interface DatabaseOptions {
  rwUrl: string;
  roUrl: string;
  /** When set, pending migrations are applied at boot as the owner; when absent the boot only verifies them. */
  ownerUrl?: string | undefined;
  /** The role the owner connection must be; `vantage_owner` when omitted. */
  migrationRole?: string | undefined;
  migrationsDir: string;
}

/** The RO pool is small on purpose: four concurrent 5-second queries is the whole budget the query path may spend. */
export const RO_POOL_MAX = 4;
/** Ingest is bursty but each batch is one statement; ten connections absorb 50 concurrent identical batches (V1) without queueing on the pool. */
export const RW_POOL_MAX = 10;

export function createPool(connectionString: string, max: number): pg.Pool {
  return new pg.Pool({ connectionString, max, connectionTimeoutMillis: 5_000, allowExitOnIdle: true });
}

@Injectable()
export class DatabaseLifecycle implements OnModuleInit, OnModuleDestroy {
  private ended = false;
  selfTest: SelfTestResult | null = null;
  migration: MigrationStatus | null = null;

  constructor(
    @Inject(DATABASE_OPTIONS) private readonly options: DatabaseOptions,
    @Inject(PG_RW) private readonly rw: pg.Pool,
    @Inject(PG_RO) private readonly ro: pg.Pool,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      if (this.options.ownerUrl) {
        await new MigrationRunner(this.options.ownerUrl, this.options.migrationsDir, this.options.migrationRole).run();
      }
      this.migration = await migrationStatus(this.rw, this.options.migrationsDir);
      if (this.migration.pending.length > 0 || this.migration.mismatched.length > 0) {
        throw new Error(
          `schema is not what this build expects: pending [${this.migration.pending.join(', ')}], mismatched [${this.migration.mismatched.join(', ')}]. ` +
            'Run `npm run migrate` with VANTAGE_DATABASE_URL_OWNER set.',
        );
      }
      this.selfTest = await runBootSelfTest(this.rw, this.ro);
      if (!this.selfTest.ok) {
        const failed = this.selfTest.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
        throw new Error(`boot self-test refused to start: ${failed.join('; ')}`);
      }
    } catch (err) {
      await this.onModuleDestroy();
      throw err;
    }
  }

  /** Idempotent: a refused boot ends the pools itself and Nest may still call this on `app.close()`; pg throws on a second `end()`. */
  async onModuleDestroy(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await Promise.allSettled([this.rw.end(), this.ro.end()]);
  }
}

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(options: DatabaseOptions): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        { provide: DATABASE_OPTIONS, useValue: options },
        { provide: PG_RW, useFactory: () => createPool(options.rwUrl, RW_POOL_MAX) },
        { provide: PG_RO, useFactory: () => createPool(options.roUrl, RO_POOL_MAX) },
        { provide: CLOCK, useClass: SystemClock },
        DatabaseLifecycle,
      ],
      exports: [PG_RW, PG_RO, CLOCK, DatabaseLifecycle],
    };
  }
}
