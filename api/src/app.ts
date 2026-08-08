import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { AppError } from './errors.js';
import { authRouter } from './routes/auth.js';
import { groupsRouter } from './routes/groups.js';
import { resourcesRouter } from './routes/resources.js';
import { healthRouter } from './routes/health.js';
import { requireAuth } from './auth.js';
import { attachTenantClient } from './tenant.js';
import { withTransaction } from './db.js';

export function buildApp() {
  const app = express();

  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json());

  app.use(healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/groups', requireAuth, attachTenantClient, groupsRouter, resourcesRouter);

  app.delete('/api/users/me', requireAuth, async (req, res, next) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'Missing authenticated user');
      }
      await withTransaction(async (client) => {
        await client.query("select set_config('app.user_id', $1, true)", [req.user!.userId]);
        const ownedGroups = await client.query('select id from groups where created_by = $1', [req.user!.userId]);
        if ((ownedGroups.rowCount ?? 0) > 0) {
          throw new AppError(403, 'transfer ownership before deleting your account');
        }
        await client.query('update resources set uploaded_by = null where uploaded_by = $1', [req.user!.userId]);
        await client.query('delete from group_members where user_id = $1', [req.user!.userId]);
        await client.query('delete from users where id = $1', [req.user!.userId]);
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) {
      return;
    }
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }
    if (error instanceof Error && 'issues' in error) {
      res.status(400).json({ message: error.message });
      return;
    }
    res.status(500).json({ message: 'Internal server error' });
  });

  return app;
}
