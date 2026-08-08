import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { AppError } from './errors.js';

type TokenPayload = {
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
};

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  return bcrypt.compareSync(password, passwordHash);
}

export function createAccessToken(userId: string): string {
  return jwt.sign(
    {},
    config.jwtSecret,
    {
      subject: userId,
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      expiresIn: `${config.accessTokenExpireMinutes}m`,
    },
  );
}

export function getBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = getBearerToken(req);
  if (!token) {
    next(new AppError(401, 'Missing bearer token'));
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    }) as TokenPayload;
    if (!decoded.sub) {
      next(new AppError(401, 'Invalid bearer token'));
      return;
    }
    req.user = { userId: decoded.sub };
    next();
  } catch {
    next(new AppError(401, 'Invalid bearer token'));
  }
}
