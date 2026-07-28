import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateDatabase, resolveApplicationDatabasePath } from './database';

describe('database path', () => {
  it('prefers the UVS setting over the previous setting', () => {
    expect(resolveApplicationDatabasePath({
      UVS_DATABASE_PATH: '/data/uvs.sqlite',
      RECO_DATABASE_PATH: '/data/previous.sqlite',
    })).toBe('/data/uvs.sqlite');
  });

  it('continues using an existing database at the previous default path', () => {
    expect(resolveApplicationDatabasePath({}, (filename) => filename === './data/reco-web.sqlite'))
      .toBe('./data/reco-web.sqlite');
  });

  it('uses the renamed default path for a new installation', () => {
    expect(resolveApplicationDatabasePath({}, () => false))
      .toBe('./data/ultimate-video-stats.sqlite');
  });
});

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

    expect(database.pragma('user_version', { simple: true })).toBe(18);
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
    expect(database.pragma('user_version', { simple: true })).toBe(18);
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
    expect(database.pragma('user_version', { simple: true })).toBe(18);
    database.close();
  });

  it('preserves legacy paper scorers as receivers and adds nullable throwers', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(`
      CREATE TABLE players (
        id INTEGER PRIMARY KEY
      );
      CREATE TABLE manual_game_points (
        id INTEGER PRIMARY KEY,
        scorer_player_id INTEGER REFERENCES players(id) ON DELETE RESTRICT
      );
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        tournament_id INTEGER NOT NULL,
        played_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO players (id) VALUES (7);
      INSERT INTO manual_game_points (id, scorer_player_id) VALUES (1, 7);
      PRAGMA user_version = 16;
    `);

    migrateDatabase(database);

    expect(database.pragma('user_version', { simple: true })).toBe(18);
    expect(
      (database.pragma('table_info(manual_game_points)') as Array<{ name: string }>)
        .map((column) => column.name),
    ).toEqual(['id', 'receiver_player_id', 'thrower_player_id']);
    expect(
      database
        .prepare(
          `SELECT receiver_player_id, thrower_player_id
             FROM manual_game_points
            WHERE id = 1`,
        )
        .get(),
    ).toEqual({ receiver_player_id: 7, thrower_player_id: null });
    database.close();
  });

  it('initializes tournament game order from the previous chronological display', () => {
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        tournament_id INTEGER NOT NULL,
        played_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO games VALUES (10, 1, NULL, '2026-01-10T00:00:00Z');
      INSERT INTO games VALUES (11, 1, '2026-01-05T10:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO games VALUES (12, 1, '2026-01-05T10:00:00Z', '2026-01-02T00:00:00Z');
      INSERT INTO games VALUES (20, 2, NULL, '2026-02-02T00:00:00Z');
      INSERT INTO games VALUES (21, 2, NULL, '2026-02-01T00:00:00Z');
      PRAGMA user_version = 17;
    `);

    migrateDatabase(database);

    expect(database.pragma('user_version', { simple: true })).toBe(18);
    expect(
      database
        .prepare(
          `SELECT id, tournament_id, sort_order
             FROM games
            ORDER BY tournament_id, sort_order, id`,
        )
        .all(),
    ).toEqual([
      { id: 11, tournament_id: 1, sort_order: 0 },
      { id: 12, tournament_id: 1, sort_order: 1 },
      { id: 10, tournament_id: 1, sort_order: 2 },
      { id: 21, tournament_id: 2, sort_order: 0 },
      { id: 20, tournament_id: 2, sort_order: 1 },
    ]);
    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_master
            WHERE type = 'index' AND name = 'games_tournament_id_sort_order_idx'`,
        )
        .get(),
    ).toEqual({ name: 'games_tournament_id_sort_order_idx' });
    database.close();
  });
});
