import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { ShareLinkRepository } from './share-links';

describe('ShareLinkRepository', () => {
  it('creates multiple public links and revokes them independently', () => {
    const database = openDatabase(':memory:');
    database.exec(`
      INSERT INTO teams (name, slug) VALUES ('Union', 'union');
      INSERT INTO season_rosters (team_id, name) VALUES (1, '2026');
      INSERT INTO tournaments (season_roster_id, name) VALUES (1, 'Invite');
      INSERT INTO games (
        team_id, tournament_id, token, title, video_source,
        metadata_jsonl, metadata_json, settings_json
      ) VALUES (
        1, 1, 'private-game-token-1234', 'Union vs. Surge', 'file:///game.mp4',
        '{}', '{}', '{}'
      );
    `);
    const shares = new ShareLinkRepository(database);

    const first = shares.create('private-game-token-1234');
    const second = shares.create('private-game-token-1234');

    expect(first.token).toHaveLength(32);
    expect(second.token).not.toBe(first.token);
    expect(shares.resolveGameToken(first.token)).toBe('private-game-token-1234');
    expect(shares.listForGame('private-game-token-1234')).toHaveLength(2);

    expect(shares.delete('private-game-token-1234', first.id)).toBe(true);
    expect(shares.resolveGameToken(first.token)).toBeNull();
    expect(shares.resolveGameToken(second.token)).toBe('private-game-token-1234');
    expect(shares.delete('private-game-token-1234', first.id)).toBe(false);
    database.close();
  });

  it('does not create links for missing games or resolve malformed tokens', () => {
    const database = openDatabase(':memory:');
    const shares = new ShareLinkRepository(database);
    expect(() => shares.create('missing-game')).toThrow('Game not found.');
    expect(shares.resolveGameToken('../not-a-token')).toBeNull();
    database.close();
  });
});
