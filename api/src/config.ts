import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtIssuer: process.env.JWT_ISSUER ?? 'community-resource-platform',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'community-resource-web',
  accessTokenExpireMinutes: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES ?? 60 * 24 * 7),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((origin) => origin.trim()).filter(Boolean),
};