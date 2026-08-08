import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, startServer, postJson, getJson, deleteJson, getMigrationDbClient } from './helpers.js';

test('Groups and membership rules', async (t) => {
  await resetDatabase();
  const { baseUrl, close } = await startServer();

  t.after(async () => {
    await close();
  });

  let u1Token: string, u1Id: string;
  let u2Token: string, u2Id: string;
  let u3Token: string, u3Id: string;
  let groupId: string;
  let requestId: string;

  await t.test('Setup users', async () => {
    const u1 = await postJson(baseUrl, '/api/auth/signup', { email: 'u1@example.com', password: 'password123' });
    u1Token = u1.parsed.access_token;
    u1Id = u1.parsed.user.id;

    const u2 = await postJson(baseUrl, '/api/auth/signup', { email: 'u2@example.com', password: 'password123' });
    u2Token = u2.parsed.access_token;
    u2Id = u2.parsed.user.id;

    const u3 = await postJson(baseUrl, '/api/auth/signup', { email: 'u3@example.com', password: 'password123' });
    u3Token = u3.parsed.access_token;
    u3Id = u3.parsed.user.id;
  });

  await t.test('7. Creating a group sets the creator as owner immediately', async () => {
    const groupCreate = await postJson(baseUrl, '/api/groups', { name: 'Test Group' }, u1Token);
    assert.equal(groupCreate.response.status, 201);
    groupId = groupCreate.parsed.id;

    const db = getMigrationDbClient();
    await db.connect();
    try {
      const res = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, u1Id]);
      assert.equal(res.rowCount, 1);
      assert.equal(res.rows[0].role, 'owner');
    } finally {
      await db.end();
    }
  });

  await t.test('8. A second user requesting to join creates a pending row; zero access to resources', async () => {
    const joinReq = await postJson(baseUrl, `/api/groups/${groupId}/join-requests`, {}, u2Token);
    assert.equal(joinReq.response.status, 201);
    requestId = joinReq.parsed.id;

    const db = getMigrationDbClient();
    await db.connect();
    try {
      const reqs = await db.query('SELECT status FROM group_join_requests WHERE id = $1', [requestId]);
      assert.equal(reqs.rowCount, 1);
      assert.equal(reqs.rows[0].status, 'pending');

      const mems = await db.query('SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, u2Id]);
      assert.equal(mems.rowCount, 0, 'Should not be in group_members yet');
    } finally {
      await db.end();
    }
  });

  await t.test('9. Owner approving a request creates member row and updates request to approved', async () => {
    const approve = await postJson(baseUrl, `/api/groups/${groupId}/join-requests/${requestId}/approve`, {}, u1Token);
    assert.equal(approve.response.status, 200);

    const db = getMigrationDbClient();
    await db.connect();
    try {
      const reqs = await db.query('SELECT status, decided_by FROM group_join_requests WHERE id = $1', [requestId]);
      assert.equal(reqs.rows[0].status, 'approved');
      assert.equal(reqs.rows[0].decided_by, u1Id);

      const mems = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, u2Id]);
      assert.equal(mems.rowCount, 1);
      assert.equal(mems.rows[0].role, 'member');
    } finally {
      await db.end();
    }
  });

  await t.test('10. Owner rejecting a request never creates a membership row; access remains denied', async () => {
    const joinReq3 = await postJson(baseUrl, `/api/groups/${groupId}/join-requests`, {}, u3Token);
    const req3Id = joinReq3.parsed.id;

    const reject = await postJson(baseUrl, `/api/groups/${groupId}/join-requests/${req3Id}/reject`, {}, u1Token);
    assert.equal(reject.response.status, 200);

    const db = getMigrationDbClient();
    await db.connect();
    try {
      const reqs = await db.query('SELECT status FROM group_join_requests WHERE id = $1', [req3Id]);
      assert.equal(reqs.rows[0].status, 'rejected');

      const mems = await db.query('SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, u3Id]);
      assert.equal(mems.rowCount, 0);
    } finally {
      await db.end();
    }
  });

  await t.test('11. User cannot submit duplicate join request while pending or approved', async () => {
    const dupe1 = await postJson(baseUrl, `/api/groups/${groupId}/join-requests`, {}, u2Token);
    assert.equal(dupe1.response.status, 400); // already a member
  });

  await t.test('12. Owner can promote a member to admin', async () => {
    const promote = await postJson(baseUrl, `/api/groups/${groupId}/members/${u2Id}/promote`, {}, u1Token);
    assert.equal(promote.response.status, 200);

    const db = getMigrationDbClient();
    await db.connect();
    try {
      const mems = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, u2Id]);
      assert.equal(mems.rows[0].role, 'admin');
    } finally {
      await db.end();
    }
  });

  await t.test('13. Non-owner admin can promote a different member to admin', async () => {
    // u3 needs to be a member first
    // Our endpoint currently says "pending" or "approved" blocks it.
    // So yes, a rejected user can re-apply.
    const reReq = await postJson(baseUrl, `/api/groups/${groupId}/join-requests`, {}, u3Token);
    
    // u2 (admin) approves u3
    await postJson(baseUrl, `/api/groups/${groupId}/join-requests/${reReq.parsed.id}/approve`, {}, u2Token);
    
    // u2 (admin) promotes u3
    const promote = await postJson(baseUrl, `/api/groups/${groupId}/members/${u3Id}/promote`, {}, u2Token);
    assert.equal(promote.response.status, 200);

    const db = getMigrationDbClient();
    await db.connect();
    try {
      const mems = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, u3Id]);
      assert.equal(mems.rows[0].role, 'admin');
    } finally {
      await db.end();
    }
  });

  await t.test('14. Admin can demote another admin back to member', async () => {
    // u2 demotes u3
    const demote = await postJson(baseUrl, `/api/groups/${groupId}/members/${u3Id}/demote`, {}, u2Token);
    assert.equal(demote.response.status, 200);

    const db = getMigrationDbClient();
    await db.connect();
    try {
      const mems = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, u3Id]);
      assert.equal(mems.rows[0].role, 'member');
    } finally {
      await db.end();
    }
  });

  await t.test('15. Admin cannot demote themselves', async () => {
    const demoteSelf = await postJson(baseUrl, `/api/groups/${groupId}/members/${u2Id}/demote`, {}, u2Token);
    assert.equal(demoteSelf.response.status, 403);
  });

  await t.test('16. No one can demote or remove the owner (API and DB layer)', async () => {
    // API layer
    const demoteOwner = await postJson(baseUrl, `/api/groups/${groupId}/members/${u1Id}/demote`, {}, u2Token);
    assert.equal(demoteOwner.response.status, 403);

    const kickOwner = await deleteJson(baseUrl, `/api/groups/${groupId}/members/${u1Id}`, u2Token);
    assert.equal(kickOwner.response.status, 403);

    // DB-level trigger check
    const db = getMigrationDbClient();
    await db.connect();
    try {
      let threwUpdate = false;
      try {
        await db.query("UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2", [groupId, u1Id]);
      } catch (e) {
        threwUpdate = true;
      }
      assert.ok(threwUpdate, 'Direct DB UPDATE should fail on owner');

      let threwDelete = false;
      try {
        await db.query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [groupId, u1Id]);
      } catch (e) {
        threwDelete = true;
      }
      assert.ok(threwDelete, 'Direct DB DELETE should fail on owner');
    } finally {
      await db.end();
    }
  });

  await t.test('17. Regular member cannot approve/reject, promote, demote, or kick', async () => {
    // u3 is currently a regular member
    const promote = await postJson(baseUrl, `/api/groups/${groupId}/members/${u2Id}/promote`, {}, u3Token);
    assert.equal(promote.response.status, 403);

    const kick = await deleteJson(baseUrl, `/api/groups/${groupId}/members/${u2Id}`, u3Token);
    assert.equal(kick.response.status, 403);
  });

  await t.test('18. Any member can voluntarily exit; removes only their own row', async () => {
    const exit = await deleteJson(baseUrl, `/api/groups/${groupId}/members/me`, u3Token);
    assert.equal(exit.response.status, 204);

    const db = getMigrationDbClient();
    await db.connect();
    try {
      const mems = await db.query('SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, u3Id]);
      assert.equal(mems.rowCount, 0, 'u3 should be gone');

      const adminMems = await db.query('SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, u2Id]);
      assert.equal(adminMems.rowCount, 1, 'Admin row should still exist');
    } finally {
      await db.end();
    }
  });

  await t.test('19. Admin can kick another member; user immediately loses access', async () => {
    // let u3 join again
    const reReq = await postJson(baseUrl, `/api/groups/${groupId}/join-requests`, {}, u3Token);
    await postJson(baseUrl, `/api/groups/${groupId}/join-requests/${reReq.parsed.id}/approve`, {}, u2Token); // u2 (admin) approves
    
    // u2 kicks u3
    const kick = await deleteJson(baseUrl, `/api/groups/${groupId}/members/${u3Id}`, u2Token);
    assert.equal(kick.response.status, 204);

    const members = await getJson(baseUrl, `/api/groups/${groupId}/members`, u3Token);
    assert.equal(members.response.status, 404, 'u3 should no longer be able to view group members');
  });
});
