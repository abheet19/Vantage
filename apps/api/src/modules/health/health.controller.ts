/**
 * health.controller.ts — `GET /health`: both pools, the migration version, the boot self-test.
 *
 * Why it exists: design §1.3's honesty rule applies to the process too. "The database is down" and
 * "everything is fine" must never look alike, so a failed pool check is a 503 whose body is the same
 * facts plus `{ code: 'UNHEALTHY', message }` carrying the driver's error text (this route is
 * loopback-only ⟨D4⟩; the text is for the operator, and the web renders it as an error card, not an
 * empty dashboard). The self-test result is the one computed at boot — it is what the process is
 * running under, not a fresh probe.
 *
 * What it must never do: return 200 with a partial body, or run anything heavier than `SELECT 1`
 * on each pool — health is polled.
 */
import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import pg from 'pg';
import { DatabaseLifecycle } from '../../infra/database.module.js';
import type { MigrationStatus } from '../../infra/migration-runner.js';
import type { SelfTestResult } from '../../infra/self-test.js';
import { PG_RO, PG_RW } from '../../infra/tokens.js';

export interface HealthBody {
  ok: boolean;
  pools: { rw: 'up' | 'down'; ro: 'up' | 'down' };
  migration: MigrationStatus | null;
  self_test: SelfTestResult | null;
}

async function probe(pool: pg.Pool): Promise<string | null> {
  try {
    await pool.query('SELECT 1');
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PG_RW) private readonly rw: pg.Pool,
    @Inject(PG_RO) private readonly ro: pg.Pool,
    @Inject(DatabaseLifecycle) private readonly lifecycle: DatabaseLifecycle,
  ) {}

  @Get()
  async health(): Promise<HealthBody> {
    const [rwErr, roErr] = await Promise.all([probe(this.rw), probe(this.ro)]);
    const body: HealthBody = {
      ok: rwErr === null && roErr === null && this.lifecycle.selfTest?.ok === true,
      pools: { rw: rwErr === null ? 'up' : 'down', ro: roErr === null ? 'up' : 'down' },
      migration: this.lifecycle.migration,
      self_test: this.lifecycle.selfTest,
    };
    if (!body.ok) {
      const message = [rwErr && `rw: ${rwErr}`, roErr && `ro: ${roErr}`].filter(Boolean).join('; ') || 'boot self-test did not pass';
      throw new HttpException({ code: 'UNHEALTHY', message, ...body }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
