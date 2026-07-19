import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import type Database from 'better-sqlite3';
import { getDatabase } from './database';

export type AccessRole = 'guest' | 'player' | 'admin';

/** Authenticated browser identity stored in a signed session. */
export interface AuthSession {
  role: AccessRole;
  teamId: number | null;
  teamSlug: string | null;
}

interface SessionPayload {
  role: 'player' | 'admin';
  teamId: number | null;
  teamSlug: string | null;
  passwordVersion: number | null;
  expiresAt: number;
}

interface TeamCredentialRow {
  id: number;
  slug: string;
  password_hash: string | null;
  password_version: number;
}

const SESSION_COOKIE = 'reco_role_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const PASSWORD_KEY_BYTES = 32;

/** Authenticate the global administrator password. */
export function authenticateAdminPassword(password: string): boolean {
  return secretsEqual(password, configuredSecret('ADMIN_PASSWORD', 'admin'));
}

/** Authenticate one team's shared player password. */
export function authenticateTeamPassword(
  teamSlug: string,
  password: string,
  database: Database.Database = getDatabase(),
): AuthSession | null {
  const row = database
    .prepare('SELECT id, slug, password_hash, password_version FROM teams WHERE slug = ?')
    .get(teamSlug) as TeamCredentialRow | undefined;
  if (!row?.password_hash || !verifyTeamPassword(password, row.password_hash)) return null;
  return { role: 'player', teamId: row.id, teamSlug: row.slug };
}

/** Hash a team password using scrypt and a random salt. */
export function hashTeamPassword(password: string): string {
  const salt = randomBytes(16);
  const key = derivePasswordKey(password, salt);
  return [
    'scrypt',
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISM,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/** Read and verify the signed browser session. */
export function sessionFromCookies(
  cookies: Cookies,
  database: Database.Database = getDatabase(),
): AuthSession {
  const guest: AuthSession = { role: 'guest', teamId: null, teamSlug: null };
  const cookie = cookies.get(SESSION_COOKIE);
  if (!cookie) return guest;
  const separator = cookie.lastIndexOf('.');
  if (separator <= 0) return guest;
  const encodedPayload = cookie.slice(0, separator);
  const suppliedSignature = cookie.slice(separator + 1);
  if (!secretsEqual(suppliedSignature, sign(encodedPayload))) return guest;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as SessionPayload;
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return guest;
    if (payload.role === 'admin') return { role: 'admin', teamId: null, teamSlug: null };
    if (
      payload.role === 'player' &&
      Number.isSafeInteger(payload.teamId) &&
      payload.teamId !== null &&
      payload.teamId > 0 &&
      typeof payload.teamSlug === 'string' &&
      payload.teamSlug.length > 0 &&
      Number.isSafeInteger(payload.passwordVersion) &&
      payload.passwordVersion !== null &&
      payload.passwordVersion >= 0
    ) {
      const team = database
        .prepare('SELECT slug, password_version FROM teams WHERE id = ?')
        .get(payload.teamId) as { slug: string; password_version: number } | undefined;
      if (!team || team.slug !== payload.teamSlug || team.password_version !== payload.passwordVersion) {
        return guest;
      }
      return { role: 'player', teamId: payload.teamId, teamSlug: payload.teamSlug };
    }
    return guest;
  } catch {
    return guest;
  }
}

/** Set a signed administrator or team-player session cookie. */
export function setAuthSession(
  cookies: Cookies,
  session: AuthSession,
  database: Database.Database = getDatabase(),
): void {
  if (session.role === 'guest') throw new Error('Guest sessions cannot be persisted.');
  let passwordVersion: number | null = null;
  if (session.role === 'player') {
    const team = database
      .prepare('SELECT slug, password_version FROM teams WHERE id = ?')
      .get(session.teamId) as { slug: string; password_version: number } | undefined;
    if (!team || team.slug !== session.teamSlug) throw new Error('Team session is no longer valid.');
    passwordVersion = team.password_version;
  }
  const payload: SessionPayload = {
    role: session.role,
    teamId: session.role === 'player' ? session.teamId : null,
    teamSlug: session.role === 'player' ? session.teamSlug : null,
    passwordVersion,
    expiresAt: Date.now() + SESSION_SECONDS * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  cookies.set(SESSION_COOKIE, `${encodedPayload}.${sign(encodedPayload)}`, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_SECONDS,
  });
}

/** Remove the active browser session. */
export function clearRoleSession(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Return a safe post-login destination for an authenticated session. */
export function loginDestination(session: AuthSession, requested: string | null): string {
  const fallback = session.role === 'admin' ? '/admin' : `/teams/${session.teamSlug}`;
  if (!requested || !requested.startsWith('/') || requested.startsWith('//')) return fallback;
  if (session.role === 'admin') return requested;
  if (requested.startsWith(`/teams/${session.teamSlug}`) || requested.startsWith('/games/')) {
    return requested;
  }
  return fallback;
}

function verifyTeamPassword(password: string, encodedHash: string): boolean {
  const [algorithm, cost, blockSize, parallelism, saltValue, keyValue, extra] = encodedHash.split('$');
  if (
    algorithm !== 'scrypt' || extra !== undefined ||
    Number(cost) !== SCRYPT_COST || Number(blockSize) !== SCRYPT_BLOCK_SIZE ||
    Number(parallelism) !== SCRYPT_PARALLELISM
  ) return false;
  try {
    const expected = Buffer.from(keyValue, 'base64url');
    const actual = derivePasswordKey(password, Buffer.from(saltValue, 'base64url'));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function derivePasswordKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, PASSWORD_KEY_BYTES, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    maxmem: 64 * 1024 * 1024,
  });
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', configuredSecret('SESSION_SECRET', 'reco-development-secret'))
    .update(encodedPayload)
    .digest('base64url');
}

function configuredSecret(name: string, developmentDefault: string): string {
  const configured = process.env[name];
  if (configured) return configured;
  if (process.env.NODE_ENV !== 'production') return developmentDefault;
  throw new Error(`${name} must be configured in production.`);
}

function secretsEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
