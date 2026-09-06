/**
 * health.module.ts — the `/health` route (LLD §1.1 HealthModule).
 *
 * Why it exists: a separate module so the UI's error card and CI's smoke check have one dependency-free
 * endpoint that reports the state of the process.
 *
 * What it must never do: depend on any business module; it reads the database layer only.
 */
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController] })
export class HealthModule {}
