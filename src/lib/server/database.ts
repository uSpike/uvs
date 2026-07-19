import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DATABASE_VERSION = 14;

let applicationDatabase: Database.Database | null = null;

/** Open, configure, and migrate a Reco application database. */
export function openDatabase(filename: string): Database.Database {
  if (filename !== ':memory:') {
    mkdirSync(dirname(resolve(filename)), { recursive: true });
  }

  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  if (filename !== ':memory:') {
    database.pragma('journal_mode = WAL');
  }
  migrateDatabase(database);
  return database;
}

/** Return the process-wide application database. */
export function getDatabase(): Database.Database {
  if (!applicationDatabase) {
    applicationDatabase = openDatabase(process.env.RECO_DATABASE_PATH ?? './data/reco-web.sqlite');
  }
  return applicationDatabase;
}

/** Apply all database migrations supported by this application version. */
export function migrateDatabase(database: Database.Database): void {
  const currentVersion = database.pragma('user_version', { simple: true }) as number;
  if (currentVersion > DATABASE_VERSION) {
    throw new Error(
      `Database schema ${currentVersion} is newer than supported schema ${DATABASE_VERSION}.`,
    );
  }
  database.transaction(() => {
    if (currentVersion < 1) {
      database.exec(`
      CREATE TABLE teams (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 140),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE games (
        id INTEGER PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
        token TEXT NOT NULL UNIQUE CHECK (length(token) >= 20),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
        video_source TEXT NOT NULL,
        metadata_jsonl TEXT NOT NULL,
        metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
        settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX games_team_id_created_at_idx
        ON games(team_id, created_at DESC);
      `);
    }

    if (currentVersion < 2) {
      database.exec(`
        CREATE TABLE season_rosters (
          id INTEGER PRIMARY KEY,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
          name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE (team_id, name)
        );

        CREATE TABLE players (
          id INTEGER PRIMARY KEY,
          season_roster_id INTEGER NOT NULL REFERENCES season_rosters(id) ON DELETE RESTRICT,
          name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE INDEX players_season_roster_id_name_idx
          ON players(season_roster_id, name COLLATE NOCASE);

        CREATE TABLE tournaments (
          id INTEGER PRIMARY KEY,
          season_roster_id INTEGER NOT NULL REFERENCES season_rosters(id) ON DELETE RESTRICT,
          name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
          starts_on TEXT,
          ends_on TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          CHECK (starts_on IS NULL OR date(starts_on) IS NOT NULL),
          CHECK (ends_on IS NULL OR date(ends_on) IS NOT NULL),
          CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on),
          UNIQUE (season_roster_id, name)
        );

        CREATE TABLE tournament_players (
          tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (tournament_id, player_id)
        );

        CREATE TABLE tournament_lines (
          id INTEGER PRIMARY KEY,
          tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
          name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
          sort_order INTEGER NOT NULL DEFAULT 0,
          UNIQUE (tournament_id, name)
        );

        CREATE TABLE tournament_line_players (
          line_id INTEGER NOT NULL REFERENCES tournament_lines(id) ON DELETE CASCADE,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (line_id, player_id)
        );

        ALTER TABLE games ADD COLUMN tournament_id INTEGER REFERENCES tournaments(id) ON DELETE RESTRICT;
        ALTER TABLE games ADD COLUMN opponent_name TEXT NOT NULL DEFAULT 'Opponent'
          CHECK (length(opponent_name) BETWEEN 1 AND 160);
        ALTER TABLE games ADD COLUMN played_at TEXT;
        ALTER TABLE games ADD COLUMN player_count INTEGER NOT NULL DEFAULT 7
          CHECK (player_count BETWEEN 1 AND 20);
        ALTER TABLE games ADD COLUMN initial_our_score INTEGER NOT NULL DEFAULT 0
          CHECK (initial_our_score >= 0);
        ALTER TABLE games ADD COLUMN initial_opponent_score INTEGER NOT NULL DEFAULT 0
          CHECK (initial_opponent_score >= 0);

        CREATE TABLE game_players (
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (game_id, player_id)
        );

        CREATE TABLE game_points (
          id INTEGER PRIMARY KEY,
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
          line_id INTEGER NOT NULL REFERENCES tournament_lines(id) ON DELETE RESTRICT,
          starting_possession TEXT NOT NULL
            CHECK (starting_possession IN ('offense', 'defense')),
          start_time_ms INTEGER NOT NULL CHECK (start_time_ms >= 0),
          puller_player_id INTEGER REFERENCES players(id) ON DELETE RESTRICT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE (game_id, sequence_number)
        );

        CREATE INDEX game_points_game_id_start_time_idx
          ON game_points(game_id, start_time_ms, id);

        CREATE TABLE game_point_players (
          point_id INTEGER NOT NULL REFERENCES game_points(id) ON DELETE CASCADE,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (point_id, player_id)
        );

        CREATE TABLE game_events (
          id INTEGER PRIMARY KEY,
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          point_id INTEGER REFERENCES game_points(id) ON DELETE CASCADE,
          time_ms INTEGER NOT NULL CHECK (time_ms >= 0),
          type TEXT NOT NULL CHECK (
            type IN (
              'completion', 'turnover', 'defended', 'opponent_turnover',
              'goal', 'conceded', 'substitution', 'stoppage', 'score_set'
            )
          ),
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE INDEX game_events_game_id_time_idx
          ON game_events(game_id, time_ms, id);
        CREATE INDEX game_events_point_id_time_idx
          ON game_events(point_id, time_ms, id);

        INSERT INTO season_rosters (team_id, name)
        SELECT DISTINCT teams.id, 'Imported roster'
          FROM teams
          JOIN games ON games.team_id = teams.id;

        INSERT INTO tournaments (season_roster_id, name)
        SELECT season_rosters.id, 'Imported games'
          FROM season_rosters;

        UPDATE games
           SET tournament_id = (
             SELECT tournaments.id
               FROM tournaments
               JOIN season_rosters ON season_rosters.id = tournaments.season_roster_id
              WHERE season_rosters.team_id = games.team_id
              LIMIT 1
           );

        CREATE INDEX games_tournament_id_played_at_idx
          ON games(tournament_id, played_at, id);
      `);
    }

    if (currentVersion < 3) {
      database.exec(`
        DELETE FROM tournaments
         WHERE name = 'Imported games'
           AND NOT EXISTS (SELECT 1 FROM games WHERE games.tournament_id = tournaments.id)
           AND NOT EXISTS (
             SELECT 1 FROM tournament_players
              WHERE tournament_players.tournament_id = tournaments.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM tournament_lines
              WHERE tournament_lines.tournament_id = tournaments.id
           );

        DELETE FROM season_rosters
         WHERE name = 'Imported roster'
           AND NOT EXISTS (
             SELECT 1 FROM players
              WHERE players.season_roster_id = season_rosters.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM tournaments
              WHERE tournaments.season_roster_id = season_rosters.id
           );
      `);
    }

    if (currentVersion < 4) {
      database.exec(`
        INSERT INTO game_players (game_id, player_id, sort_order)
        SELECT games.id, tournament_players.player_id, tournament_players.sort_order
          FROM games
          JOIN tournament_players
            ON tournament_players.tournament_id = games.tournament_id
         WHERE NOT EXISTS (
           SELECT 1 FROM game_players
            WHERE game_players.game_id = games.id
         );
      `);
    }

    if (currentVersion < 5) {
      database.exec('DROP TABLE game_players;');
    }

    if (currentVersion < 6) {
      const teamColumns = database.pragma('table_info(teams)') as Array<{ name: string }>;
      if (!teamColumns.some((column) => column.name === 'password_hash')) {
        database.exec(`
          ALTER TABLE teams ADD COLUMN password_hash TEXT
            CHECK (password_hash IS NULL OR length(password_hash) BETWEEN 40 AND 512);
        `);
      }
      database.exec(`
        CREATE TABLE IF NOT EXISTS game_share_links (
          id INTEGER PRIMARY KEY,
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          token TEXT NOT NULL UNIQUE CHECK (length(token) >= 32),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE INDEX IF NOT EXISTS game_share_links_game_id_created_at_idx
          ON game_share_links(game_id, created_at DESC, id DESC);
      `);
    }

    if (currentVersion < 7) {
      const teamColumns = database.pragma('table_info(teams)') as Array<{ name: string }>;
      if (!teamColumns.some((column) => column.name === 'password_version')) {
        database.exec(`
          ALTER TABLE teams ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0
            CHECK (password_version >= 0);
        `);
      }
    }

    if (currentVersion < 8) {
      const playerColumns = database.pragma('table_info(players)') as Array<{ name: string }>;
      if (!playerColumns.some((column) => column.name === 'matchup_role')) {
        database.exec(`
          ALTER TABLE players ADD COLUMN matchup_role TEXT
            CHECK (matchup_role IS NULL OR matchup_role IN ('mmp', 'fmp'));
        `);
      }
      database.exec(`
        CREATE TABLE IF NOT EXISTS game_player_matchup_overrides (
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          matchup_role TEXT NOT NULL CHECK (matchup_role IN ('mmp', 'fmp')),
          PRIMARY KEY (game_id, player_id)
        );

        CREATE TABLE IF NOT EXISTS game_point_player_matchup_overrides (
          point_id INTEGER NOT NULL REFERENCES game_points(id) ON DELETE CASCADE,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          matchup_role TEXT NOT NULL CHECK (matchup_role IN ('mmp', 'fmp')),
          PRIMARY KEY (point_id, player_id)
        );
      `);
    }

    if (currentVersion < 9) {
      const gameColumns = database.pragma('table_info(games)') as Array<{ name: string }>;
      if (!gameColumns.some((column) => column.name === 'has_video')) {
        database.exec(`
          ALTER TABLE games ADD COLUMN has_video INTEGER NOT NULL DEFAULT 1
            CHECK (has_video IN (0, 1));
        `);
      }
      database.exec(`
        CREATE TABLE IF NOT EXISTS manual_player_game_statistics (
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
          points_played INTEGER NOT NULL CHECK (points_played >= 0),
          hockey_assists INTEGER NOT NULL CHECK (hockey_assists >= 0),
          assists INTEGER NOT NULL CHECK (assists >= 0),
          goals INTEGER NOT NULL CHECK (goals >= 0),
          blocks INTEGER NOT NULL CHECK (blocks >= 0),
          PRIMARY KEY (game_id, player_id)
        );

        CREATE TABLE IF NOT EXISTS manual_game_points (
          id INTEGER PRIMARY KEY,
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
          line_id INTEGER NOT NULL REFERENCES tournament_lines(id) ON DELETE RESTRICT,
          starting_possession TEXT NOT NULL
            CHECK (starting_possession IN ('offense', 'defense')),
          initial_defense_type TEXT
            CHECK (initial_defense_type IS NULL OR length(initial_defense_type) BETWEEN 1 AND 80),
          our_turnovers INTEGER NOT NULL CHECK (our_turnovers >= 0),
          scoring_method TEXT
            CHECK (scoring_method IS NULL OR length(scoring_method) BETWEEN 1 AND 80),
          scorer_player_id INTEGER REFERENCES players(id) ON DELETE RESTRICT,
          our_score INTEGER NOT NULL CHECK (our_score >= 0),
          opponent_score INTEGER NOT NULL CHECK (opponent_score >= 0),
          UNIQUE (game_id, sequence_number)
        );

        CREATE INDEX IF NOT EXISTS manual_game_points_game_id_sequence_idx
          ON manual_game_points(game_id, sequence_number, id);
      `);
    }

    if (currentVersion < 10) {
      const hasVersionTenSchema = Boolean(
        database
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'game_highlights'")
          .get(),
      );
      if (!hasVersionTenSchema) database.exec(`
        CREATE TABLE season_strategies (
          id INTEGER PRIMARY KEY,
          season_roster_id INTEGER NOT NULL REFERENCES season_rosters(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('offense', 'defense')),
          name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
          is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE (season_roster_id, kind, name)
        );

        CREATE UNIQUE INDEX season_strategies_one_default_idx
          ON season_strategies(season_roster_id, kind)
          WHERE is_default = 1;
        CREATE INDEX season_strategies_roster_kind_idx
          ON season_strategies(season_roster_id, kind, name COLLATE NOCASE);

        INSERT INTO season_strategies (season_roster_id, kind, name, is_default)
        SELECT id, 'offense', 'Hex', 1 FROM season_rosters;
        INSERT INTO season_strategies (season_roster_id, kind, name, is_default)
        SELECT id, 'defense', 'Person', 1 FROM season_rosters;

        ALTER TABLE game_points ADD COLUMN initial_offense_strategy_id INTEGER
          REFERENCES season_strategies(id) ON DELETE RESTRICT;
        ALTER TABLE game_points ADD COLUMN initial_defense_strategy_id INTEGER
          REFERENCES season_strategies(id) ON DELETE RESTRICT;

        UPDATE game_points
           SET initial_offense_strategy_id = (
                 SELECT season_strategies.id
                   FROM games
                   JOIN tournaments ON tournaments.id = games.tournament_id
                   JOIN season_strategies
                     ON season_strategies.season_roster_id = tournaments.season_roster_id
                    AND season_strategies.kind = 'offense'
                    AND season_strategies.is_default = 1
                  WHERE games.id = game_points.game_id
               ),
               initial_defense_strategy_id = (
                 SELECT season_strategies.id
                   FROM games
                   JOIN tournaments ON tournaments.id = games.tournament_id
                   JOIN season_strategies
                     ON season_strategies.season_roster_id = tournaments.season_roster_id
                    AND season_strategies.kind = 'defense'
                    AND season_strategies.is_default = 1
                  WHERE games.id = game_points.game_id
               );

        ALTER TABLE manual_game_points ADD COLUMN offense_strategy_id INTEGER
          REFERENCES season_strategies(id) ON DELETE RESTRICT;
        ALTER TABLE manual_game_points ADD COLUMN defense_strategy_id INTEGER
          REFERENCES season_strategies(id) ON DELETE RESTRICT;

        INSERT OR IGNORE INTO season_strategies (season_roster_id, kind, name, is_default)
        SELECT DISTINCT tournaments.season_roster_id, 'defense',
                        trim(manual_game_points.initial_defense_type), 0
          FROM manual_game_points
          JOIN games ON games.id = manual_game_points.game_id
          JOIN tournaments ON tournaments.id = games.tournament_id
         WHERE manual_game_points.initial_defense_type IS NOT NULL
           AND length(trim(manual_game_points.initial_defense_type)) BETWEEN 1 AND 80;

        UPDATE manual_game_points
           SET offense_strategy_id = (
                 SELECT season_strategies.id
                   FROM games
                   JOIN tournaments ON tournaments.id = games.tournament_id
                   JOIN season_strategies
                     ON season_strategies.season_roster_id = tournaments.season_roster_id
                    AND season_strategies.kind = 'offense'
                    AND season_strategies.is_default = 1
                  WHERE games.id = manual_game_points.game_id
               ),
               defense_strategy_id = COALESCE(
                 (
                   SELECT season_strategies.id
                     FROM games
                     JOIN tournaments ON tournaments.id = games.tournament_id
                     JOIN season_strategies
                       ON season_strategies.season_roster_id = tournaments.season_roster_id
                      AND season_strategies.kind = 'defense'
                      AND season_strategies.name = manual_game_points.initial_defense_type COLLATE NOCASE
                    WHERE games.id = manual_game_points.game_id
                    LIMIT 1
                 ),
                 (
                   SELECT season_strategies.id
                     FROM games
                     JOIN tournaments ON tournaments.id = games.tournament_id
                     JOIN season_strategies
                       ON season_strategies.season_roster_id = tournaments.season_roster_id
                      AND season_strategies.kind = 'defense'
                      AND season_strategies.is_default = 1
                    WHERE games.id = manual_game_points.game_id
                 )
               );

        ALTER TABLE game_events RENAME TO game_events_v9;
        CREATE TABLE game_events (
          id INTEGER PRIMARY KEY,
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          point_id INTEGER REFERENCES game_points(id) ON DELETE CASCADE,
          time_ms INTEGER NOT NULL CHECK (time_ms >= 0),
          type TEXT NOT NULL CHECK (
            type IN (
              'completion', 'turnover', 'defended', 'opponent_turnover',
              'goal', 'conceded', 'substitution', 'stoppage', 'score_set',
              'strategy_set'
            )
          ),
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        INSERT INTO game_events (
          id, game_id, point_id, time_ms, type, payload_json, created_at, updated_at
        )
        SELECT id, game_id, point_id, time_ms, type, payload_json, created_at, updated_at
          FROM game_events_v9;
        DROP TABLE game_events_v9;
        CREATE INDEX game_events_game_id_time_idx
          ON game_events(game_id, time_ms, id);
        CREATE INDEX game_events_point_id_time_idx
          ON game_events(point_id, time_ms, id);

        CREATE TABLE game_highlights (
          id INTEGER PRIMARY KEY,
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          start_time_ms INTEGER NOT NULL CHECK (start_time_ms >= 0),
          end_time_ms INTEGER NOT NULL CHECK (end_time_ms > start_time_ms),
          description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX game_highlights_game_time_idx
          ON game_highlights(game_id, start_time_ms, id);

        CREATE TABLE game_highlight_players (
          highlight_id INTEGER NOT NULL REFERENCES game_highlights(id) ON DELETE CASCADE,
          player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (highlight_id, player_id)
        );
      `);
    }

    if (currentVersion < 11) {
      database.exec(`
        UPDATE game_points
           SET initial_offense_strategy_id = NULL,
               initial_defense_strategy_id = NULL;
      `);
    }

    if (currentVersion < 12) {
      const teamColumns = database.pragma('table_info(teams)') as Array<{ name: string }>;
      if (!teamColumns.some((column) => column.name === 'password_plaintext')) {
        database.exec('ALTER TABLE teams ADD COLUMN password_plaintext TEXT;');
      }
    }

    if (currentVersion < 13) {
      database.exec(`
        ALTER TABLE game_events RENAME TO game_events_v12;
        CREATE TABLE game_events (
          id INTEGER PRIMARY KEY,
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          point_id INTEGER REFERENCES game_points(id) ON DELETE CASCADE,
          time_ms INTEGER NOT NULL CHECK (time_ms >= 0),
          type TEXT NOT NULL CHECK (
            type IN (
              'possession_start', 'completion', 'turnover', 'defended',
              'opponent_turnover', 'goal', 'conceded', 'substitution',
              'stoppage', 'score_set', 'strategy_set'
            )
          ),
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        INSERT INTO game_events (
          id, game_id, point_id, time_ms, type, payload_json, created_at, updated_at
        )
        SELECT id, game_id, point_id, time_ms, type, payload_json, created_at, updated_at
          FROM game_events_v12;
        DROP TABLE game_events_v12;
        CREATE INDEX game_events_game_id_time_idx
          ON game_events(game_id, time_ms, id);
        CREATE INDEX game_events_point_id_time_idx
          ON game_events(point_id, time_ms, id);
      `);
    }

    if (currentVersion < 14) {
      const gameColumns = database.pragma('table_info(games)') as Array<{ name: string }>;
      if (!gameColumns.some((column) => column.name === 'initial_lineup_endzone')) {
        database.exec(`
          ALTER TABLE games ADD COLUMN initial_lineup_endzone TEXT NOT NULL DEFAULT 'left'
            CHECK (initial_lineup_endzone IN ('left', 'right'));
        `);
      }
      const pointColumns = database.pragma('table_info(game_points)') as Array<{ name: string }>;
      if (!pointColumns.some((column) => column.name === 'lineup_endzone_override')) {
        database.exec(`
          ALTER TABLE game_points ADD COLUMN lineup_endzone_override TEXT
            CHECK (lineup_endzone_override IS NULL OR lineup_endzone_override IN ('left', 'right'));
        `);
      }
    }

    database.pragma(`user_version = ${DATABASE_VERSION}`);
  })();
}
