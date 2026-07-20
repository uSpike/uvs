import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from './database';

describe('database migrations', () => {
  it('places schema-v1 games in per-team imported tournaments', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(`
      CREATE TABLE teams (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id),
        token TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        video_source TEXT NOT NULL,
        metadata_jsonl TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        settings_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO teams VALUES (1, 'Union', 'union', '2026-01-01T00:00:00Z');
      INSERT INTO games VALUES (
        1, 1, 'abcdefghijklmnopqrstuvwx', 'Legacy game', 'file:///game.mp4',
        '{}', '{}', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      );
      PRAGMA user_version = 1;
    `);

    migrateDatabase(database);

    expect(database.pragma('user_version', { simple: true })).toBe(15);
    expect(
      database.prepare(
        `SELECT season_rosters.name AS roster, tournaments.name AS tournament,
                games.tournament_id, games.player_count
           FROM games
           JOIN tournaments ON tournaments.id = games.tournament_id
           JOIN season_rosters ON season_rosters.id = tournaments.season_roster_id`,
      ).get(),
    ).toMatchObject({
      roster: 'Imported roster',
      tournament: 'Imported games',
      tournament_id: 1,
      player_count: 7,
    });
    expect(
      (database.pragma('table_info(teams)') as Array<{ name: string }>).map((column) => column.name),
    ).toEqual(expect.arrayContaining(['password_hash', 'password_version', 'password_plaintext']));
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'game_share_links'").get(),
    ).toEqual({ name: 'game_share_links' });
    expect(
      (database.pragma('table_info(players)') as Array<{ name: string }>).map((column) => column.name),
    ).toContain('matchup_role');
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'game_point_player_matchup_overrides'").get(),
    ).toEqual({ name: 'game_point_player_matchup_overrides' });
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'manual_game_points'").get(),
    ).toEqual({ name: 'manual_game_points' });
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'game_highlights'").get(),
    ).toEqual({ name: 'game_highlights' });
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'game_event_annotations'").get(),
    ).toEqual({ name: 'game_event_annotations' });
    expect(
      database.prepare('SELECT kind, name, is_default FROM season_strategies ORDER BY kind').all(),
    ).toEqual([
      { kind: 'defense', name: 'Person', is_default: 1 },
      { kind: 'offense', name: 'Hex', is_default: 1 },
    ]);
    database.close();
  });

  it('removes empty imported placeholders from schema-v2 databases', () => {
    const database = new Database(':memory:');
    migrateDatabase(database);
    database.exec(`
      INSERT INTO teams (name, slug) VALUES ('Union', 'union');
      INSERT INTO season_rosters (team_id, name) VALUES (1, 'Imported roster');
      INSERT INTO tournaments (season_roster_id, name) VALUES (1, 'Imported games');
      CREATE TABLE game_players (
        game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game_id, player_id)
      );
      PRAGMA user_version = 2;
    `);

    migrateDatabase(database);

    expect(database.prepare('SELECT COUNT(*) AS count FROM season_rosters').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM tournaments').get()).toEqual({ count: 0 });
    expect(database.pragma('user_version', { simple: true })).toBe(15);
    database.close();
  });

  it('removes the obsolete game roster table from schema-v4 databases', () => {
    const database = new Database(':memory:');
    migrateDatabase(database);
    database.exec(`
      CREATE TABLE game_players (
        game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game_id, player_id)
      );
      PRAGMA user_version = 4;
    `);

    migrateDatabase(database);

    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'game_players'").get(),
    ).toBeUndefined();
    expect(database.pragma('user_version', { simple: true })).toBe(15);
    database.close();
  });
});
