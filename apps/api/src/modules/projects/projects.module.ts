/**
 * projects.module.ts — wires ProjectsService, ApiKeyGuard and the controller (LLD §1.1).
 *
 * Why it exists: the guard is exported alongside the service so IngestModule can protect its routes
 * without knowing how keys are stored.
 *
 * What it must never do: import IngestModule or IdentityModule (the dependency points the other way).
 */
import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ApiKeyGuard],
  exports: [ProjectsService, ApiKeyGuard],
})
export class ProjectsModule {}
