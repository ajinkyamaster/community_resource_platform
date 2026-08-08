import http from 'node:http';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { Client } from 'pg';

if (!process.env.DATABASE_URL && process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
process.env.JWT_ISSUER = process.env.JWT_ISSUER ?? 'community-resource-platform';
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? 'community-resource-web';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? 'http://localhost:3000';

const { buildApp } = await import('../src/app.js');

const databaseUrl = process.env.DATABASE_URL_TEST;

if (!databaseUrl) {
  throw new Error('DATABASE_URL_TEST must point at a disposable Postgres database');
}

async function postJson(baseUrl: string, pathName: string, body: Record<string, unknown>, token?: string) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return { response, parsed };
}

async function getJson(baseUrl: string, pathName: string, token: string) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return { response, parsed };
}

test('HTTP request path enforces tenant isolation through Express middleware and Postgres RLS', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(here, '../db/001_init.sql');
  const schemaSql = await readFile(schemaPath, 'utf-8');

  const seedClient = new Client({ connectionString: databaseUrl });
  await seedClient.connect();
  try {
    await seedClient.query(schemaSql);
    await seedClient.query('truncate table resources, group_members, groups, users restart identity cascade');
  } finally {
    await seedClient.end();
  }

  const app = buildApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object', 'server did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const ownerSignup = await postJson(baseUrl, '/api/auth/signup', {
      email: 'owner-http@example.com',
      password: 'password123',
    });
    assert.equal(ownerSignup.response.status, 201, 'owner signup failed');
    const ownerToken = ownerSignup.parsed.access_token as string;

    const outsiderSignup = await postJson(baseUrl, '/api/auth/signup', {
      email: 'outsider-http@example.com',
      password: 'password123',
    });
    assert.equal(outsiderSignup.response.status, 201, 'outsider signup failed');
    const outsiderToken = outsiderSignup.parsed.access_token as string;

    const groupCreate = await postJson(baseUrl, '/api/groups', { name: 'HTTP Isolation Group' }, ownerToken);
    assert.equal(groupCreate.response.status, 201, 'group creation failed');
    const groupId = groupCreate.parsed.id as string;

    const ownerResourceCreate = await postJson(
      baseUrl,
      `/api/groups/${groupId}/resources`,
      {
        url_or_file_ref: 'https://example.com/owner-resource',
        title: 'Owner resource',
        note: 'created through the HTTP API',
      },
      ownerToken,
    );
    assert.equal(ownerResourceCreate.response.status, 201, 'owner resource upload failed');

    const outsiderRead = await getJson(baseUrl, `/api/groups/${groupId}/resources`, outsiderToken);
    assert.equal(
      outsiderRead.response.status,
      404,
      'outsider read should be hidden with 404 so the API does not reveal whether the group exists',
    );

    const outsiderWrite = await postJson(
      baseUrl,
      `/api/groups/${groupId}/resources`,
      {
        url_or_file_ref: 'https://example.com/outsider-resource',
        title: 'Blocked resource',
        note: null,
      },
      outsiderToken,
    );
    assert.equal(
      outsiderWrite.response.status,
      404,
      'outsider write should be hidden with 404 so the API does not reveal whether the group exists',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});