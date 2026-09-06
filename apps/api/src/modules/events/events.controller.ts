/**
 * events.controller.ts — `GET /v1/events/catalog?project=` (LLD §3.4); thin by rule.
 *
 * Why it exists: the catalog is read by the ask path in-process, but the web's Events view (S5) and a
 * curious operator need it over HTTP too. The query string is validated against `CatalogQuery`; an
 * unknown project is an empty catalog, not a 404 (no enumeration).
 *
 * What it must never do: accept a body, or expose anything the service did not compute.
 */
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { CatalogQuery, type EventCatalog } from '@vantage/contracts';
import { QueryTokenGuard } from '../auth/query-token.guard.js';
import { CatalogService } from './catalog.service.js';

@Controller('v1/events')
@UseGuards(QueryTokenGuard)
export class EventsController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('catalog')
  catalogOf(@Query({ schema: CatalogQuery }) query: CatalogQuery): Promise<EventCatalog> {
    return this.catalog.catalog(query.project);
  }
}
