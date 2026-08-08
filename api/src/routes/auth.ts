import { Router } from 'express';
import { z } from 'zod';
import { withClient } from '../db.js';
import { AppError } from '../errors.js';
import { createAccessToken, hashPassword, verifyPassword } from '../auth.js';

const authRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const authRouter = Router();

authRouter.post('/signup', async (req, res, next) => {
  try {
    const payload = authRequestSchema.parse(req.body);
    const result = await withClient(async (client) => {
      const existing = await client.query('select id from users where lower(email) = lower($1)', [payload.email]);
      if (existing.rowCount && existing.rowCount > 0) {
        throw new AppError(409, 'Email already registered');
      }
      return client.query(
        'insert into users (email, password_hash) values ($1, $2) returning id, email, created_at',
        [payload.email, hashPassword(payload.password)],
      );
    });
    const user = result.rows[0];
    res.status(201).json({
      access_token: createAccessToken(user.id),
      token_type: 'bearer',
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const payload = authRequestSchema.parse(req.body);
    const result = await withClient((client) =>
      client.query('select id, email, password_hash, created_at from users where lower(email) = lower($1)', [payload.email]),
    );
    const user = result.rows[0];
    if (!user || !verifyPassword(payload.password, user.password_hash)) {
      throw new AppError(401, 'Invalid credentials');
    }
    res.json({
      access_token: createAccessToken(user.id),
      token_type: 'bearer',
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

