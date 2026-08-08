import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';

const resourceCreateSchema = z.object({
  url_or_file_ref: z.string().min(1).max(2048),
  title: z.string().min(1).max(300),
  note: z.string().max(5000).nullable().optional(),
});

export const resourcesRouter = Router();

function requireDb(req: Express.Request) {
  if (!req.db || !req.user) {
    throw new AppError(500, 'Missing request database context');
  }
  return req.db;
}

resourcesRouter.post('/:groupId/resources', async (req, res, next) => {
  try {
    const payload = resourceCreateSchema.parse(req.body);
    const db = requireDb(req);
    const membership = await db.query(
      'select 1 from group_members where group_id = $1 and user_id = $2',
      [req.params.groupId, req.user!.userId],
    );
    if (membership.rowCount === 0) {
      throw new AppError(404, 'Group not found');
    }
    const result = await db.query(
      `insert into resources (group_id, uploaded_by, url_or_file_ref, title, note, status)
       values ($1, $2, $3, $4, $5, 'processed')
       returning id, group_id, uploaded_by, url_or_file_ref, title, note, status, created_at`,
      [req.params.groupId, req.user!.userId, payload.url_or_file_ref, payload.title, payload.note ?? null],
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

resourcesRouter.get('/:groupId/resources', async (req, res, next) => {
  try {
    const db = requireDb(req);
    const membership = await db.query(
      'select 1 from group_members where group_id = $1 and user_id = $2',
      [req.params.groupId, req.user!.userId],
    );
    if (membership.rowCount === 0) {
      throw new AppError(404, 'Group not found');
    }
    const result = await db.query(
      `select id, group_id, uploaded_by, url_or_file_ref, title, note, status, created_at
       from resources
       where group_id = $1
       order by created_at desc`,
      [req.params.groupId],
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});
