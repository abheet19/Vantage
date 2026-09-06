/**
 * ask.controller.ts — `POST /v1/ask` (LLD §3.4); thin by rule.
 *
 * Why it exists: the body is validated against `AskBody` (a 2 001-character question is a 422 before
 * the model is asked, and is not an ask, so it is not audited), and the answer is HTTP 200 whatever the
 * decision — the decision inside the body is the answer (design §4.2), and a status code would let a
 * client confuse "the model refused" with "the request was malformed".
 *
 * What it must never do: contain logic, or reach past the service to a port, a pool or a compiler.
 */
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { AskBody, type AskResponse } from '@vantage/contracts';
import { AskService } from './ask.service.js';

@Controller('v1')
export class AskController {
  constructor(@Inject(AskService) private readonly ask: AskService) {}

  @Post('ask')
  @HttpCode(200)
  answer(@Body({ schema: AskBody }) body: AskBody): Promise<AskResponse> {
    return this.ask.ask(body);
  }
}
