import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { CatalogRepository } from './catalog';
import { openDatabase } from './database';
import {
  authenticateAdminPassword,
  authenticateTeamPassword,
  loginDestination,
  sessionFromCookies,
  setAuthSession,
} from './auth';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('team-scoped authentication', () => {
  it('authenticates the configured global administrator password', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'manage-games');
    expect(authenticateAdminPassword('manage-games')).toBe(true);
    expect(authenticateAdminPassword('wrong')).toBe(false);
  });

  it('authenticates a password only for its team', () => {
    const database = openDatabase(':memory:');
    const catalog = new CatalogRepository(database);
    const union = catalog.createTeam('Union', 'u');
    catalog.createTeam('Surge', 'surge-password');

    expect(catalog.getTeamPassword(union.id)).toBe('u');
    expect(authenticateTeamPassword('union', 'u', database)).toEqual({
      role: 'player',
      teamId: union.id,
      teamSlug: 'union',
    });
    expect(authenticateTeamPassword('union', 'surge-password', database)).toBeNull();
    expect(authenticateTeamPassword('missing', 'u', database)).toBeNull();
    database.close();
  });

  it('keeps player destinations within their team or an authorized game route', () => {
    const player = { role: 'player' as const, teamId: 7, teamSlug: 'union' };
    const admin = { role: 'admin' as const, teamId: null, teamSlug: null };
    expect(loginDestination(player, '/admin')).toBe('/teams/union');
    expect(loginDestination(player, '/teams/surge')).toBe('/teams/union');
    expect(loginDestination(player, '/games/game-token')).toBe('/games/game-token');
    expect(loginDestination(admin, '/admin')).toBe('/admin');
    expect(loginDestination(admin, '//outside.example')).toBe('/admin');
  });

  it('accepts signed team sessions and rejects tampered cookies', () => {
    vi.stubEnv('SESSION_SECRET', 'test-signing-secret');
    const database = openDatabase(':memory:');
    const team = new CatalogRepository(database).createTeam('Union', 'union-password');
    const values = new Map<string, string>();
    const cookies = {
      get: (name: string) => values.get(name),
      set: (name: string, value: string) => values.set(name, value),
      delete: (name: string) => values.delete(name),
    } as unknown as Cookies;

    setAuthSession(cookies, { role: 'player', teamId: team.id, teamSlug: 'union' }, database);
    expect(sessionFromCookies(cookies, database)).toEqual({
      role: 'player',
      teamId: team.id,
      teamSlug: 'union',
    });

    new CatalogRepository(database).updateTeamPassword(team.id, 'rotated-password');
    expect(sessionFromCookies(cookies, database)).toEqual({
      role: 'guest',
      teamId: null,
      teamSlug: null,
    });

    setAuthSession(cookies, authenticateTeamPassword('union', 'rotated-password', database)!, database);

    const [name, value] = [...values.entries()][0]!;
    values.set(name, `x${value.slice(1)}`);
    expect(sessionFromCookies(cookies, database)).toEqual({ role: 'guest', teamId: null, teamSlug: null });
    database.close();
  });
});
