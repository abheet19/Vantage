/**
 * insights.controller.ts — `POST /v1/funnel`, `POST /v1/retention`, `POST /v1/count` (LLD §3.4); thin by rule.
 *
 * Why it exists: each route validates its body against the one spec schema its path names, so a
 * `retention` spec posted to `/v1/funnel` fails at `kind` with 422 `INVALID_SPEC` — the path and the
 * spec must agree, and the error names the field. HTTP 200 even for `timed_out` or `empty`: the status
 * inside the result IS the answer (LLD §3.4), and a 4xx/5xx would let a client confuse "the database
 * refused" with "the request was malformed". No authentication: the API binds to loopback ⟨D4⟩ and the
 * query side has no users (design A4).
 *
 * What it must never do: accept a `QuerySpec` union here (that would let the path and the kind
 * disagree), or contain logic — validation is the schema's, everything else is the service's.
 */
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { CountSpec, type CountResult, FunnelSpec, type FunnelResult, PathsSpec, type PathsResult, RetentionSpec, type RetentionResult, TrendSpec, type TrendResult } from '@vantage/contracts';
import { InsightsService } from './insights.service.js';

@Controller('v1')
export class InsightsController {
  constructor(@Inject(InsightsService) private readonly insights: InsightsService) {}

  @Post('funnel')
  @HttpCode(200)
  funnel(@Body({ schema: FunnelSpec }) spec: FunnelSpec): Promise<FunnelResult> {
    return this.insights.funnel(spec);
  }

  @Post('retention')
  @HttpCode(200)
  retention(@Body({ schema: RetentionSpec }) spec: RetentionSpec): Promise<RetentionResult> {
    return this.insights.retention(spec);
  }

  @Post('trend')
  @HttpCode(200)
  trend(@Body({ schema: TrendSpec }) spec: TrendSpec): Promise<TrendResult> {
    return this.insights.trend(spec);
  }

  @Post('paths')
  @HttpCode(200)
  paths(@Body({ schema: PathsSpec }) spec: PathsSpec): Promise<PathsResult> {
    return this.insights.paths(spec);
  }

  @Post('count')
  @HttpCode(200)
  count(@Body({ schema: CountSpec }) spec: CountSpec): Promise<CountResult> {
    return this.insights.count(spec);
  }
}
