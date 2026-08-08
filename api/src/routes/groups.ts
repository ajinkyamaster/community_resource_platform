import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';

const groupCreateSchema = z.object({
  name: z.string().min(1).max(200),
});

export const groupsRouter = Router();

function requireDb(req: Express.Request) {
  if (!req.db || !req.user) {
    throw new AppError(500, 'Missing request database context');
  }
  return req.db;
}

async function getMemberRow(db: any, groupId: string, userId: string) {
  const result = await db.query(
    'select group_id, user_id, role from group_members where group_id = $1 and user_id = $2',
    [groupId, userId],
  );
  return result.rows[0] ?? null;
}

groupsRouter.post('/', async (req, res, next) => {
  try {
    const payload = groupCreateSchema.parse(req.body);
    const db = requireDb(req);
    const groupResult = await db.query(
      'insert into groups (name, created_by) values ($1, $2) returning id, name, created_by, created_at',
      [payload.name, req.user!.userId],
    );
    const group = groupResult.rows[0];
    await db.query('insert into group_members (group_id, user_id, role) values ($1, $2, $3)', [group.id, req.user!.userId, 'owner']);
    res.status(201).json(group);
  } catch (error) {
    next(error);
  }
});

groupsRouter.get('/mine', async (req, res, next) => {
  try {
    const db = requireDb(req);
    const result = await db.query(
      `select g.id, g.name, g.created_by, g.created_at
       from groups g
       join group_members gm on gm.group_id = g.id
       where gm.user_id = $1
       order by g.created_at desc`,
      [req.user!.userId],
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Join requests handled via /join-requests endpoints (see below)

groupsRouter.get('/:groupId/members', async (req, res, next) => {
  try {
    const db = requireDb(req);
    const allowed = await db.query(
      'select 1 from group_members where group_id = $1 and user_id = $2',
      [req.params.groupId, req.user!.userId],
    );
    if (allowed.rowCount === 0) {
      throw new AppError(404, 'Group not found');
    }
    const result = await db.query(
      `select gm.group_id, gm.user_id, u.email, gm.joined_at, gm.role
       from group_members gm
       join users u on u.id = gm.user_id
       where gm.group_id = $1
       order by gm.joined_at asc`,
      [req.params.groupId],
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Helpers
async function getMemberRole(db: any, groupId: string, userId: string) {
  const r = await db.query('select role from group_members where group_id = $1 and user_id = $2', [groupId, userId]);
  if (r.rowCount === 0) return null;
  return r.rows[0].role as string;
}

async function requireAdminOrOwner(req: Express.Request) {
  const db = requireDb(req);
  const role = await getMemberRole(db, req.params.groupId, req.user!.userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    throw new AppError(403, 'admin or owner role required');
  }
}

// POST /groups/:groupId/join-requests — create a pending join request
groupsRouter.post('/:groupId/join-requests', async (req, res, next) => {
  try {
    const db = requireDb(req);
    // Check already a member
    const mem = await db.query('select 1 from group_members where group_id = $1 and user_id = $2', [req.params.groupId, req.user!.userId]);
    if (mem.rowCount > 0) {
      throw new AppError(400, 'Already a member');
    }
    // Check if a request is already pending
    const existing = await db.query('select 1 from group_join_requests where group_id = $1 and user_id = $2 and status = $3', [req.params.groupId, req.user!.userId, 'pending']);
    if (existing.rowCount > 0) {
      throw new AppError(400, 'Join request already pending');
    }
    try {
      const r = await db.query('insert into group_join_requests (group_id, user_id, status) values ($1, $2, $3) returning id, group_id, user_id, status, requested_at', [req.params.groupId, req.user!.userId, 'pending']);
      res.status(201).json(r.rows[0]);
    } catch (err: any) {
      if (err?.code === '23503') throw new AppError(404, 'Group not found');
      throw err;
    }
  } catch (error) {
    next(error);
  }
});

// GET pending join requests — admin/owner only
groupsRouter.get('/:groupId/join-requests', async (req, res, next) => {
  try {
    await requireAdminOrOwner(req);
    const db = requireDb(req);
    const r = await db.query('select id, group_id, user_id, status, requested_at from group_join_requests where group_id = $1 and status = $2 order by requested_at asc', [req.params.groupId, 'pending']);
    res.json(r.rows);
  } catch (error) {
    next(error);
  }
});

// Approve a join request
groupsRouter.post('/:groupId/join-requests/:requestId/approve', async (req, res, next) => {
  try {
    await requireAdminOrOwner(req);
    const db = requireDb(req);
    // Update request to approved and record who decided
    const upd = await db.query('update group_join_requests set status = $1, decided_by = $2, decided_at = now() where id = $3 and group_id = $4 and status = $5 returning user_id', ['approved', req.user!.userId, req.params.requestId, req.params.groupId, 'pending']);
    if (upd.rowCount === 0) throw new AppError(404, 'Join request not found');
    const userId = upd.rows[0].user_id;
    // Insert membership as member
    await db.query('insert into group_members (group_id, user_id, role) values ($1, $2, $3) on conflict do nothing', [req.params.groupId, userId, 'member']);
    res.json({ message: 'approved' });
  } catch (error) {
    next(error);
  }
});

// Reject a join request
groupsRouter.post('/:groupId/join-requests/:requestId/reject', async (req, res, next) => {
  try {
    await requireAdminOrOwner(req);
    const db = requireDb(req);
    const upd = await db.query('update group_join_requests set status = $1, decided_by = $2, decided_at = now() where id = $3 and group_id = $4 and status = $5 returning user_id', ['rejected', req.user!.userId, req.params.requestId, req.params.groupId, 'pending']);
    if (upd.rowCount === 0) throw new AppError(404, 'Join request not found');
    res.json({ message: 'rejected' });
  } catch (error) {
    next(error);
  }
});

// Promote member -> admin
groupsRouter.post('/:groupId/members/:userId/promote', async (req, res, next) => {
  try {
    await requireAdminOrOwner(req);
    const db = requireDb(req);
    const r = await db.query('select role from group_members where group_id = $1 and user_id = $2', [req.params.groupId, req.params.userId]);
    if (r.rowCount === 0) throw new AppError(404, 'Member not found');
    const current = r.rows[0].role;
    if (current === 'owner') throw new AppError(403, 'the group owner cannot be promoted');
    await db.query('update group_members set role = $1 where group_id = $2 and user_id = $3', ['admin', req.params.groupId, req.params.userId]);
    res.json({ message: 'promoted' });
  } catch (error) {
    next(error);
  }
});

// Demote admin -> member (admins cannot demote the owner; admins cannot demote themselves)
groupsRouter.post('/:groupId/members/:userId/demote', async (req, res, next) => {
  try {
    await requireAdminOrOwner(req);
    const db = requireDb(req);
    if (req.user!.userId === req.params.userId) {
      throw new AppError(403, 'admins cannot demote themselves');
    }
    const r = await db.query('select role from group_members where group_id = $1 and user_id = $2', [req.params.groupId, req.params.userId]);
    if (r.rowCount === 0) throw new AppError(404, 'Member not found');
    const current = r.rows[0].role;
    if (current === 'owner') throw new AppError(403, 'the group owner cannot be demoted or removed');
    if (current !== 'admin') throw new AppError(400, 'user is not an admin');
    await db.query('update group_members set role = $1 where group_id = $2 and user_id = $3', ['member', req.params.groupId, req.params.userId]);
    res.json({ message: 'demoted' });
  } catch (error) {
    next(error);
  }
});

// Self-exit: any non-owner member can remove themselves from the group.
groupsRouter.delete('/:groupId/members/me', async (req, res, next) => {
  try {
    const db = requireDb(req);
    const membership = await getMemberRow(db, req.params.groupId, req.user!.userId);
    if (!membership) {
      throw new AppError(404, 'Group not found');
    }
    if (membership.role === 'owner') {
      throw new AppError(403, 'transfer ownership before leaving this group');
    }
    await db.query('delete from group_members where group_id = $1 and user_id = $2', [req.params.groupId, req.user!.userId]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Kick another member; admins/owner only. Owner is absolutely protected.
groupsRouter.delete('/:groupId/members/:userId', async (req, res, next) => {
  try {
    await requireAdminOrOwner(req);
    const db = requireDb(req);
    if (req.params.userId === req.user!.userId) {
      throw new AppError(403, 'use the self-exit endpoint to leave a group');
    }
    const membership = await getMemberRow(db, req.params.groupId, req.params.userId);
    if (!membership) {
      throw new AppError(404, 'Member not found');
    }
    if (membership.role === 'owner') {
      throw new AppError(403, 'the group owner cannot be demoted or removed');
    }
    await db.query('delete from group_members where group_id = $1 and user_id = $2', [req.params.groupId, req.params.userId]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Transfer ownership to another current member.
groupsRouter.post('/:groupId/transfer-ownership/:userId', async (req, res, next) => {
  try {
    const db = requireDb(req);
    const currentRole = await getMemberRole(db, req.params.groupId, req.user!.userId);
    if (currentRole !== 'owner') {
      throw new AppError(403, 'owner role required');
    }
    const target = await getMemberRow(db, req.params.groupId, req.params.userId);
    if (!target) {
      throw new AppError(404, 'Member not found');
    }
    if (target.role === 'owner') {
      throw new AppError(400, 'target is already the owner');
    }
    await db.query("select set_config('app.owner_transfer', 'true', true)");
    await db.query('update group_members set role = $1 where group_id = $2 and user_id = $3', ['admin', req.params.groupId, req.user!.userId]);
    await db.query('update group_members set role = $1 where group_id = $2 and user_id = $3', ['owner', req.params.groupId, req.params.userId]);
    await db.query('update groups set created_by = $1 where id = $2', [req.params.userId, req.params.groupId]);
    res.json({ message: 'ownership transferred' });
  } catch (error) {
    next(error);
  }
});

groupsRouter.get('/:groupId', async (req, res, next) => {
  try {
    const db = requireDb(req);
    const result = await db.query(
      `select g.id, g.name, g.created_by, g.created_at
       from groups g
       where g.id = $1
         and exists (
           select 1
           from group_members gm
           where gm.group_id = g.id
             and gm.user_id = $2
         )`,
      [req.params.groupId, req.user!.userId],
    );
    if (result.rowCount === 0) {
      throw new AppError(404, 'Group not found');
    }
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});
