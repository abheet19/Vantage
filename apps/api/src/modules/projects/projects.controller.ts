/**
 * projects.controller.ts — `POST /v1/projects`, `GET /v1/projects` (LLD §3.4); thin by rule.
 *
 * Why it exists: an operator needs a project (and its one-time key) before anything can be ingested.
 * These routes are unauthenticated because the API binds to loopback ⟨D4⟩; the controller only
 * validates the body against the contract and hands it to the service.
 *
 * What it must never do: contain logic — validation is the schema's, timezone checking and key
 * minting are the service's — or expose `api_key_hash`.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { CreateProjectBody, type ProjectCreated, type ProjectRow, type RotateKeyResponse } from '@vantage/contracts';
import { ProjectsService } from './projects.service.js';

@Controller('v1/projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Post()
  create(@Body({ schema: CreateProjectBody }) body: CreateProjectBody): Promise<ProjectCreated> {
    return this.projects.create(body);
  }

  @Get()
  list(): Promise<ProjectRow[]> {
    return this.projects.list();
  }

  // Rotate a project's ingest key: mints a new key and returns it once (200, not 201 — no resource is created).
  // The old key stops working; the stored key is never revealed because only its sha256 exists (projects.ts).
  @Post(':id/rotate-key')
  @HttpCode(200)
  rotateKey(@Param('id') id: string): Promise<RotateKeyResponse> {
    return this.projects.rotateKey(id);
  }
}
