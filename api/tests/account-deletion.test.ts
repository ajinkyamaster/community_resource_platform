import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, startServer, postJson, deleteJson, getMigrationDbClient } from './helpers.js';

test('Account deletion rules', async (t) => {
  await resetDatabase();
  const { baseUrl, close } = await startServer();

  t.after(async () => {
    await close();
  });

  let ownerToken: string, ownerId: string;
  let userToken: string, userId: string;
  let groupId: string;
  let resourceId: string;

  await t.test('Setup users, group, and resources', async () => {
    const u1 = await postJson(baseUrl, '/api/auth/signup', { email: 'owner@example.com', password: 'password123' });
    ownerToken = u1.parsed.access_token;
    ownerId = u1.parsed.user.id;

    const u2 = await postJson(baseUrl, '/api/auth/signup', { email: 'user@example.com', password: 'password123' });
    userToken = u2.parsed.access_token;
    userId = u2.parsed.user.id;

    const groupCreate = await postJson(baseUrl, '/api/groups', { name: 'Deletion Group' }, ownerToken);
    groupId = groupCreate.parsed.id;

    // Join and approve
    const joinReq = await postJson(baseUrl, `/api/groups/${groupId}/join-requests`, {}, userToken);
    await postJson(baseUrl, `/api/groups/${groupId}/join-requests/${joinReq.parsed.id}/approve`, {}, ownerToken);

    // User uploads a resource
    const resCreate = await postJson(baseUrl, `/api/groups/${groupId}/resources`, {
      url_or_file_ref: 'https://example.com/user-resource',
      title: 'User Resource',
    }, userToken);
    resourceId = resCreate.parsed.id;
  });

  await t.test('26. User who owns a group cannot delete account until ownership transferred', async () => {
    const delOwner = await deleteJson(baseUrl, '/api/users/me', ownerToken);
    assert.equal(delOwner.response.status, 403, 'Owner cannot delete account');
    assert.match(delOwner.parsed.message, /transfer ownership/i);
  });

  await t.test('23. Deleting account removes users row', async () => {
    const delUser = await deleteJson(baseUrl, '/api/users/me', userToken);
    assert.equal(delUser.response.status, 204, 'User deletion should succeed');

    const db = getMigrationDbClient();
    await db.connect();
    try {
      const res = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
      assert.equal(res.rowCount, 0, 'User row should be deleted');
    } finally {
      await db.end();
    }
  });

  await t.test('24. All of that users group_members rows across every group are gone after deletion', async () => {
    const db = getMigrationDbClient();
    await db.connect();
    try {
      const gm = await db.query('SELECT * FROM group_members WHERE user_id = $1', [userId]);
      assert.equal(gm.rowCount, 0, 'No group_members rows should remain for the deleted user');
    } finally {
      await db.end();
    }
  });

  await t.test('25. Resources they uploaded still exist but uploaded_by is anonymized (null)', async () => {
    const db = getMigrationDbClient();
    await db.connect();
    try {
      const res = await db.query('SELECT uploaded_by, title FROM resources WHERE id = $1', [resourceId]);
      assert.equal(res.rowCount, 1, 'Resource should still exist');
      assert.equal(res.rows[0].uploaded_by, null, 'uploaded_by should be anonymized to null');
      assert.equal(res.rows[0].title, 'User Resource', 'Resource data remains intact');
    } finally {
      await db.end();
    }
  });
});
