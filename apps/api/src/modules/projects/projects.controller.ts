/**
 * projects.controller.ts — `POST /v1/projects`, `GET /v1/projects`, `POST /v1/projects/:id/rotate-key`
 * (LLD §3.4); thin by rule.
 *
 * Why it exists: an operator needs a project (and its one-time key) before anything can be ingested.
 * These routes are unauthenticated because the API binds to loopback ⟨D4⟩; the controller only
 * validates the body against the contract and hands it to the service. When `VANTAGE_ADMIN_TOKEN` is set
 * (a public deployment), the two WRITE routes — create and rotate-key — require it as a Bearer via
 * `AdminTokenGuard`, so a public read-only demo is not an open project-admin surface. The `GET` list route
 * is deliberately left open: it exposes only project ids/names and the dashboard needs it; and ingest
 * keeps its own independent per-project key.
 *
 * What it must never do: contain logic — validation is the schema's, timezone checking and key
 * minting are the service's — expose `api_key_hash`, or gate the `GET` list route.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { CreateProjectBody, type ProjectCreated, type ProjectRow, type RotateKeyResponse } from '@vantage/contracts';
import { AdminTokenGuard } from '../auth/admin-token.guard.js';
import { ProjectsService } from './projects.service.js';

@Controller('v1/projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  // Project-admin WRITE route: gated by AdminTokenGuard when VANTAGE_ADMIN_TOKEN is set (open otherwise ⟨D4⟩).
  @Post()
  @UseGuards(AdminTokenGuard)
  create(@Body({ schema: CreateProjectBody }) body: CreateProjectBody): Promise<ProjectCreated> {
    return this.projects.create(body);
  }

  // Read route: exposes only project ids/names, needed by the dashboard — deliberately NOT gated.
  @Get()
  list(): Promise<ProjectRow[]> {
    return this.projects.list();
  }

  // Rotate a project's ingest key: mints a new key and returns it once (200, not 201 — no resource is created).
  // The old key stops working; the stored key is never revealed because only its sha256 exists (projects.ts).
  // Project-admin WRITE route: gated by AdminTokenGuard when VANTAGE_ADMIN_TOKEN is set (open otherwise ⟨D4⟩).
  @Post(':id/rotate-key')
  @UseGuards(AdminTokenGuard)
  @HttpCode(200)
  rotateKey(@Param('id') id: string): Promise<RotateKeyResponse> {
    return this.projects.rotateKey(id);
  }
}
