import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | undefined | null): boolean {
  if (!storedHash) return false;
  if (storedHash.startsWith('scrypt:')) {
    const [, salt, digest] = storedHash.split(':');
    if (!salt || !digest) return false;
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    const expected = Buffer.from(digest, 'hex');
    if (expected.length !== derived.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  }
  // Legacy unsalted sha-256 (pre-upgrade accounts)
  return crypto.createHash('sha256').update(password).digest('hex') === storedHash;
}

const SESSION_COOKIE = 'sutra_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function setSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

function extractSessionToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(\S+)$/i);
    if (match?.[1]) return match[1];
  }
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [name, ...value] = part.trim().split('=');
      if (name === SESSION_COOKIE && value.length > 0) {
        return decodeURIComponent(value.join('='));
      }
    }
  }
  return null;
}

export const authRoutes = Router();

authRoutes.post('/signup', (req: Request, res: Response) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });

  try {
    const userId = uuidv4();
    const hash = hashPassword(password);

    db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)').run(userId, name, email, hash);

    // Create default workspace
    const workspaceId = uuidv4();
    db.prepare('INSERT INTO workspaces (id, user_id, name) VALUES (?, ?, ?)').run(workspaceId, userId, 'Personal Workspace');

    // Create session
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(); // 7 days
    db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(uuidv4(), userId, token, expiresAt);

    setSessionCookie(res, token);
    res.json({ success: true, token, user: { id: userId, name, email } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

authRoutes.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(uuidv4(), user.id, token, expiresAt);

    setSessionCookie(res, token);
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

authRoutes.get('/me', (req: Request, res: Response) => {
  const token = extractSessionToken(req);
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const session = db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > CURRENT_TIMESTAMP').get(token) as any;
    if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

    const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(session.user_id) as any;
    if (!user) return res.status(401).json({ error: 'User not found' });

    const workspaces = db.prepare('SELECT * FROM workspaces WHERE user_id = ?').all(user.id);

    res.json({ user, workspaces });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

authRoutes.post('/logout', (req: Request, res: Response) => {
  const token = extractSessionToken(req);
  if (token) {
    try {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    } catch {}
  }
  clearSessionCookie(res);
  res.json({ success: true });
});
