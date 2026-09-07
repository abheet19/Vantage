/**
 * main.ts — the HTTP entrypoint: read config, build the app, refuse or listen.
 *
 * Why it exists: `node --env-file-if-exists=.env apps/api/dist/main.js` is the whole deployment. It
 * binds to `VANTAGE_BIND` (loopback by default ⟨D4⟩) and logs a warning when that is anything else,
 * because exposing an unauthenticated query surface must be a visible decision. A failed boot
 * (missing env, unreachable database, self-test refusal) prints the reason and exits 1 — the process
 * never half-runs.
 *
 * What it must never do: contain logic that tests cannot reach; everything but `listen` lives in
 * `app.ts`.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import 'reflect-metadata';
import { AppModule, configureApp } from './app.js';
import { loadConfig } from './infra/config.js';

async function main(): Promise<void> {
  const logger = new Logger('vantage');
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot({ rwUrl: config.rwUrl, roUrl: config.roUrl, ownerUrl: config.ownerUrl, migrationRole: config.migrationRole, migrationsDir: config.migrationsDir }, config.llm, config.queryToken, config.adminToken),
    { bodyParser: false },
  );
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(config.port, config.bind);
  const loopback = config.bind === '127.0.0.1' || config.bind === 'localhost' || config.bind === '::1';
  if (!loopback && !config.queryToken) {
    logger.warn(`VANTAGE_BIND=${config.bind} with no VANTAGE_QUERY_TOKEN: the query routes are unauthenticated; only ingest requires an API key. Set VANTAGE_QUERY_TOKEN to require a shared read token, or keep the bind on loopback. Make sure this is deliberate.`);
  }
  if (!loopback && !config.adminToken) {
    logger.warn(`VANTAGE_BIND=${config.bind} with no VANTAGE_ADMIN_TOKEN: the project-admin write routes (POST /v1/projects, POST /v1/projects/:id/rotate-key) are unauthenticated, so anyone reaching the API can create projects or rotate ingest keys. Set VANTAGE_ADMIN_TOKEN to require a shared admin token, or keep the bind on loopback. Make sure this is deliberate.`);
  }
  logger.log(`listening on http://${config.bind}:${config.port}; ask adapter: ${config.llm.adapter}; read routes: ${config.queryToken ? 'require VANTAGE_QUERY_TOKEN' : 'open (loopback by design ⟨D4⟩)'}; project-admin write routes: ${config.adminToken ? 'require VANTAGE_ADMIN_TOKEN' : 'open (loopback by design ⟨D4⟩)'}`);
}

main().catch((err: unknown) => {
  console.error(`vantage api refused to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
