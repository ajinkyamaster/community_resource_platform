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

async function deleteJson(baseUrl: string, pathName: string, token: string) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return { response, parsed };
}

test('join requests and admin/owner roles behave correctly', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(here, '../db/001_init.sql');
  const schemaSql = await readFile(schemaPath, 'utf-8');

  const seedClient = new Client({ connectionString: databaseUrl });
  await seedClient.connect();
  try {
    await seedClient.query(schemaSql);
    await seedClient.query('truncate table group_join_requests, resources, group_members, groups, users restart identity cascade');
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
    // Owner creates group
    const owner = await postJson(baseUrl, '/api/auth/signup', { email: 'owner2@example.com', password: 'password' });
    assert.equal(owner.response.status, 201);
    const ownerToken = owner.parsed.access_token as string;

    const groupCreate = await postJson(baseUrl, '/api/groups', { name: 'Role Test Group' }, ownerToken);
    assert.equal(groupCreate.response.status, 201);
    const groupId = groupCreate.parsed.id as string;

    // User A requests to join
    const userA = await postJson(baseUrl, '/api/auth/signup', { email: 'usera@example.com', password: 'password' });
    assert.equal(userA.response.status, 201);
    const tokenA = userA.parsed.access_token as string;

    const joinReq = await postJson(baseUrl, `/api/groups/${groupId}/join-requests`, {}, tokenA);
    assert.equal(joinReq.response.status, 201, 'join request should be creatable');

    // Pending request does not grant access
    const readAttempt = await getJson(baseUrl, `/api/groups/${groupId}/resources`, tokenA);
    assert.equal(readAttempt.response.status, 404, 'pending requester should not see group resources');

    // Regular member (not admin) cannot approve
    const userB = await postJson(baseUrl, '/api/auth/signup', { email: 'userb@example.com', password: 'password' });
    assert.equal(userB.response.status, 201);
    const tokenB = userB.parsed.access_token as string;

    const pendingListByB = await postJson(baseUrl, `/api/groups/${groupId}/join-requests`, {}, tokenB);
    // user B created a join request for themselves; trying to approve should fail
    const allPendingAsB = await fetch(`${baseUrl}/api/groups/${groupId}/join-requests`, { headers: { authorization: `Bearer ${tokenB}` } });
    assert.notEqual(allPendingAsB.status, 200, 'non-admin should not list pending requests');

    // Owner approves user A
    // Find request id
    const pendingAsOwner = await fetch(`${baseUrl}/api/groups/${groupId}/join-requests`, { headers: { authorization: `Bearer ${ownerToken}` } });
    const pendingData = await pendingAsOwner.json();
    assert(pendingData.length >= 1, 'owner should see pending requests');
    const reqId = pendingData.find((r: any) => r.user_id === userA.parsed.user.id).id;

    const approve = await postJson(baseUrl, `/api/groups/${groupId}/join-requests/${reqId}/approve`, {}, ownerToken);
    assert.equal(approve.response.status, 200);

    // Now user A can access resources (create and list)
    const createResource = await postJson(baseUrl, `/api/groups/${groupId}/resources`, { url_or_file_ref: 'https://example.com/a', title: 'A res' }, tokenA);
    assert.equal(createResource.response.status, 201);

    const listA = await getJson(baseUrl, `/api/groups/${groupId}/resources`, tokenA);
    assert.equal(listA.response.status, 200);

    // Owner promotes user A to admin
    const promote = await postJson(baseUrl, `/api/groups/${groupId}/members/${userA.parsed.user.id}/promote`, {}, ownerToken);
    assert.equal(promote.response.status, 200);

    // As admin (user A) create user C's join request and approve it
    const userC = await postJson(baseUrl, '/api/auth/signup', { email: 'userc@example.com', password: 'password' });
    assert.equal(userC.response.status, 201);
    const tokenC = userC.parsed.access_token as string;
    const reqC = await postJson(baseUrl, `/api/groups/${groupId}/join-requests`, {}, tokenC);
    assert.equal(reqC.response.status, 201);

    // Admin (user A) approves
    // fetch pending as admin
    const pendingAsAdmin = await fetch(`${baseUrl}/api/groups/${groupId}/join-requests`, { headers: { authorization: `Bearer ${tokenA}` } });
    const pendingAdminData = await pendingAsAdmin.json();
    const reqCId = pendingAdminData.find((r: any) => r.user_id === userC.parsed.user.id).id;
    const approveByAdmin = await postJson(baseUrl, `/api/groups/${groupId}/join-requests/${reqCId}/approve`, {}, tokenA);
    assert.equal(approveByAdmin.response.status, 200);

    // Attempt: admin tries to demote owner at DB level — should fail due to trigger
    const dbClient = new Client({ connectionString: databaseUrl });
    await dbClient.connect();
    try {
      // set the session user to admin (userA) and attempt an update that demotes the owner
      await dbClient.query(`select set_config('app.user_id', $1, true)`, [userA.parsed.user.id]);
      let threw = false;
      try {
        await dbClient.query("update group_members set role = 'member' where group_id = $1 and role = 'owner'", [groupId]);
      } catch (err: any) {
        threw = true;
      }
      assert.equal(threw, true, 'DB should prevent demoting the owner');
    } finally {
      await dbClient.end();
    }

    // Owner can demote other admins
    const demoteByOwner = await postJson(baseUrl, `/api/groups/${groupId}/members/${userA.parsed.user.id}/demote`, {}, ownerToken);
    assert.equal(demoteByOwner.response.status, 200);

    // Self-exit for non-owner member removes membership but not resources
    const selfExit = await deleteJson(baseUrl, `/api/groups/${groupId}/members/me`, tokenA);
    assert.equal(selfExit.response.status, 204);
    const stillVisibleResources = await getJson(baseUrl, `/api/groups/${groupId}/resources`, tokenA);
    assert.equal(stillVisibleResources.response.status, 404, 'self-exited member should lose access');

    // Admin/owner cannot remove owner via kick or demote
    const kickOwner = await deleteJson(baseUrl, `/api/groups/${groupId}/members/${userA.parsed.user.id}`, ownerToken);
    assert.equal(kickOwner.response.status, 403);
    const demoteOwner = await postJson(baseUrl, `/api/groups/${groupId}/members/${owner.parsed.user.id}/demote`, {}, tokenA);
    assert.equal(demoteOwner.response.status, 403);

    // Transfer ownership to user C and then allow owner exit/account deletion behavior
    const transfer = await postJson(baseUrl, `/api/groups/${groupId}/transfer-ownership/${userC.parsed.user.id}`, {}, ownerToken);
    assert.equal(transfer.response.status, 200);

    const membersAfterTransfer = await fetch(`${baseUrl}/api/groups/${groupId}/members`, { headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal(membersAfterTransfer.status, 200);
    const membersJson = await membersAfterTransfer.json();
    const ownerRow = membersJson.find((row: any) => row.user_id === userC.parsed.user.id);
    assert.equal(ownerRow.role, 'owner');

    const priorOwnerRow = membersJson.find((row: any) => row.user_id === owner.parsed.user.id);
    assert.equal(priorOwnerRow.role, 'admin');

    const priorOwnerExit = await deleteJson(baseUrl, `/api/groups/${groupId}/members/me`, ownerToken);
    assert.equal(priorOwnerExit.response.status, 204);

    const deleteOldOwner = await deleteJson(baseUrl, '/api/users/me', ownerToken);
    assert.equal(deleteOldOwner.response.status, 204);

    // Account deletion should anonymize uploaded resources rather than delete them
    const afterDeleteResourceRead = await getJson(baseUrl, `/api/groups/${groupId}/resources`, userC.parsed.access_token ?? tokenA);
    assert.equal(afterDeleteResourceRead.response.status, 200);
    assert.equal(afterDeleteResourceRead.parsed[0].uploaded_by, null);

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
