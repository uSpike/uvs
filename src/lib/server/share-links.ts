import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDatabase } from './database';

export interface GameShareLink {
  id: number;
  token: string;
  createdAt: string;
}

interface ShareLinkRow {
  id: number;
  token: string;
  created_at: string;
}

/** SQLite-backed, individually revocable public game links. */
export class ShareLinkRepository {
  constructor(private readonly database: Database.Database = getDatabase()) {}

  /** List public links belonging to one game. */
  listForGame(gameToken: string): GameShareLink[] {
    const rows = this.database
      .prepare(
        `SELECT game_share_links.id, game_share_links.token, game_share_links.created_at
           FROM game_share_links
           JOIN games ON games.id = game_share_links.game_id
          WHERE games.token = ?
          ORDER BY game_share_links.created_at DESC, game_share_links.id DESC`,
      )
      .all(gameToken) as ShareLinkRow[];
    return rows.map(mapShareLink);
  }

  /** Create a new public link for a game. */
  create(gameToken: string): GameShareLink {
    const token = randomBytes(24).toString('base64url');
    const result = this.database
      .prepare(
        `INSERT INTO game_share_links (game_id, token)
         SELECT games.id, ? FROM games WHERE games.token = ?`,
      )
      .run(token, gameToken);
    if (result.changes !== 1) throw new Error('Game not found.');
    const row = this.database
      .prepare('SELECT id, token, created_at FROM game_share_links WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as ShareLinkRow;
    return mapShareLink(row);
  }

  /** Revoke one public link, constrained to its owning game. */
  delete(gameToken: string, shareLinkId: number): boolean {
    if (!Number.isSafeInteger(shareLinkId) || shareLinkId <= 0) {
      throw new Error('Share link is invalid.');
    }
    const result = this.database
      .prepare(
        `DELETE FROM game_share_links
          WHERE id = ?
            AND game_id = (SELECT id FROM games WHERE token = ?)`,
      )
      .run(shareLinkId, gameToken);
    return result.changes === 1;
  }

  /** Resolve a public share token to its private game token. */
  resolveGameToken(shareToken: string): string | null {
    if (!/^[A-Za-z0-9_-]{32,128}$/u.test(shareToken)) return null;
    const row = this.database
      .prepare(
        `SELECT games.token AS game_token
           FROM game_share_links
           JOIN games ON games.id = game_share_links.game_id
          WHERE game_share_links.token = ?`,
      )
      .get(shareToken) as { game_token: string } | undefined;
    return row?.game_token ?? null;
  }
}

function mapShareLink(row: ShareLinkRow): GameShareLink {
  return { id: row.id, token: row.token, createdAt: row.created_at };
}
