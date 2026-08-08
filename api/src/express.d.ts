import type { PoolClient } from 'pg';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
      };
      db?: PoolClient;
    }
  }
}

export {};