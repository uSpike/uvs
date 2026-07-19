import type Database from 'better-sqlite3';
import type { StrategyKind } from '$lib/game-stats';
import { parseMatchupRole, type MatchupRole } from '$lib/matchup';
import { getDatabase } from './database';

/** One player defined for a season roster. */
export interface SeasonPlayerRecord {
  id: number;
  name: string;
  matchupRole: MatchupRole | null;
}

/** One season roster and all players defined for it. */
export interface SeasonRosterRecord {
  id: number;
  name: string;
  teamId: number;
  players: SeasonPlayerRecord[];
  strategies: SeasonStrategyRecord[];
}

/** One editable offense or defense configured for a season roster. */
export interface SeasonStrategyRecord {
  id: number;
  name: string;
  kind: StrategyKind;
  isDefault: boolean;
}

/** One reusable line within a tournament. */
export interface TournamentLineRecord {
  id: number;
  name: string;
  playerIds: number[];
}

/** One game associated with a tournament. */
export interface TournamentGameRecord {
  id: number;
  token: string;
  title: string;
  opponentName: string;
  playedAt: string | null;
}

/** Tournament configuration shown on team and administration pages. */
export interface TournamentRecord {
  id: number;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  seasonRosterId: number;
  seasonRosterName: string;
  teamId: number;
  teamName: string;
  teamSlug: string;
  playerIds: number[];
  lines: TournamentLineRecord[];
  games: TournamentGameRecord[];
  gameCount: number;
}

/** Team configuration needed to manage rosters and tournaments. */
export interface TeamTournamentSetup {
  id: number;
  name: string;
  slug: string;
  rosters: SeasonRosterRecord[];
  tournaments: TournamentRecord[];
}

interface TournamentRow {
  id: number;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  season_roster_id: number;
  season_roster_name: string;
  team_id: number;
  team_name: string;
  team_slug: string;
  game_count: number;
}

/** SQLite repository for season rosters, tournament attendance, and lines. */
export class TournamentRepository {
  constructor(private readonly database: Database.Database = getDatabase()) {}

  /** List all tournaments as game-creation choices. */
  listTournaments(): TournamentRecord[] {
    const rows = this.database.prepare(
      `${tournamentQuery('')} ORDER BY teams.name, tournaments.name`,
    ).all() as TournamentRow[];
    return rows.map((row) => this.mapTournament(row));
  }

  /** Return one team's complete roster and tournament setup. */
  getTeamSetup(slug: string): TeamTournamentSetup | null {
    const team = this.database
      .prepare('SELECT id, name, slug FROM teams WHERE slug = ?')
      .get(slug) as { id: number; name: string; slug: string } | undefined;
    if (!team) return null;

    const rosterRows = this.database
      .prepare('SELECT id, name, team_id FROM season_rosters WHERE team_id = ? ORDER BY created_at, id')
      .all(team.id) as Array<{ id: number; name: string; team_id: number }>;
    const playerStatement = this.database.prepare(
      `SELECT id, name, matchup_role AS matchupRole
         FROM players
        WHERE season_roster_id = ?
        ORDER BY name COLLATE NOCASE, id`,
    );
    const strategyStatement = this.database.prepare(
      `SELECT id, name, kind, is_default
         FROM season_strategies
        WHERE season_roster_id = ?
        ORDER BY kind, is_default DESC, name COLLATE NOCASE, id`,
    );
    const rosters = rosterRows.map((roster): SeasonRosterRecord => ({
      id: roster.id,
      name: roster.name,
      teamId: roster.team_id,
      players: playerStatement.all(roster.id) as SeasonPlayerRecord[],
      strategies: (strategyStatement.all(roster.id) as Array<{
        id: number;
        name: string;
        kind: StrategyKind;
        is_default: number;
      }>).map((strategy) => ({
        id: strategy.id,
        name: strategy.name,
        kind: strategy.kind,
        isDefault: strategy.is_default === 1,
      })),
    }));
    const tournamentRows = this.database
      .prepare(
        `${tournamentQuery('WHERE teams.id = ?')} ORDER BY tournaments.starts_on, tournaments.id`,
      )
      .all(team.id) as TournamentRow[];
    return {
      ...team,
      rosters,
      tournaments: tournamentRows.map((row) => this.mapTournament(row)),
    };
  }

  /** Return one tournament if it belongs to the supplied public team URL. */
  getTournament(teamSlug: string, tournamentId: number): TournamentRecord | null {
    const row = this.database
      .prepare(tournamentQuery('WHERE teams.slug = ? AND tournaments.id = ?'))
      .get(teamSlug, tournamentId) as TournamentRow | undefined;
    return row ? this.mapTournament(row) : null;
  }

  /** Create an empty season roster. */
  createSeasonRoster(teamId: number, name: string): number {
    this.requireTeam(teamId);
    const normalized = requiredText(name, 120, 'Season roster name');
    return this.database.transaction(() => {
      const result = this.database
        .prepare('INSERT INTO season_rosters (team_id, name) VALUES (?, ?)')
        .run(teamId, normalized);
      const seasonRosterId = Number(result.lastInsertRowid);
      const insert = this.database.prepare(
        `INSERT INTO season_strategies (season_roster_id, kind, name, is_default)
         VALUES (?, ?, ?, 1)`,
      );
      insert.run(seasonRosterId, 'offense', 'Hex');
      insert.run(seasonRosterId, 'defense', 'Person');
      return seasonRosterId;
    })();
  }

  /** Add an offense or defense and optionally make it the season default. */
  addStrategy(
    seasonRosterId: number,
    kindInput: StrategyKind,
    name: string,
    makeDefault = false,
  ): number {
    this.requireSeasonRoster(seasonRosterId);
    const kind = strategyKind(kindInput);
    const normalized = requiredText(name, 80, `${kind === 'offense' ? 'Offense' : 'Defense'} name`);
    return this.database.transaction(() => {
      const hasDefault = this.database
        .prepare(
          `SELECT 1 FROM season_strategies
            WHERE season_roster_id = ? AND kind = ? AND is_default = 1`,
        )
        .get(seasonRosterId, kind);
      const isDefault = makeDefault || !hasDefault;
      if (isDefault) {
        this.database
          .prepare(
            `UPDATE season_strategies SET is_default = 0
              WHERE season_roster_id = ? AND kind = ?`,
          )
          .run(seasonRosterId, kind);
      }
      const result = this.database
        .prepare(
          `INSERT INTO season_strategies (season_roster_id, kind, name, is_default)
           VALUES (?, ?, ?, ?)`,
        )
        .run(seasonRosterId, kind, normalized, isDefault ? 1 : 0);
      return Number(result.lastInsertRowid);
    })();
  }

  /** Rename a strategy and optionally promote it to the default for its kind. */
  updateStrategy(strategyId: number, name: string, makeDefault: boolean): void {
    const strategy = this.requireStrategy(strategyId);
    const normalized = requiredText(name, 80, 'Strategy name');
    this.database.transaction(() => {
      if (makeDefault) {
        this.database
          .prepare(
            `UPDATE season_strategies SET is_default = 0
              WHERE season_roster_id = ? AND kind = ?`,
          )
          .run(strategy.season_roster_id, strategy.kind);
      }
      this.database
        .prepare(
          `UPDATE season_strategies
              SET name = ?, is_default = CASE WHEN ? THEN 1 ELSE is_default END,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?`,
        )
        .run(normalized, makeDefault ? 1 : 0, strategyId);
    })();
  }

  /** Delete an unused strategy while retaining a default for its category. */
  deleteStrategy(strategyId: number): void {
    const strategy = this.requireStrategy(strategyId);
    const used = this.database
      .prepare(
        `SELECT 1 FROM game_points
          WHERE initial_offense_strategy_id = ? OR initial_defense_strategy_id = ?
         UNION ALL
        SELECT 1 FROM game_events
         WHERE type = 'strategy_set'
           AND CAST(json_extract(payload_json, '$.strategyId') AS INTEGER) = ?
         UNION ALL
        SELECT 1 FROM manual_game_points
         WHERE offense_strategy_id = ? OR defense_strategy_id = ?
         LIMIT 1`,
      )
      .get(strategyId, strategyId, strategyId, strategyId, strategyId);
    if (used) throw new Error('A strategy used by recorded stats cannot be deleted. Rename it instead.');
    const replacement = this.database
      .prepare(
        `SELECT id FROM season_strategies
          WHERE season_roster_id = ? AND kind = ? AND id <> ?
          ORDER BY is_default DESC, created_at, id LIMIT 1`,
      )
      .get(strategy.season_roster_id, strategy.kind, strategyId) as { id: number } | undefined;
    if (!replacement) throw new Error('Keep at least one offense and one defense on every season roster.');
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM season_strategies WHERE id = ?').run(strategyId);
      if (strategy.is_default === 1) {
        this.database
          .prepare('UPDATE season_strategies SET is_default = 1 WHERE id = ?')
          .run(replacement.id);
      }
    })();
  }

  /** Rename an existing season roster. */
  renameSeasonRoster(seasonRosterId: number, name: string): void {
    this.requireSeasonRoster(seasonRosterId);
    const normalized = requiredText(name, 120, 'Season roster name');
    this.database
      .prepare('UPDATE season_rosters SET name = ? WHERE id = ?')
      .run(normalized, seasonRosterId);
  }

  /** Delete a season roster and its setup data when it has no games. */
  deleteSeasonRoster(seasonRosterId: number): void {
    this.requireSeasonRoster(seasonRosterId);
    const game = this.database
      .prepare(
        `SELECT games.id
           FROM games
           JOIN tournaments ON tournaments.id = games.tournament_id
          WHERE tournaments.season_roster_id = ?
          LIMIT 1`,
      )
      .get(seasonRosterId);
    if (game) {
      throw new Error('A roster with games cannot be deleted. Rename it or move its games first.');
    }

    this.database.transaction(() => {
      this.database.prepare('DELETE FROM tournaments WHERE season_roster_id = ?').run(seasonRosterId);
      this.database.prepare('DELETE FROM players WHERE season_roster_id = ?').run(seasonRosterId);
      this.database.prepare('DELETE FROM season_rosters WHERE id = ?').run(seasonRosterId);
    })();
  }

  /** Add a season-specific player. */
  addPlayer(seasonRosterId: number, name: string, matchupRole: MatchupRole): number {
    this.requireSeasonRoster(seasonRosterId);
    const normalized = requiredText(name, 120, 'Player name');
    const role = parseMatchupRole(matchupRole);
    const result = this.database
      .prepare('INSERT INTO players (season_roster_id, name, matchup_role) VALUES (?, ?, ?)')
      .run(seasonRosterId, normalized, role);
    return Number(result.lastInsertRowid);
  }

  /** Rename a season-specific player without changing historical attribution. */
  renamePlayer(playerId: number, name: string): void {
    this.requirePlayer(playerId);
    const normalized = requiredText(name, 120, 'Player name');
    this.database.prepare('UPDATE players SET name = ? WHERE id = ?').run(normalized, playerId);
  }

  /** Update a season player's name and preferred matchup role. */
  updatePlayer(playerId: number, name: string, matchupRole: MatchupRole): void {
    this.requirePlayer(playerId);
    const normalized = requiredText(name, 120, 'Player name');
    const role = parseMatchupRole(matchupRole);
    this.database
      .prepare('UPDATE players SET name = ?, matchup_role = ? WHERE id = ?')
      .run(normalized, role, playerId);
  }

  /** Delete a player who is not referenced by recorded point data. */
  deletePlayer(playerId: number): void {
    this.requirePlayer(playerId);
    const recordedUse = this.database
      .prepare(
        `SELECT 1
           FROM game_point_players
          WHERE player_id = ?
          UNION ALL
         SELECT 1
           FROM game_points
          WHERE puller_player_id = ?
          UNION ALL
         SELECT 1
          FROM game_events, json_each(game_events.payload_json) AS event_values
          WHERE event_values.key IN (
                  'playerId', 'throwerId', 'receiverId', 'intendedReceiverId', 'defenderId',
                  'outgoingPlayerId', 'incomingPlayerId'
                )
            AND CAST(event_values.value AS INTEGER) = ?
          UNION ALL
         SELECT 1
           FROM manual_player_game_statistics
          WHERE player_id = ?
          UNION ALL
         SELECT 1
           FROM manual_game_points
          WHERE scorer_player_id = ?
          UNION ALL
         SELECT 1
           FROM game_highlight_players
          WHERE player_id = ?
          LIMIT 1`,
      )
      .get(playerId, playerId, playerId, playerId, playerId, playerId);
    if (recordedUse) {
      throw new Error('A player used in recorded point data cannot be deleted. Rename them instead.');
    }

    this.database.transaction(() => {
      this.database.prepare('DELETE FROM tournament_line_players WHERE player_id = ?').run(playerId);
      this.database.prepare('DELETE FROM tournament_players WHERE player_id = ?').run(playerId);
      this.database.prepare('DELETE FROM players WHERE id = ?').run(playerId);
    })();
  }

  /** Create a tournament with an explicit subset of its season roster. */
  createTournament(input: {
    seasonRosterId: number;
    name: string;
    startsOn: string | null;
    endsOn: string | null;
    playerIds: number[];
  }): number {
    this.requireSeasonRoster(input.seasonRosterId);
    const name = requiredText(input.name, 160, 'Event name');
    const startsOn = optionalDate(input.startsOn, 'Start date');
    const endsOn = optionalDate(input.endsOn, 'End date');
    if (startsOn && endsOn && startsOn > endsOn) {
      throw new Error('Event end date cannot be before its start date.');
    }
    const playerIds = uniqueIds(input.playerIds, 'Event player');
    this.requirePlayersInSeasonRoster(input.seasonRosterId, playerIds);

    return this.database.transaction(() => {
      const result = this.database
        .prepare(
          'INSERT INTO tournaments (season_roster_id, name, starts_on, ends_on) VALUES (?, ?, ?, ?)',
        )
        .run(input.seasonRosterId, name, startsOn, endsOn);
      const tournamentId = Number(result.lastInsertRowid);
      this.replaceTournamentPlayers(tournamentId, playerIds);
      return tournamentId;
    })();
  }

  /** Rename a tournament without changing its roster, lines, or games. */
  renameTournament(tournamentId: number, name: string): void {
    this.requireTournament(tournamentId);
    const normalized = requiredText(name, 160, 'Event name');
    this.database.prepare('UPDATE tournaments SET name = ? WHERE id = ?').run(normalized, tournamentId);
  }

  /** Delete a tournament and its lines when it has no games. */
  deleteTournament(tournamentId: number): void {
    this.requireTournament(tournamentId);
    if (this.database.prepare('SELECT 1 FROM games WHERE tournament_id = ? LIMIT 1').get(tournamentId)) {
      throw new Error('An event with games cannot be deleted. Move or delete its games first.');
    }
    this.database.prepare('DELETE FROM tournaments WHERE id = ?').run(tournamentId);
  }

  /** Replace tournament attendance with a validated season-roster subset. */
  updateTournamentPlayers(tournamentId: number, playerIdsInput: number[]): void {
    const tournament = this.requireTournament(tournamentId);
    const playerIds = uniqueIds(playerIdsInput, 'Event player');
    this.requirePlayersInSeasonRoster(tournament.season_roster_id, playerIds);
    const retained = new Set(playerIds);
    const tournamentGameIds = (
      this.database.prepare('SELECT id FROM games WHERE tournament_id = ?').all(tournamentId) as
        Array<{ id: number }>
    ).map((row) => row.id);
    const used = new Set(tournamentGameIds.flatMap((gameId) => this.usedGamePlayerIds(gameId)));
    if ([...used].some((playerId) => !retained.has(playerId))) {
      throw new Error('A player already used in this event cannot be removed.');
    }

    this.database.transaction(() => {
      this.database
        .prepare(
          `DELETE FROM tournament_line_players
            WHERE line_id IN (SELECT id FROM tournament_lines WHERE tournament_id = ?)
              AND player_id NOT IN (SELECT value FROM json_each(?))`,
        )
        .run(tournamentId, JSON.stringify(playerIds));
      this.replaceTournamentPlayers(tournamentId, playerIds);
    })();
  }

  /** Create a named tournament line and its suggested players. */
  createLine(tournamentId: number, name: string, playerIdsInput: number[]): number {
    this.requireTournament(tournamentId);
    const normalized = requiredText(name, 80, 'Line name');
    const playerIds = uniqueIds(playerIdsInput, 'Suggested player');
    this.requireTournamentPlayers(tournamentId, playerIds);
    return this.database.transaction(() => {
      const sortOrder = (
        this.database
          .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tournament_lines WHERE tournament_id = ?')
          .get(tournamentId) as { next: number }
      ).next;
      const result = this.database
        .prepare('INSERT INTO tournament_lines (tournament_id, name, sort_order) VALUES (?, ?, ?)')
        .run(tournamentId, normalized, sortOrder);
      const lineId = Number(result.lastInsertRowid);
      this.replaceLinePlayers(lineId, playerIds);
      return lineId;
    })();
  }

  /** Update a line name and suggested player set. */
  updateLine(lineId: number, name: string, playerIdsInput: number[]): void {
    const line = this.requireLine(lineId);
    const normalized = requiredText(name, 80, 'Line name');
    const playerIds = uniqueIds(playerIdsInput, 'Suggested player');
    this.requireTournamentPlayers(line.tournament_id, playerIds);
    this.database.transaction(() => {
      this.database.prepare('UPDATE tournament_lines SET name = ? WHERE id = ?').run(normalized, lineId);
      this.replaceLinePlayers(lineId, playerIds);
    })();
  }

  /** Delete an unused tournament line. */
  deleteLine(lineId: number): void {
    this.requireLine(lineId);
    const used = this.database
      .prepare(
        `SELECT 1 FROM game_points WHERE line_id = ?
         UNION ALL SELECT 1 FROM manual_game_points WHERE line_id = ?
         LIMIT 1`,
      )
      .get(lineId, lineId);
    if (used) throw new Error('A line used by a recorded point cannot be deleted.');
    this.database.prepare('DELETE FROM tournament_lines WHERE id = ?').run(lineId);
  }

  private mapTournament(row: TournamentRow): TournamentRecord {
    const playerIds = (
      this.database
        .prepare(
          'SELECT player_id FROM tournament_players WHERE tournament_id = ? ORDER BY sort_order, player_id',
        )
        .all(row.id) as Array<{ player_id: number }>
    ).map((player) => player.player_id);
    const lineRows = this.database
      .prepare('SELECT id, name FROM tournament_lines WHERE tournament_id = ? ORDER BY sort_order, id')
      .all(row.id) as Array<{ id: number; name: string }>;
    const linePlayerStatement = this.database.prepare(
      'SELECT player_id FROM tournament_line_players WHERE line_id = ? ORDER BY sort_order, player_id',
    );
    const games = this.database
      .prepare(
        `SELECT id, token, title, opponent_name, played_at
           FROM games
          WHERE tournament_id = ?
          ORDER BY COALESCE(played_at, created_at), id`,
      )
      .all(row.id) as Array<{
        id: number;
        token: string;
        title: string;
        opponent_name: string;
        played_at: string | null;
      }>;
    return {
      id: row.id,
      name: row.name,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      seasonRosterId: row.season_roster_id,
      seasonRosterName: row.season_roster_name,
      teamId: row.team_id,
      teamName: row.team_name,
      teamSlug: row.team_slug,
      playerIds,
      lines: lineRows.map((line) => ({
        ...line,
        playerIds: (linePlayerStatement.all(line.id) as Array<{ player_id: number }>).map(
          (player) => player.player_id,
        ),
      })),
      games: games.map((game) => ({
        id: game.id,
        token: game.token,
        title: game.title,
        opponentName: game.opponent_name,
        playedAt: game.played_at,
      })),
      gameCount: row.game_count,
    };
  }

  private replaceTournamentPlayers(tournamentId: number, playerIds: number[]): void {
    this.database.prepare('DELETE FROM tournament_players WHERE tournament_id = ?').run(tournamentId);
    const insert = this.database.prepare(
      'INSERT INTO tournament_players (tournament_id, player_id, sort_order) VALUES (?, ?, ?)',
    );
    playerIds.forEach((playerId, index) => insert.run(tournamentId, playerId, index));
  }

  private replaceLinePlayers(lineId: number, playerIds: number[]): void {
    this.database.prepare('DELETE FROM tournament_line_players WHERE line_id = ?').run(lineId);
    const insert = this.database.prepare(
      'INSERT INTO tournament_line_players (line_id, player_id, sort_order) VALUES (?, ?, ?)',
    );
    playerIds.forEach((playerId, index) => insert.run(lineId, playerId, index));
  }

  private requireTeam(teamId: number): void {
    if (!Number.isSafeInteger(teamId) || !this.database.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) {
      throw new Error('Selected team does not exist.');
    }
  }

  private requireSeasonRoster(id: number): { id: number; team_id: number } {
    const row = this.database.prepare('SELECT id, team_id FROM season_rosters WHERE id = ?').get(id) as
      | { id: number; team_id: number }
      | undefined;
    if (!row) throw new Error('Selected season roster does not exist.');
    return row;
  }

  private requireTournament(id: number): { id: number; season_roster_id: number } {
    const row = this.database
      .prepare('SELECT id, season_roster_id FROM tournaments WHERE id = ?')
      .get(id) as { id: number; season_roster_id: number } | undefined;
    if (!row) throw new Error('Selected event does not exist.');
    return row;
  }

  private requirePlayer(id: number): { id: number; season_roster_id: number } {
    const row = this.database
      .prepare('SELECT id, season_roster_id FROM players WHERE id = ?')
      .get(id) as { id: number; season_roster_id: number } | undefined;
    if (!row) throw new Error('Selected player does not exist.');
    return row;
  }

  private requireLine(id: number): { id: number; tournament_id: number } {
    const row = this.database.prepare('SELECT id, tournament_id FROM tournament_lines WHERE id = ?').get(id) as
      | { id: number; tournament_id: number }
      | undefined;
    if (!row) throw new Error('Selected line does not exist.');
    return row;
  }

  private requireStrategy(id: number): {
    id: number;
    season_roster_id: number;
    kind: StrategyKind;
    is_default: number;
  } {
    const row = this.database
      .prepare('SELECT id, season_roster_id, kind, is_default FROM season_strategies WHERE id = ?')
      .get(id) as {
        id: number;
        season_roster_id: number;
        kind: StrategyKind;
        is_default: number;
      } | undefined;
    if (!row) throw new Error('Selected strategy does not exist.');
    return row;
  }

  private requirePlayersInSeasonRoster(seasonRosterId: number, playerIds: number[]): void {
    if (playerIds.length === 0) return;
    const count = (
      this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM players
            WHERE season_roster_id = ? AND id IN (SELECT value FROM json_each(?))`,
        )
        .get(seasonRosterId, JSON.stringify(playerIds)) as { count: number }
    ).count;
    if (count !== playerIds.length) throw new Error('Every selected player must belong to the season roster.');
  }

  private requireTournamentPlayers(tournamentId: number, playerIds: number[]): void {
    if (playerIds.length === 0) return;
    const count = (
      this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM tournament_players
            WHERE tournament_id = ? AND player_id IN (SELECT value FROM json_each(?))`,
        )
        .get(tournamentId, JSON.stringify(playerIds)) as { count: number }
    ).count;
    if (count !== playerIds.length) throw new Error('Every selected player must be on the event roster.');
  }

  private usedGamePlayerIds(gameId: number): number[] {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT player_id FROM (
           SELECT game_point_players.player_id AS player_id
             FROM game_point_players
             JOIN game_points ON game_points.id = game_point_players.point_id
            WHERE game_points.game_id = ?
           UNION ALL
           SELECT game_points.puller_player_id AS player_id
             FROM game_points
            WHERE game_points.game_id = ? AND game_points.puller_player_id IS NOT NULL
           UNION ALL
           SELECT CAST(event_values.value AS INTEGER) AS player_id
             FROM game_events, json_each(game_events.payload_json) AS event_values
            WHERE game_events.game_id = ?
              AND event_values.key IN (
                'playerId', 'throwerId', 'receiverId', 'intendedReceiverId', 'defenderId',
                'outgoingPlayerId', 'incomingPlayerId'
              )
              AND event_values.value IS NOT NULL
           UNION ALL
           SELECT player_id
             FROM manual_player_game_statistics
            WHERE game_id = ?
           UNION ALL
           SELECT scorer_player_id AS player_id
             FROM manual_game_points
            WHERE game_id = ? AND scorer_player_id IS NOT NULL
           UNION ALL
           SELECT game_highlight_players.player_id
             FROM game_highlight_players
             JOIN game_highlights ON game_highlights.id = game_highlight_players.highlight_id
            WHERE game_highlights.game_id = ?
         )`,
      )
      .all(gameId, gameId, gameId, gameId, gameId, gameId) as Array<{ player_id: number }>;
    return rows.map((row) => row.player_id);
  }
}

function tournamentQuery(suffix: string): string {
  return `SELECT tournaments.id, tournaments.name, tournaments.starts_on, tournaments.ends_on,
                 season_rosters.id AS season_roster_id,
                 season_rosters.name AS season_roster_name,
                 teams.id AS team_id, teams.name AS team_name, teams.slug AS team_slug,
                 COUNT(games.id) AS game_count
            FROM tournaments
            JOIN season_rosters ON season_rosters.id = tournaments.season_roster_id
            JOIN teams ON teams.id = season_rosters.team_id
            LEFT JOIN games ON games.tournament_id = tournaments.id
            ${suffix}
           GROUP BY tournaments.id`;
}

function requiredText(value: string, maxLength: number, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  if (normalized.length > maxLength) throw new Error(`${name} must be ${maxLength} characters or fewer.`);
  return normalized;
}

function strategyKind(value: StrategyKind): StrategyKind {
  if (value !== 'offense' && value !== 'defense') {
    throw new Error('Select offense or defense.');
  }
  return value;
}

function optionalDate(value: string | null, name: string): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new Error(`${name} must be a valid date.`);
  }
  return normalized;
}

function uniqueIds(values: number[], name: string): number[] {
  const ids = [...new Set(values)];
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error(`${name} selection is invalid.`);
  }
  return ids;
}
