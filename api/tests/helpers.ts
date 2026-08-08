import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

if (!process.env.DATABASE_URL && process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
process.env.JWT_ISSUER = process.env.JWT_ISSUER ?? 'community-resource-platform';
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? 'community-resource-web';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? 'http://localhost:3000';

const databaseUrl = process.env.DATABASE_URL_TEST;
const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL_TEST;
if (!databaseUrl || !migrationDatabaseUrl) {
  throw new Error('Both DATABASE_URL_TEST and MIGRATION_DATABASE_URL_TEST must point at disposable Postgres databases');
}

export async function resetDatabase() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(here, '../db/001_init.sql');
  const schemaSql = await readFile(schemaPath, 'utf-8');

  const client = new Client({ connectionString: migrationDatabaseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.query(schemaSql);
  } finally {
    await client.end();
  }
}

export function getDbClient() {
  return new Client({ connectionString: databaseUrl });
}

export function getMigrationDbClient() {
  return new Client({ connectionString: migrationDatabaseUrl });
}

export async function startServer() {
  const { buildApp } = await import('../src/app.js');
  const app = buildApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('Server did not bind');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: async () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function postJson(baseUrl: string, pathName: string, body: Record<string, unknown>, token?: string) {
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

export async function getJson(baseUrl: string, pathName: string, token?: string) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return { response, parsed };
}

export async function deleteJson(baseUrl: string, pathName: string, token?: string) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: 'DELETE',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return { response, parsed };
}

export async function putJson(baseUrl: string, pathName: string, body: Record<string, unknown>, token?: string) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: 'PUT',
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
