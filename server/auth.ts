import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { AuthUser, UserRole } from './types.ts';

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  return process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : EPHEMERAL_SECRET;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null): boolean {
  if (!storedHash || !storedHash.includes(':')) {
    return false;
  }
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) {
    return false;
  }
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

interface TokenPayload {
  uid: number;
  role: UserRole;
  exp: number;
}

export function signSessionToken(userId: number, role: UserRole): string {
  const payload: TokenPayload = {
    uid: userId,
    role,
    exp: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [encoded, sig] = parts;
  if (!encoded || !sig) {
    return null;
  }
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed || typeof parsed.uid !== 'number' || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

export function createAuthMiddleware(db: Database.Database) {
  return function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'يرجى تسجيل الدخول للوصول إلى هذا المورد' });
      return;
    }
    const token = authHeader.slice(7).trim();
    const payload = verifySessionToken(token);
    if (!payload) {
      res.status(401).json({ error: 'انتهت صلاحية الجلسة أو الرمز غير صالح' });
      return;
    }

    const row = db
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.role, u.is_active, s.id AS supervisor_id
         FROM users u
         LEFT JOIN supervisors s ON s.user_id = u.id
         WHERE u.id = ?`
      )
      .get(payload.uid) as AuthUser | undefined;

    if (!row || row.is_active !== 1) {
      res.status(403).json({ error: 'الحساب غير مفعل أو غير موجود' });
      return;
    }

    req.authUser = row;
    next();
  };
}

export function requireRole(...roles: UserRole[]) {
  return function roleGuard(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    if (!req.authUser) {
      res.status(401).json({ error: 'غير مصرح بالوصول' });
      return;
    }
    if (!roles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'ليس لديك الصلاحية اللازمة لتنفيذ هذا الإجراء' });
      return;
    }
    next();
  };
}
