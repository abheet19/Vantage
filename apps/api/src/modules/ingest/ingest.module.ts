/**
 * ingest.module.ts — wires the write path (LLD §1.1 IngestModule).
 *
 * Why it exists: ingest is the module that holds the write pool and the API-key guard; keeping it
 * separate from the (future) insights module is what makes "the query path cannot write" visible as a
 * module edge rather than a convention.
 *
 * What it must never do: import anything from `modules/insights` or `modules/ask` once they exist.
 */
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { IngestController } from './ingest.controller.js';
import { IngestService } from './ingest.service.js';

@Module({
  imports: [ProjectsModule, IdentityModule],
  controllers: [IngestController],
  providers: [IngestService],
})
export class IngestModule {}
