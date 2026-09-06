/**
 * projects.spec.ts — a project's key is shown once, its timezone is one PostgreSQL knows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashApiKey } from '../../src/domain/index.js';
import { createTestApp, type TestApp } from '../helpers/app.js';
import { intlRejectedZone } from '../helpers/timezones.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('POST /v1/projects', () => {
  it('creates a project and returns the API key exactly once, storing only its sha256', async () => {
    const res = await t.http.post('/v1/projects').send({ name: 'Acme', timezone: 'Asia/Kolkata' }).expect(201);
    expect(res.body).toMatchObject({ name: 'Acme', timezone: 'Asia/Kolkata' });
    expect(res.body.api_key).toMatch(/^vk_[A-Za-z0-9_-]{32}$/);
    expect(res.body.project_id).toMatch(/^[0-9a-f-]{36}$/);
    const stored = await t.owner.query<{ api_key_hash: string }>('SELECT api_key_hash FROM projects WHERE project_id = $1', [res.body.project_id]);
    expect(stored.rows[0]?.api_key_hash).toBe(hashApiKey(res.body.api_key));
    expect(stored.rows[0]?.api_key_hash).not.toContain(res.body.api_key);
  });

  it('rejects a timezone PostgreSQL does not know with 422 INVALID_TIMEZONE', async () => {
    const res = await t.http.post('/v1/projects').send({ name: 'x', timezone: 'Mars/Olympus_Mons' }).expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_TIMEZONE', path: 'timezone' });
  });

  it('rejects a timezone PostgreSQL knows but Intl does not (Factory, posixrules, …) with 422 INVALID_TIMEZONE naming Intl — such a project could never be asked a question (S3 hardening)', async () => {
    const zone = await intlRejectedZone(t);
    const res = await t.http.post('/v1/projects').send({ name: 'x', timezone: zone }).expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_TIMEZONE', path: 'timezone', message: expect.stringContaining('Intl.DateTimeFormat') });
    expect(res.body.message).toContain(zone);
  });

  it('rejects a body that fails the contract with 422 and the path', async () => {
    const res = await t.http.post('/v1/projects').send({ name: '', timezone: 'UTC' }).expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_BODY', path: 'name' });
  });

  it('rejects a timezone shaped like SQL — it is a parameter, never interpolated', async () => {
    const res = await t.http.post('/v1/projects').send({ name: 'x', timezone: "UTC'); DROP TABLE projects; --" }).expect(422);
    expect(res.body.code).toBe('INVALID_TIMEZONE');
    const still = await t.owner.query(`SELECT to_regclass('public.projects') AS r`);
    expect(still.rows[0].r).toBe('projects');
  });
});

describe('POST /v1/projects/:id/rotate-key', () => {
  it('mints a new key shown once, replaces the stored hash, and invalidates the old key', async () => {
    const created = await t.createProject('Rotates', 'UTC');
    const before = await t.owner.query<{ api_key_hash: string }>('SELECT api_key_hash FROM projects WHERE project_id = $1', [created.project_id]);

    const res = await t.http.post(`/v1/projects/${created.project_id}/rotate-key`).send().expect(200);
    expect(res.body.project_id).toBe(created.project_id);
    expect(res.body.api_key).toMatch(/^vk_[A-Za-z0-9_-]{32}$/);
    expect(res.body.api_key).not.toBe(created.api_key);

    const after = await t.owner.query<{ api_key_hash: string }>('SELECT api_key_hash FROM projects WHERE project_id = $1', [created.project_id]);
    expect(after.rows[0]?.api_key_hash).toBe(hashApiKey(res.body.api_key));
    expect(after.rows[0]?.api_key_hash).not.toBe(before.rows[0]?.api_key_hash);

    // the old key no longer authenticates ingest; the new one does
    await t.http.post('/v1/events').set('authorization', `Bearer ${created.api_key}`).send({ events: [{ event: 'signup', distinct_id: 'u1', insert_id: 'e1' }] }).expect(401);
    await t.http.post('/v1/events').set('authorization', `Bearer ${res.body.api_key}`).send({ events: [{ event: 'signup', distinct_id: 'u1', insert_id: 'e1' }] }).expect(200);
  });

  it('is 404 for an unknown project id and for a malformed one, without touching the uuid column', async () => {
    await t.http.post('/v1/projects/00000000-0000-4000-8000-000000000000/rotate-key').send().expect(404);
    const res = await t.http.post('/v1/projects/not-a-uuid/rotate-key').send().expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('GET /v1/projects', () => {
  it('lists projects without any key or hash', async () => {
    const created = await t.createProject('Listed', 'UTC');
    const res = await t.http.get('/v1/projects').expect(200);
    const row = (res.body as Record<string, unknown>[]).find((p) => p['project_id'] === created.project_id);
    expect(row).toEqual({ project_id: created.project_id, name: 'Listed', timezone: 'UTC', created_at: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toMatch(/api_key/);
  });
});
