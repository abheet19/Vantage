/**
 * audit.module.ts — wires the audit log (LLD §1.1 AuditModule): the writer, and the history route.
 *
 * Why it exists: the audit row is written by `AuditService` through the app role, and AskModule gets
 * that service by importing this module — not the `PG_RW` token. That import edge is what lets
 * `tools/lint-deps.mjs` hold the ask directory to "never mentions PG_RW, never imports pg" (V7d) while
 * V12 still holds: every ask is logged before it is answered. History is read through the reader inside
 * `QueryRunner.readOnly` (a stateless instance of its own, as every reading module has).
 *
 * What it must never do: export the pools, or import AskModule (the dependency points one way).
 */
import { Module } from '@nestjs/common';
import { QueryRunner } from '../../infra/query-runner.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

@Module({
  controllers: [AuditController],
  providers: [AuditService, QueryRunner],
  exports: [AuditService],
})
export class AuditModule {}
