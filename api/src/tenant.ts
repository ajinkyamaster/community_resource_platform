import type { NextFunction, Request, Response } from 'express';
import { pool } from './db.js';
import { AppError } from './errors.js';

export async function attachTenantClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    next(new AppError(401, 'Missing authenticated user'));
    return;
  }

  const client = await pool.connect();
  let finished = false;

  const finalize = async (shouldCommit: boolean): Promise<void> => {
    if (finished) {
      return;
    }
    finished = true;
    try {
      await client.query(shouldCommit ? 'commit' : 'rollback');
    } catch {
      // If commit/rollback fails, release below still happens.
    } finally {
      client.release();
    }
  };

  try {
    await client.query('begin');
    await client.query("select set_config('app.user_id', $1, true)", [req.user.userId]);
    req.db = client;
  } catch (error) {
    client.release();
    next(error);
    return;
  }

  res.on('finish', () => {
    void finalize(res.statusCode < 400);
  });
  res.on('close', () => {
    void finalize(false);
  });

  next();
}
