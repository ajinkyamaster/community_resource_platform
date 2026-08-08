import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, startServer, postJson, deleteJson, getMigrationDbClient } from './helpers.js';

test('Ownership transfer rules', async (t) => {
  await resetDatabase();
  const { baseUrl, close } = await startServer();

  t.after(async () => {
    await close();
  });

  let ownerToken: string, ownerId: string;
  let userToken: string, userId: string;
  let groupId: string;

  await t.test('Setup users and group', async () => {
    const u1 = await postJson(baseUrl, '/api/auth/signup', { email: 'owner@example.com', password: 'password123' });
    ownerToken = u1.parsed.access_token;
    ownerId = u1.parsed.user.id;

    const u2 = await postJson(baseUrl, '/api/auth/signup', { email: 'user@example.com', password: 'password123' });
    userToken = u2.parsed.access_token;
    userId = u2.parsed.user.id;

    const groupCreate = await postJson(baseUrl, '/api/groups', { name: 'Ownership Group' }, ownerToken);
    groupId = groupCreate.parsed.id;

    // Join and approve
    const joinReq = await postJson(baseUrl, `/api/groups/${groupId}/join-requests`, {}, userToken);
    const approve = await postJson(baseUrl, `/api/groups/${groupId}/join-requests/${joinReq.parsed.id}/approve`, {}, ownerToken);
    assert.equal(approve.response.status, 200);
  });

  await t.test('21. Owner cannot exit group or delete account while owning', async () => {
    const exit = await deleteJson(baseUrl, `/api/groups/${groupId}/members/me`, ownerToken);
    assert.equal(exit.response.status, 403, 'Owner should not be able to exit');
    assert.match(exit.parsed.message, /transfer ownership/, 'Error message should clearly explain why');

    const del = await deleteJson(baseUrl, '/api/users/me', ownerToken);
    assert.equal(del.response.status, 403, 'Owner should not be able to delete account');
    assert.match(del.parsed.message, /transfer ownership/i, 'Error message should clearly explain why');
  });

  await t.test('20. Transfer ownership to another member works correctly', async () => {
    const transfer = await postJson(baseUrl, `/api/groups/${groupId}/transfer-ownership/${userId}`, {}, ownerToken);
    assert.equal(transfer.response.status, 200, 'Transfer should succeed');

    const db = getMigrationDbClient();
    await db.connect();
    try {
      const gmNewOwner = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
      assert.equal(gmNewOwner.rows[0].role, 'owner', 'New user should be owner');

      const gmOldOwner = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, ownerId]);
      assert.equal(gmOldOwner.rows[0].role, 'admin', 'Old owner should be demoted to admin');

      const allOwners = await db.query("SELECT COUNT(*) as count FROM group_members WHERE group_id = $1 AND role = 'owner'", [groupId]);
      assert.equal(allOwners.rows[0].count, '1', 'There must be exactly one owner');
    } finally {
      await db.end();
    }
  });

  await t.test('22. After transfer, former owner can successfully exit group or delete account', async () => {
    const exit = await deleteJson(baseUrl, `/api/groups/${groupId}/members/me`, ownerToken);
    assert.equal(exit.response.status, 204, 'Former owner (now admin) can exit group');

    const db = getMigrationDbClient();
    await db.connect();
    try {
      const res = await db.query('SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, ownerId]);
      assert.equal(res.rowCount, 0, 'Former owner should be removed from group');
    } finally {
      await db.end();
    }
    
    const del = await deleteJson(baseUrl, '/api/users/me', ownerToken);
    assert.equal(del.response.status, 204, 'Former owner can delete their account completely');
  });
});
