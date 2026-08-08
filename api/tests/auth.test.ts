import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, startServer, postJson, getJson, deleteJson, getDbClient } from './helpers.js';

test('Auth rules', async (t) => {
  await resetDatabase();
  const { baseUrl, close } = await startServer();

  t.after(async () => {
    await close();
  });

  await t.test('1. Signup with a new email succeeds; password is hashed, never plaintext', async () => {
    const signup = await postJson(baseUrl, '/api/auth/signup', {
      email: 'newuser@example.com',
      password: 'mypassword123',
    });
    assert.equal(signup.response.status, 201, 'Signup should succeed');
    assert.ok(signup.parsed.access_token, 'Should return access token');

    const db = getDbClient();
    await db.connect();
    try {
      const res = await db.query('SELECT email, password_hash FROM users WHERE email = $1', ['newuser@example.com']);
      assert.equal(res.rowCount, 1, 'User should be in database');
      const user = res.rows[0];
      assert.notEqual(user.password_hash, 'mypassword123', 'Password must not be stored in plaintext');
      assert.ok(user.password_hash.startsWith('$2a$') || user.password_hash.startsWith('$2b$'), 'Password should be a bcrypt hash');
    } finally {
      await db.end();
    }
  });

  await t.test('2. Signup with an already-used email fails cleanly, case-insensitively', async () => {
    const signup1 = await postJson(baseUrl, '/api/auth/signup', {
      email: 'Duplicate@example.com',
      password: 'password123',
    });
    assert.equal(signup1.response.status, 201, 'First signup should succeed');

    const signup2 = await postJson(baseUrl, '/api/auth/signup', {
      email: 'duplicate@example.com', // Different case
      password: 'password456',
    });
    assert.equal(signup2.response.status, 409, 'Duplicate signup should fail with 409');
    assert.match(signup2.parsed.message, /already exists|already registered|duplicate/, 'Error message should be clean');
  });

  await t.test('3. Login with correct credentials returns a valid JWT', async () => {
    await postJson(baseUrl, '/api/auth/signup', {
      email: 'loginuser@example.com',
      password: 'password123',
    });

    const login = await postJson(baseUrl, '/api/auth/login', {
      email: 'loginuser@example.com',
      password: 'password123',
    });
    assert.equal(login.response.status, 200, 'Login should succeed');
    assert.ok(login.parsed.access_token, 'Should return JWT');
  });

  await t.test('4. Login with wrong password fails with generic message (no info disclosure)', async () => {
    // Attempt login with wrong password for existing user
    const wrongPassword = await postJson(baseUrl, '/api/auth/login', {
      email: 'loginuser@example.com',
      password: 'wrongpassword',
    });
    assert.equal(wrongPassword.response.status, 401, 'Wrong password should fail');

    // Attempt login for non-existent user
    const nonExistent = await postJson(baseUrl, '/api/auth/login', {
      email: 'nobody@example.com',
      password: 'password123',
    });
    assert.equal(nonExistent.response.status, 401, 'Non-existent user should fail');
    
    // Compare messages
    assert.equal(
      wrongPassword.parsed.message,
      nonExistent.parsed.message,
      'Error message for wrong password and non-existent email must be identical'
    );
  });

  await t.test('5. An expired or tampered JWT is rejected on a protected route', async () => {
    const tamperedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhYmNkIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIn0.invalidSignature1234567890';
    const req = await getJson(baseUrl, '/api/groups', tamperedToken);
    assert.equal(req.response.status, 401, 'Tampered token should be rejected with 401');
  });

  await t.test('6. A request with no token is rejected on every protected route', async () => {
    const endpoints = [
      { method: postJson, path: '/api/groups' },
      { method: getJson, path: '/api/groups' },
      { method: postJson, path: '/api/groups/123/join-requests' },
      { method: getJson, path: '/api/groups/123/join-requests' },
      { method: postJson, path: '/api/groups/123/join-requests/456/approve' },
      { method: postJson, path: '/api/groups/123/join-requests/456/reject' },
      { method: getJson, path: '/api/groups/123/members' },
      { method: postJson, path: '/api/groups/123/members/456/promote' },
      { method: postJson, path: '/api/groups/123/members/456/demote' },
      { method: deleteJson, path: '/api/groups/123/members/456' },
      { method: deleteJson, path: '/api/groups/123/members/me' },
      { method: postJson, path: '/api/groups/123/transfer-ownership/456' },
      { method: getJson, path: '/api/groups/123/resources' },
      { method: postJson, path: '/api/groups/123/resources' },
      { method: deleteJson, path: '/api/users/me' },
    ];

    for (const { method, path } of endpoints) {
      const res = await method(baseUrl, path, {});
      assert.equal(res.response.status, 401, `Endpoint ${path} should reject without token, got ${res.response.status}`);
    }
  });
});
