import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, startServer, postJson, getJson, getDbClient } from './helpers.js';

test('Resources rules', async (t) => {
  await resetDatabase();
  const { baseUrl, close } = await startServer();

  t.after(async () => {
    await close();
  });

  let u1Token: string, u1Id: string;
  let u2Token: string, u2Id: string;
  let groupAId: string;
  let groupBId: string;

  await t.test('Setup users and groups', async () => {
    const u1 = await postJson(baseUrl, '/api/auth/signup', { email: 'u1@example.com', password: 'password123' });
    u1Token = u1.parsed.access_token;
    u1Id = u1.parsed.user.id;

    const u2 = await postJson(baseUrl, '/api/auth/signup', { email: 'u2@example.com', password: 'password123' });
    u2Token = u2.parsed.access_token;
    u2Id = u2.parsed.user.id;

    const groupA = await postJson(baseUrl, '/api/groups', { name: 'Group A' }, u1Token);
    groupAId = groupA.parsed.id;

    const groupB = await postJson(baseUrl, '/api/groups', { name: 'Group B' }, u2Token);
    groupBId = groupB.parsed.id;
    
    // u2 is NOT in Group A. u1 is NOT in Group B.
  });

  await t.test('27. Group member can upload a resource; it appears in that groups feed', async () => {
    const upload = await postJson(baseUrl, `/api/groups/${groupAId}/resources`, {
      url_or_file_ref: 'https://example.com/res',
      title: 'Valid Res',
    }, u1Token);
    assert.equal(upload.response.status, 201, 'Upload should succeed');

    const list = await getJson(baseUrl, `/api/groups/${groupAId}/resources`, u1Token);
    assert.equal(list.response.status, 200);
    assert.ok(list.parsed.some((r: any) => r.id === upload.parsed.id), 'Resource should appear in feed');
  });

  await t.test('28. Non-member cannot upload to a group they dont belong to (404)', async () => {
    // u2 tries to upload to Group A
    const upload = await postJson(baseUrl, `/api/groups/${groupAId}/resources`, {
      url_or_file_ref: 'https://example.com/blocked',
      title: 'Blocked Res',
    }, u2Token);
    assert.equal(upload.response.status, 404, 'Non-member upload should return exactly 404 (not 403)');
  });

  await t.test('29. Non-member cannot list/view a groups resources (404)', async () => {
    // u2 tries to list Group A
    const list = await getJson(baseUrl, `/api/groups/${groupAId}/resources`, u2Token);
    assert.equal(list.response.status, 404, 'Non-member list should return exactly 404');
  });

  await t.test('30. Tenant isolation: Member of Group A cannot access Group B while acting in context of Group A (and vice versa)', async () => {
    // u1 tries to list Group B
    const listB = await getJson(baseUrl, `/api/groups/${groupBId}/resources`, u1Token);
    assert.equal(listB.response.status, 404, 'u1 cannot access Group B resources via HTTP');

    // DB-level RLS check
    const db = getDbClient();
    await db.connect();
    try {
      // Set session to u1
      await db.query("select set_config('app.user_id', $1, false)", [u1Id]);

      // Check Group A resources (should be visible)
      const resA = await db.query('SELECT * FROM resources WHERE group_id = $1', [groupAId]);
      assert.equal(resA.rowCount, 1, 'u1 should see Group A resources in DB');

      // Check Group B resources (should be empty due to RLS)
      const resB = await db.query('SELECT * FROM resources WHERE group_id = $1', [groupBId]);
      assert.equal(resB.rowCount, 0, 'u1 should NOT see Group B resources in DB due to RLS');
      
      // Attempt to insert into Group B as u1 directly in DB (should fail RLS)
      let threw = false;
      try {
        await db.query(
          "INSERT INTO resources (group_id, uploaded_by, url_or_file_ref, title, status) VALUES ($1, $2, 'ref', 'title', 'processed')",
          [groupBId, u1Id]
        );
      } catch (err: any) {
        threw = true;
      }
      assert.ok(threw, 'Direct DB insert into Group B by u1 should be blocked by RLS');
      
    } finally {
      await db.end();
    }
  });
});
