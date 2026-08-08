import type { PoolClient } from 'pg';

export type AuthUser = {
  userId: string;
};

export type RequestDb = PoolClient;
