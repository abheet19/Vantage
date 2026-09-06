/**
 * http-error-filter.spec.ts — every error leaves as { code, message }: client faults are 4xx, a lost race is 409 RETRY, server faults are a fixed 500.
 */
import { type ArgumentsHost, BadRequestException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import 'reflect-metadata';
import { beforeAll, describe, expect, it } from 'vitest';
import { HttpErrorFilter } from '../../src/infra/http/http-error.filter.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

function fakeHost() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  return { host, sent };
}

const caught = (exception: unknown) => {
  const { host, sent } = fakeHost();
  new HttpErrorFilter().catch(exception, host);
  return sent;
};

describe('HttpErrorFilter', () => {
  it('passes an HttpException that already carries a code through with its status and body', () => {
    expect(caught(new HttpException({ code: 'X', message: 'm' }, 422))).toEqual({ status: 422, body: { code: 'X', message: 'm' } });
  });

  it('wraps a string HttpException body in the standard shape', () => {
    expect(caught(new HttpException('nope', 404))).toEqual({ status: 404, body: { code: 'ERROR', message: 'nope' } });
  });

  it("reshapes Nest's built-in 404 { statusCode, message, error } into { code: NOT_FOUND, message }", () => {
    expect(caught(new NotFoundException('Cannot POST /v1/sql'))).toEqual({ status: 404, body: { code: 'NOT_FOUND', message: 'Cannot POST /v1/sql' } });
  });

  it('maps an oversized body from the parser to 413 BODY_TOO_LARGE', () => {
    expect(caught(Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413 }))).toEqual({
      status: 413,
      body: { code: 'BODY_TOO_LARGE', message: 'request entity too large' },
    });
  });

  it("reshapes the BadRequestException Nest's adapter makes out of the parser's JSON SyntaxError into { code: BAD_REQUEST, message }", () => {
    expect(caught(new BadRequestException('Unexpected end of JSON input'))).toEqual({ status: 400, body: { code: 'BAD_REQUEST', message: 'Unexpected end of JSON input' } });
  });

  it('maps a PostgreSQL deadlock (40P01) and a serialization failure (40001) to 409 RETRY without echoing the pg message', () => {
    for (const code of ['40P01', '40001']) {
      const sent = caught(Object.assign(new Error('deadlock detected: Process 1 waits for ShareLock on transaction 2'), { code }));
      expect(sent.status).toBe(409);
      expect(sent.body).toEqual({ code: 'RETRY', message: expect.stringMatching(/again/) });
      expect(JSON.stringify(sent.body)).not.toMatch(/deadlock|ShareLock/);
    }
  });

  it('answers any other PostgreSQL error, and any unknown error, with a fixed 500 body that never echoes the message', () => {
    expect(caught(Object.assign(new Error('new row violates check constraint "events_properties_check"'), { code: '23514' }))).toEqual({
      status: 500,
      body: { code: 'INTERNAL', message: 'internal error' },
    });
    expect(caught(new Error('relation "events" does not exist: secret detail'))).toEqual({ status: 500, body: { code: 'INTERNAL', message: 'internal error' } });
  });

  it('survives a non-Error throwable and a null', () => {
    expect(caught('a string was thrown').status).toBe(500);
    expect(caught(null).status).toBe(500);
  });
});
