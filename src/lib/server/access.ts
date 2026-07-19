import { error } from '@sveltejs/kit';
import { CatalogRepository, type GameViewRecord } from './catalog';

/** Return whether a browser session may access one team's private content. */
export function canAccessTeam(locals: App.Locals, teamId: number): boolean {
  return locals.role === 'admin' || (locals.role === 'player' && locals.teamId === teamId);
}

/** Load a game and enforce its team boundary for private pages and APIs. */
export function requireGameAccess(locals: App.Locals, token: string): GameViewRecord {
  const game = new CatalogRepository().getGameViewByToken(token);
  if (!game) error(404, 'Game not found.');
  if (locals.role === 'guest') error(401, 'Sign in to access this game.');
  if (!canAccessTeam(locals, game.teamId)) error(403, 'This game belongs to another team.');
  return game;
}
