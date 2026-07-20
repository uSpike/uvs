import type Database from 'better-sqlite3';
import {
  calculateGameStatistics,
  calculatePointState,
  type DefendedPayload,
  type EventSpatialAnnotation,
  type GameEventPayload,
  type GameEventType,
  type GameHighlight,
  type GameTrackingSnapshot,
  type ManualPlayerGameStatistics,
  type ManualPointSummary,
  type PossessionStartPayload,
  type StartingPossession,
  type SpatialAnnotationRole,
  type StrategyKind,
  type StrategySetPayload,
  type TeamEndzone,
  type TrackingEvent,
  type TrackingGameData,
  type TrackingLine,
  type TrackingPlayer,
  type TrackingPoint,
  type TrackingStrategy,
} from '$lib/game-stats';
import { parseGameEventPayload, parseGameEventType } from '$lib/game-events';
import { parseOptionalMatchupRole, type MatchupRole } from '$lib/matchup';
import { getDatabase } from './database';

/** Input required to begin a point at the pull release. */
export interface StartPointInput {
  lineId: number;
  startingPossession: StartingPossession;
  startTimeMs: number;
  pullerPlayerId: number | null;
  playerIds: number[];
  matchupRoleOverrides: Record<number, MatchupRole>;
  lineupEndzoneOverride?: TeamEndzone | null;
  initialOffenseStrategyId?: number | null;
  initialDefenseStrategyId?: number | null;
}

/** Input accepted when adding or replacing an editable timeline event. */
export interface SaveEventInput {
  pointId: number | null;
  timeMs: number;
  type: GameEventType;
  payload: GameEventPayload;
  annotations?: SaveEventSpatialAnnotationInput[];
}

/** Manual panorama-space player position accepted while recording an event. */
export type SaveEventSpatialAnnotationInput = Omit<EventSpatialAnnotation, 'id'>;

/** Point fields accepted when replacing a game's paper score-sheet summary. */
export type SaveManualPointInput = Omit<
  ManualPointSummary,
  'id' | 'sequenceNumber' | 'offenseStrategyId' | 'defenseStrategyId'
> & {
  offenseStrategyId?: number | null;
  defenseStrategyId?: number | null;
};

/** Complete replace-all payload for paper player totals and point summaries. */
export interface SaveManualSummaryInput {
  playerStatistics: ManualPlayerGameStatistics[];
  points: SaveManualPointInput[];
}

/** Input accepted when adding or replacing a highlight range. */
export interface SaveHighlightInput {
  startTimeMs: number;
  endTimeMs: number;
  description: string;
  playerIds: number[];
}

interface GameTrackingRow {
  id: number;
  token: string;
  title: string;
  team_name: string;
  team_slug: string;
  tournament_id: number;
  tournament_name: string;
  season_roster_id: number;
  opponent_name: string;
  played_at: string | null;
  has_video: number;
  player_count: number;
  initial_our_score: number;
  initial_opponent_score: number;
  initial_lineup_endzone: TeamEndzone;
}

interface EventRow {
  id: number;
  point_id: number | null;
  time_ms: number;
  type: string;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

interface EventAnnotationRow {
  id: number;
  role: SpatialAnnotationRole;
  player_id: number | null;
  time_ms: number;
  frame_index: number;
  panorama_yaw: number;
  panorama_pitch: number;
}

interface TrackingPlayerRow {
  id: number;
  name: string;
  default_matchup_role: MatchupRole | null;
  game_matchup_role_override: MatchupRole | null;
}

interface ManualPlayerStatisticsRow {
  player_id: number;
  points_played: number;
  hockey_assists: number;
  assists: number;
  goals: number;
  blocks: number;
}

interface ManualPointRow {
  id: number;
  sequence_number: number;
  line_id: number;
  starting_possession: StartingPossession;
  initial_defense_type: string | null;
  offense_strategy_id: number | null;
  defense_strategy_id: number | null;
  our_turnovers: number;
  scoring_method: string | null;
  scorer_player_id: number | null;
  our_score: number;
  opponent_score: number;
}

interface HighlightRow {
  id: number;
  start_time_ms: number;
  end_time_ms: number;
  description: string;
  created_at: string;
  updated_at: string;
}

/** SQLite event store for point recording and statistics calculation. */
export class GameTrackingRepository {
  constructor(private readonly database: Database.Database = getDatabase()) {}

  /** Load one complete game recorder snapshot by its public token. */
  getSnapshot(token: string): GameTrackingSnapshot | null {
    const data = this.getGameData(token);
    return data ? snapshot(data) : null;
  }

  /** Load every game in a tournament for aggregate statistics. */
  listTournamentGameData(tournamentId: number): TrackingGameData[] {
    const tokens = this.database
      .prepare('SELECT token FROM games WHERE tournament_id = ? ORDER BY played_at, id')
      .all(tournamentId) as Array<{ token: string }>;
    return tokens
      .map((row) => this.getGameData(row.token))
      .filter((data): data is TrackingGameData => data !== null);
  }

  /** Load every game belonging to a season roster. */
  listSeasonGameData(seasonRosterId: number): TrackingGameData[] {
    const tokens = this.database
      .prepare(
        `SELECT games.token
           FROM games
           JOIN tournaments ON tournaments.id = games.tournament_id
          WHERE tournaments.season_roster_id = ?
          ORDER BY games.played_at, games.id`,
      )
      .all(seasonRosterId) as Array<{ token: string }>;
    return tokens
      .map((row) => this.getGameData(row.token))
      .filter((data): data is TrackingGameData => data !== null);
  }

  /** Begin a point and save its initial active players atomically. */
  startPoint(token: string, input: StartPointInput): GameTrackingSnapshot {
    const game = this.requireGame(token);
    const line = this.database
      .prepare('SELECT tournament_id FROM tournament_lines WHERE id = ?')
      .get(input.lineId) as { tournament_id: number } | undefined;
    if (!line || line.tournament_id !== game.tournament_id) {
      throw new Error('Select a line from this event.');
    }
    const startTimeMs = timecode(input.startTimeMs);
    const playerIds = uniqueIds(input.playerIds, 'Point player');
    if (playerIds.length === 0) throw new Error('Select at least one player for the point.');
    this.requireTournamentPlayers(game.id, playerIds);
    const matchupRoleOverrides = validatedRoleOverrides(input.matchupRoleOverrides, playerIds);
    if (input.pullerPlayerId !== null) {
      if (!playerIds.includes(input.pullerPlayerId)) {
        throw new Error('The puller must be active on the point.');
      }
      if (input.startingPossession !== 'defense') {
        throw new Error('The tracked team can only select a puller when starting on defense.');
      }
    }
    if (input.startingPossession !== 'offense' && input.startingPossession !== 'defense') {
      throw new Error('Select whether the point starts on offense or defense.');
    }
    const strategies = this.resolvePointStrategies(game, input);

    const current = this.openPoint(game.id);
    if (current) throw new Error(`Point ${current.sequence_number} is still open.`);
    const previous = this.database
      .prepare('SELECT id, sequence_number, start_time_ms FROM game_points WHERE game_id = ? ORDER BY sequence_number DESC LIMIT 1')
      .get(game.id) as { id: number; sequence_number: number; start_time_ms: number } | undefined;
    if (previous && startTimeMs < previous.start_time_ms) {
      throw new Error('A new point cannot begin before the previous point.');
    }

    this.database.transaction(() => {
      const sequenceNumber = (previous?.sequence_number ?? 0) + 1;
      const result = this.database
        .prepare(
          `INSERT INTO game_points (
             game_id, sequence_number, line_id, starting_possession,
             start_time_ms, puller_player_id, initial_offense_strategy_id,
             initial_defense_strategy_id, lineup_endzone_override
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          game.id,
          sequenceNumber,
          input.lineId,
          input.startingPossession,
          startTimeMs,
          input.pullerPlayerId,
          strategies.offenseStrategyId,
          strategies.defenseStrategyId,
          optionalEndzone(input.lineupEndzoneOverride),
        );
      const pointId = Number(result.lastInsertRowid);
      const insertPlayer = this.database.prepare(
        'INSERT INTO game_point_players (point_id, player_id, sort_order) VALUES (?, ?, ?)',
      );
      playerIds.forEach((playerId, index) => insertPlayer.run(pointId, playerId, index));
      this.replacePointMatchupOverrides(pointId, matchupRoleOverrides);
    })();
    return this.requiredSnapshot(token);
  }

  /** Replace point setup fields and its pull-time starting players. */
  updatePoint(token: string, pointId: number, input: StartPointInput): GameTrackingSnapshot {
    const game = this.requireGame(token);
    const point = this.requirePoint(game.id, pointId);
    const line = this.database
      .prepare('SELECT tournament_id FROM tournament_lines WHERE id = ?')
      .get(input.lineId) as { tournament_id: number } | undefined;
    if (!line || line.tournament_id !== game.tournament_id) throw new Error('Select a line from this event.');
    const playerIds = uniqueIds(input.playerIds, 'Point player');
    if (playerIds.length === 0) throw new Error('Select at least one player for the point.');
    this.requireTournamentPlayers(game.id, playerIds);
    const matchupRoleOverrides = validatedRoleOverrides(input.matchupRoleOverrides, playerIds);
    if (input.pullerPlayerId !== null && !playerIds.includes(input.pullerPlayerId)) {
      throw new Error('The puller must be active on the point.');
    }
    if (input.pullerPlayerId !== null && input.startingPossession !== 'defense') {
      throw new Error('The tracked team can only select a puller when starting on defense.');
    }
    const startTimeMs = timecode(input.startTimeMs);
    const strategies = this.resolvePointStrategies(game, input, point);
    const earliestEvent = this.database
      .prepare('SELECT MIN(time_ms) AS time_ms FROM game_events WHERE point_id = ?')
      .get(point.id) as { time_ms: number | null };
    if (earliestEvent.time_ms !== null && earliestEvent.time_ms < startTimeMs) {
      throw new Error('The pull cannot be moved after an existing point event.');
    }

    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE game_points
              SET line_id = ?, starting_possession = ?, start_time_ms = ?, puller_player_id = ?,
                  initial_offense_strategy_id = ?, initial_defense_strategy_id = ?,
                  lineup_endzone_override = ?,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?`,
        )
        .run(
          input.lineId,
          input.startingPossession,
          startTimeMs,
          input.pullerPlayerId,
          strategies.offenseStrategyId,
          strategies.defenseStrategyId,
          optionalEndzone(input.lineupEndzoneOverride),
          point.id,
        );
      this.database.prepare('DELETE FROM game_point_players WHERE point_id = ?').run(point.id);
      const insertPlayer = this.database.prepare(
        'INSERT INTO game_point_players (point_id, player_id, sort_order) VALUES (?, ?, ?)',
      );
      playerIds.forEach((playerId, index) => insertPlayer.run(point.id, playerId, index));
      this.replacePointMatchupOverrides(point.id, matchupRoleOverrides);
    })();
    return this.requiredSnapshot(token);
  }

  /** Set the tracked team's goal line before the first recorded pull. */
  setInitialLineupEndzone(token: string, endzone: TeamEndzone): GameTrackingSnapshot {
    const game = this.requireGame(token);
    this.database
      .prepare(
        `UPDATE games
            SET initial_lineup_endzone = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?`,
      )
      .run(requiredEndzone(endzone), game.id);
    return this.requiredSnapshot(token);
  }

  /** Delete one point and all of its events. */
  deletePoint(token: string, pointId: number): GameTrackingSnapshot {
    const game = this.requireGame(token);
    this.requirePoint(game.id, pointId);
    this.database.prepare('DELETE FROM game_points WHERE id = ?').run(pointId);
    return this.requiredSnapshot(token);
  }

  /** Add a validated timeline event. */
  addEvent(token: string, input: SaveEventInput): GameTrackingSnapshot {
    const game = this.requireGame(token);
    const parsed = this.validateEventInput(game, input, null);
    this.database.transaction(() => {
      const result = this.database
        .prepare(
          `INSERT INTO game_events (game_id, point_id, time_ms, type, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(game.id, parsed.pointId, parsed.timeMs, parsed.type, JSON.stringify(parsed.payload));
      this.replaceEventAnnotations(Number(result.lastInsertRowid), parsed.annotations ?? []);
    })();
    return this.requiredSnapshot(token);
  }

  /** Replace the time, type, point, and details of an existing event. */
  updateEvent(token: string, eventId: number, input: SaveEventInput): GameTrackingSnapshot {
    const game = this.requireGame(token);
    const existing = this.database
      .prepare('SELECT id FROM game_events WHERE id = ? AND game_id = ?')
      .get(eventId, game.id) as { id: number } | undefined;
    if (!existing) throw new Error('Event not found.');
    const parsed = this.validateEventInput(game, input, eventId);
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE game_events
              SET point_id = ?, time_ms = ?, type = ?, payload_json = ?,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?`,
        )
        .run(parsed.pointId, parsed.timeMs, parsed.type, JSON.stringify(parsed.payload), eventId);
      if (parsed.annotations !== undefined) {
        this.replaceEventAnnotations(eventId, parsed.annotations);
      }
    })();
    return this.requiredSnapshot(token);
  }

  /** Delete one timeline event. */
  deleteEvent(token: string, eventId: number): GameTrackingSnapshot {
    const game = this.requireGame(token);
    const result = this.database
      .prepare('DELETE FROM game_events WHERE id = ? AND game_id = ?')
      .run(eventId, game.id);
    if (result.changes !== 1) throw new Error('Event not found.');
    return this.requiredSnapshot(token);
  }

  /** Add a noteworthy video range and optional player attribution. */
  addHighlight(token: string, input: SaveHighlightInput): GameTrackingSnapshot {
    const game = this.requireGame(token);
    const parsed = this.validateHighlightInput(game, input);
    this.database.transaction(() => {
      const result = this.database
        .prepare(
          `INSERT INTO game_highlights (game_id, start_time_ms, end_time_ms, description)
           VALUES (?, ?, ?, ?)`,
        )
        .run(game.id, parsed.startTimeMs, parsed.endTimeMs, parsed.description);
      this.replaceHighlightPlayers(Number(result.lastInsertRowid), parsed.playerIds);
    })();
    return this.requiredSnapshot(token);
  }

  /** Replace one highlight's range, description, and player attribution. */
  updateHighlight(
    token: string,
    highlightId: number,
    input: SaveHighlightInput,
  ): GameTrackingSnapshot {
    const game = this.requireGame(token);
    const existing = this.database
      .prepare('SELECT id FROM game_highlights WHERE id = ? AND game_id = ?')
      .get(highlightId, game.id);
    if (!existing) throw new Error('Highlight not found.');
    const parsed = this.validateHighlightInput(game, input);
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE game_highlights
              SET start_time_ms = ?, end_time_ms = ?, description = ?,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?`,
        )
        .run(parsed.startTimeMs, parsed.endTimeMs, parsed.description, highlightId);
      this.replaceHighlightPlayers(highlightId, parsed.playerIds);
    })();
    return this.requiredSnapshot(token);
  }

  /** Delete one highlight without changing the statistics timeline. */
  deleteHighlight(token: string, highlightId: number): GameTrackingSnapshot {
    const game = this.requireGame(token);
    const result = this.database
      .prepare('DELETE FROM game_highlights WHERE id = ? AND game_id = ?')
      .run(highlightId, game.id);
    if (result.changes !== 1) throw new Error('Highlight not found.');
    return this.requiredSnapshot(token);
  }

  /** Set or clear one player's rare game-level matchup role override. */
  setGameMatchupRole(
    token: string,
    playerId: number,
    matchupRole: MatchupRole | null,
  ): GameTrackingSnapshot {
    const game = this.requireGame(token);
    this.requireTournamentPlayers(game.id, [playerId]);
    const role = parseOptionalMatchupRole(matchupRole);
    if (role === null) {
      this.database
        .prepare('DELETE FROM game_player_matchup_overrides WHERE game_id = ? AND player_id = ?')
        .run(game.id, playerId);
    } else {
      this.database
        .prepare(
          `INSERT INTO game_player_matchup_overrides (game_id, player_id, matchup_role)
           VALUES (?, ?, ?)
           ON CONFLICT (game_id, player_id) DO UPDATE SET matchup_role = excluded.matchup_role`,
        )
        .run(game.id, playerId, role);
    }
    return this.requiredSnapshot(token);
  }

  /** Replace aggregate player totals and paper point summaries atomically. */
  saveManualSummary(token: string, input: SaveManualSummaryInput): GameTrackingSnapshot {
    const game = this.requireGame(token);
    const playerIds = uniqueIds(input.playerStatistics.map((stats) => stats.playerId), 'Paper player');
    if (playerIds.length !== input.playerStatistics.length) {
      throw new Error('Each paper player may appear only once.');
    }
    this.requireTournamentPlayers(game.id, playerIds);
    const playerStatistics = input.playerStatistics.map((stats) => ({
      playerId: stats.playerId,
      pointsPlayed: statisticCount(stats.pointsPlayed, 'Points played'),
      hockeyAssists: statisticCount(stats.hockeyAssists, 'Hockey assists'),
      assists: statisticCount(stats.assists, 'Assists'),
      goals: statisticCount(stats.goals, 'Goals'),
      blocks: statisticCount(stats.blocks, 'Defenses'),
    }));

    const lineIds = uniqueIds(input.points.map((point) => point.lineId), 'Paper point line');
    if (lineIds.length > 0) {
      const availableLines = (
        this.database
          .prepare(
            `SELECT id FROM tournament_lines
              WHERE tournament_id = ? AND id IN (SELECT value FROM json_each(?))`,
          )
          .all(game.tournament_id, JSON.stringify(lineIds)) as Array<{ id: number }>
      ).length;
      if (availableLines !== lineIds.length) throw new Error('Every paper point line must belong to this event.');
    }
    const scorerIds = uniqueIds(
      input.points
        .map((point) => point.scorerPlayerId)
        .filter((playerId): playerId is number => playerId !== null),
      'Paper point scorer',
    );
    this.requireTournamentPlayers(game.id, scorerIds);
    const scorerSet = new Set(scorerIds);
    const storedPlayerStatistics = playerStatistics.filter(
      (stats) =>
        scorerSet.has(stats.playerId) ||
        stats.pointsPlayed > 0 ||
        stats.hockeyAssists > 0 ||
        stats.assists > 0 ||
        stats.goals > 0 ||
        stats.blocks > 0,
    );

    let previousOurScore = game.initial_our_score;
    let previousOpponentScore = game.initial_opponent_score;
    const points = input.points.map((point, index) => {
      if (point.startingPossession !== 'offense' && point.startingPossession !== 'defense') {
        throw new Error(`Paper point ${index + 1} must start on offense or defense.`);
      }
      const ourScore = statisticCount(point.ourScore, `Paper point ${index + 1} team score`, 999);
      const opponentScore = statisticCount(
        point.opponentScore,
        `Paper point ${index + 1} opponent score`,
        999,
      );
      const ourIncrease = ourScore - previousOurScore;
      const opponentIncrease = opponentScore - previousOpponentScore;
      if (!((ourIncrease === 1 && opponentIncrease === 0) || (ourIncrease === 0 && opponentIncrease === 1))) {
        throw new Error(`Paper point ${index + 1} score must add exactly one goal to the previous score.`);
      }
      if (opponentIncrease === 1 && (point.scorerPlayerId !== null || optionalPaperText(point.scoringMethod, 'Scoring method') !== null)) {
        throw new Error(`Paper point ${index + 1} can only name our scorer and scoring method when our team scored.`);
      }
      previousOurScore = ourScore;
      previousOpponentScore = opponentScore;
      const offenseStrategyId = this.resolvePaperStrategy(
        game,
        'offense',
        point.offenseStrategyId,
      );
      const defenseStrategyId = this.resolvePaperStrategy(
        game,
        'defense',
        point.defenseStrategyId,
      );
      return {
        sequenceNumber: index + 1,
        lineId: point.lineId,
        startingPossession: point.startingPossession,
        initialDefenseType: point.startingPossession === 'defense'
          ? optionalPaperText(point.initialDefenseType, 'Initial defense type') ??
            (defenseStrategyId === null ? null : this.strategyName(defenseStrategyId))
          : null,
        offenseStrategyId,
        defenseStrategyId,
        ourTurnovers: statisticCount(point.ourTurnovers, `Paper point ${index + 1} turnovers`, 99),
        scoringMethod: ourIncrease === 1
          ? optionalPaperText(point.scoringMethod, 'Scoring method')
          : null,
        scorerPlayerId: ourIncrease === 1 ? point.scorerPlayerId : null,
        ourScore,
        opponentScore,
      };
    });

    this.database.transaction(() => {
      this.database.prepare('DELETE FROM manual_player_game_statistics WHERE game_id = ?').run(game.id);
      this.database.prepare('DELETE FROM manual_game_points WHERE game_id = ?').run(game.id);
      const insertPlayer = this.database.prepare(
        `INSERT INTO manual_player_game_statistics (
           game_id, player_id, points_played, hockey_assists, assists, goals, blocks
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const stats of storedPlayerStatistics) {
        insertPlayer.run(
          game.id,
          stats.playerId,
          stats.pointsPlayed,
          stats.hockeyAssists,
          stats.assists,
          stats.goals,
          stats.blocks,
        );
      }
      const insertPoint = this.database.prepare(
        `INSERT INTO manual_game_points (
           game_id, sequence_number, line_id, starting_possession, initial_defense_type,
           offense_strategy_id, defense_strategy_id, our_turnovers, scoring_method,
           scorer_player_id, our_score, opponent_score
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const point of points) {
        insertPoint.run(
          game.id,
          point.sequenceNumber,
          point.lineId,
          point.startingPossession,
          point.initialDefenseType,
          point.offenseStrategyId,
          point.defenseStrategyId,
          point.ourTurnovers,
          point.scoringMethod,
          point.scorerPlayerId,
          point.ourScore,
          point.opponentScore,
        );
      }
    })();
    return this.requiredSnapshot(token);
  }

  private getGameData(token: string): TrackingGameData | null {
    const row = this.database.prepare(gameQuery('WHERE games.token = ?')).get(token) as
      | GameTrackingRow
      | undefined;
    if (!row) return null;
    const strategies = (
      this.database
        .prepare(
          `SELECT id, name, kind, is_default
             FROM season_strategies
            WHERE season_roster_id = ?
            ORDER BY kind, is_default DESC, name COLLATE NOCASE, id`,
        )
        .all(row.season_roster_id) as Array<{
          id: number;
          name: string;
          kind: StrategyKind;
          is_default: number;
        }>
    ).map((strategy): TrackingStrategy => ({
      id: strategy.id,
      name: strategy.name,
      kind: strategy.kind,
      isDefault: strategy.is_default === 1,
    }));
    const playerRows = this.database
      .prepare(
        `SELECT players.id, players.name,
                players.matchup_role AS default_matchup_role,
                game_player_matchup_overrides.matchup_role AS game_matchup_role_override
           FROM games
           JOIN tournament_players
             ON tournament_players.tournament_id = games.tournament_id
           JOIN players ON players.id = tournament_players.player_id
           LEFT JOIN game_player_matchup_overrides
             ON game_player_matchup_overrides.game_id = games.id
            AND game_player_matchup_overrides.player_id = players.id
          WHERE games.id = ?
          ORDER BY tournament_players.sort_order, players.name COLLATE NOCASE`,
      )
      .all(row.id) as TrackingPlayerRow[];
    const players: TrackingPlayer[] = playerRows.map((player) => ({
      id: player.id,
      name: player.name,
      defaultMatchupRole: player.default_matchup_role,
      gameMatchupRoleOverride: player.game_matchup_role_override,
      matchupRole: player.game_matchup_role_override ?? player.default_matchup_role,
    }));
    const lineRows = this.database
      .prepare('SELECT id, name FROM tournament_lines WHERE tournament_id = ? ORDER BY sort_order, id')
      .all(row.tournament_id) as Array<{ id: number; name: string }>;
    const available = new Set(players.map((player) => player.id));
    const linePlayerStatement = this.database.prepare(
      'SELECT player_id FROM tournament_line_players WHERE line_id = ? ORDER BY sort_order, player_id',
    );
    const lines: TrackingLine[] = lineRows.map((line) => ({
      ...line,
      suggestedPlayerIds: (
        linePlayerStatement.all(line.id) as Array<{ player_id: number }>
      ).map((item) => item.player_id).filter((playerId) => available.has(playerId)),
    }));
    const pointRows = this.database
      .prepare(
        `SELECT id, sequence_number, line_id, starting_possession, start_time_ms, puller_player_id,
                initial_offense_strategy_id, initial_defense_strategy_id,
                lineup_endzone_override
           FROM game_points WHERE game_id = ? ORDER BY sequence_number, id`,
      )
      .all(row.id) as Array<{
        id: number;
        sequence_number: number;
        line_id: number;
        starting_possession: StartingPossession;
        start_time_ms: number;
        puller_player_id: number | null;
        initial_offense_strategy_id: number | null;
        initial_defense_strategy_id: number | null;
        lineup_endzone_override: TeamEndzone | null;
      }>;
    const pointPlayers = this.database.prepare(
      'SELECT player_id FROM game_point_players WHERE point_id = ? ORDER BY sort_order, player_id',
    );
    const pointEvents = this.database.prepare(
      'SELECT * FROM game_events WHERE point_id = ? ORDER BY time_ms, id',
    );
    const eventAnnotations = this.database.prepare(
      `SELECT id, role, player_id, time_ms, frame_index, panorama_yaw, panorama_pitch
         FROM game_event_annotations
        WHERE event_id = ? ORDER BY sort_order, id`,
    );
    const pointRoleOverrides = this.database.prepare(
      `SELECT player_id, matchup_role
         FROM game_point_player_matchup_overrides
        WHERE point_id = ?`,
    );
    const points: TrackingPoint[] = pointRows.map((point) => ({
      id: point.id,
      sequenceNumber: point.sequence_number,
      lineId: point.line_id,
      startingPossession: point.starting_possession,
      startTimeMs: point.start_time_ms,
      pullerPlayerId: point.puller_player_id,
      lineupEndzoneOverride: point.lineup_endzone_override,
      initialOffenseStrategyId: point.initial_offense_strategy_id,
      initialDefenseStrategyId: point.initial_defense_strategy_id,
      startingPlayerIds: (
        pointPlayers.all(point.id) as Array<{ player_id: number }>
      ).map((item) => item.player_id),
      matchupRoleOverrides: Object.fromEntries(
        (pointRoleOverrides.all(point.id) as Array<{
          player_id: number;
          matchup_role: MatchupRole;
        }>).map((override) => [override.player_id, override.matchup_role]),
      ),
      events: (pointEvents.all(point.id) as EventRow[]).map((event) =>
        mapEvent(event, eventAnnotations.all(event.id) as EventAnnotationRow[])),
    }));
    const standaloneEvents = (
      this.database
        .prepare('SELECT * FROM game_events WHERE game_id = ? AND point_id IS NULL ORDER BY time_ms, id')
        .all(row.id) as EventRow[]
    ).map((event) => mapEvent(event, eventAnnotations.all(event.id) as EventAnnotationRow[]));
    const highlightPlayers = this.database.prepare(
      `SELECT player_id FROM game_highlight_players
        WHERE highlight_id = ? ORDER BY sort_order, player_id`,
    );
    const highlights = (
      this.database
        .prepare(
          `SELECT id, start_time_ms, end_time_ms, description, created_at, updated_at
             FROM game_highlights
            WHERE game_id = ? ORDER BY start_time_ms, id`,
        )
        .all(row.id) as HighlightRow[]
    ).map((highlight): GameHighlight => ({
      id: highlight.id,
      startTimeMs: highlight.start_time_ms,
      endTimeMs: highlight.end_time_ms,
      description: highlight.description,
      playerIds: (highlightPlayers.all(highlight.id) as Array<{ player_id: number }>).map(
        (player) => player.player_id,
      ),
      createdAt: highlight.created_at,
      updatedAt: highlight.updated_at,
    }));
    const manualPlayerStatistics = (
      this.database
        .prepare(
          `SELECT player_id, points_played, hockey_assists, assists, goals, blocks
             FROM manual_player_game_statistics
            WHERE game_id = ? ORDER BY player_id`,
        )
        .all(row.id) as ManualPlayerStatisticsRow[]
    ).map((stats): ManualPlayerGameStatistics => ({
      playerId: stats.player_id,
      pointsPlayed: stats.points_played,
      hockeyAssists: stats.hockey_assists,
      assists: stats.assists,
      goals: stats.goals,
      blocks: stats.blocks,
    }));
    const manualPoints = (
      this.database
        .prepare(
          `SELECT id, sequence_number, line_id, starting_possession, initial_defense_type,
                  offense_strategy_id, defense_strategy_id,
                  our_turnovers, scoring_method, scorer_player_id, our_score, opponent_score
             FROM manual_game_points
            WHERE game_id = ? ORDER BY sequence_number, id`,
        )
        .all(row.id) as ManualPointRow[]
    ).map((point): ManualPointSummary => ({
      id: point.id,
      sequenceNumber: point.sequence_number,
      lineId: point.line_id,
      startingPossession: point.starting_possession,
      initialDefenseType: point.initial_defense_type,
      offenseStrategyId: point.offense_strategy_id,
      defenseStrategyId: point.defense_strategy_id,
      ourTurnovers: point.our_turnovers,
      scoringMethod: point.scoring_method,
      scorerPlayerId: point.scorer_player_id,
      ourScore: point.our_score,
      opponentScore: point.opponent_score,
    }));
    return {
      game: {
        id: row.id,
        token: row.token,
        title: row.title,
        teamName: row.team_name,
        teamSlug: row.team_slug,
        tournamentId: row.tournament_id,
        tournamentName: row.tournament_name,
        opponentName: row.opponent_name,
        playedAt: row.played_at,
        hasVideo: row.has_video === 1,
        expectedPlayerCount: row.player_count,
        initialOurScore: row.initial_our_score,
        initialOpponentScore: row.initial_opponent_score,
        initialLineupEndzone: row.initial_lineup_endzone,
      },
      players,
      lines,
      strategies,
      points,
      standaloneEvents,
      highlights,
      manualPlayerStatistics,
      manualPoints,
    };
  }

  private validateEventInput(
    game: GameTrackingRow,
    input: SaveEventInput,
    excludedEventId: number | null,
  ): SaveEventInput {
    const type = parseGameEventType(input.type);
    const payload = parseGameEventPayload(type, input.payload);
    if (game.has_video === 1) requireVideoPlayerAttribution(type, payload);
    const timeMs = timecode(input.timeMs);
    if (type === 'score_set') {
      if (input.pointId !== null) throw new Error('Score synchronization belongs to the game timeline.');
      return { pointId: null, timeMs, type, payload, annotations: this.validateEventAnnotations(game, input.annotations) };
    }
    if (!Number.isSafeInteger(input.pointId) || input.pointId === null) {
      throw new Error('Select a point for this event.');
    }
    const pointRow = this.requirePoint(game.id, input.pointId);
    if (timeMs < pointRow.start_time_ms) throw new Error('An event cannot occur before the pull.');
    this.requireTournamentPlayers(game.id, payloadPlayerIds(type, payload));
    if (type === 'strategy_set') {
      const strategy = payload as StrategySetPayload;
      this.requireStrategy(game, strategy.strategyId, strategy.kind);
    }

    const point = this.getGameData(game.token)?.points.find((candidate) => candidate.id === input.pointId);
    if (!point) throw new Error('Point not found.');
    const priorPoint: TrackingPoint = {
      ...point,
      events: point.events.filter(
        (event) => event.id !== excludedEventId &&
          (event.timeMs < timeMs || (event.timeMs === timeMs && event.id < (excludedEventId ?? Number.MAX_SAFE_INTEGER))),
      ),
    };
    const state = calculatePointState(priorPoint);
    if (state.ended) throw new Error('The point has already ended at this timecode.');
    if (
      state.openStoppageEventId !== null &&
      type !== 'stoppage' &&
      type !== 'substitution' &&
      type !== 'strategy_set'
    ) {
      throw new Error('Resume play before recording another disc event.');
    }
    if (
      (type === 'possession_start' || type === 'completion' || type === 'turnover') &&
      state.possession !== 'offense'
    ) {
      throw new Error('This event requires tracked-team possession.');
    }
    if (
      (type === 'defended' || type === 'opponent_turnover' || type === 'conceded') &&
      state.possession !== 'defense'
    ) {
      throw new Error('This event requires opponent possession.');
    }
    if (type === 'goal') {
      const isCallahan = (payload as { callahan: boolean }).callahan;
      if ((isCallahan && state.possession !== 'defense') || (!isCallahan && state.possession !== 'offense')) {
        throw new Error(isCallahan ? 'A Callahan requires opponent possession.' : 'A goal requires tracked-team possession.');
      }
    }
    if (
      type === 'stoppage' &&
      (payload as { endTimeMs: number | null }).endTimeMs === null &&
      state.openStoppageEventId !== null
    ) {
      throw new Error('Resume play before starting another stoppage.');
    }
    const active = new Set(state.activePlayerIds);
    const requiredActiveIds = activePayloadPlayerIds(type, payload);
    if (requiredActiveIds.some((playerId) => !active.has(playerId))) {
      throw new Error('Every selected event player must be active at that timecode.');
    }
    if (type === 'substitution') {
      const substitution = payload as Extract<GameEventPayload, { outgoingPlayerId: number | null }>;
      if (substitution.outgoingPlayerId !== null && !active.has(substitution.outgoingPlayerId)) {
        throw new Error('The outgoing player must be active.');
      }
      if (substitution.incomingPlayerId !== null && active.has(substitution.incomingPlayerId)) {
        throw new Error('The incoming player is already active.');
      }
    }
    if (type === 'stoppage') {
      const stoppage = payload as Extract<GameEventPayload, { endTimeMs: number | null }>;
      if (stoppage.endTimeMs !== null && stoppage.endTimeMs < timeMs) {
        throw new Error('A stoppage cannot end before it starts.');
      }
    }
    return {
      pointId: input.pointId,
      timeMs,
      type,
      payload,
      annotations: this.validateEventAnnotations(game, input.annotations, pointRow.start_time_ms),
    };
  }

  private validateEventAnnotations(
    game: GameTrackingRow,
    annotations: SaveEventSpatialAnnotationInput[] | undefined,
    pointStartTimeMs = 0,
  ): SaveEventSpatialAnnotationInput[] | undefined {
    if (annotations === undefined) return undefined;
    if (game.has_video !== 1) throw new Error('Spatial annotations require a game with video.');
    if (annotations.length > 12) throw new Error('An event may contain at most 12 spatial annotations.');
    const parsed = annotations.map((annotation) => ({
      role: spatialAnnotationRole(annotation.role),
      playerId: annotation.playerId,
      timeMs: timecode(annotation.timeMs),
      frameIndex: nonNegativeInteger(annotation.frameIndex, 'Annotation frame'),
      panoramaYaw: finiteRange(annotation.panoramaYaw, -Math.PI, Math.PI, 'Annotation yaw'),
      panoramaPitch: finiteRange(
        annotation.panoramaPitch,
        -Math.PI / 2,
        Math.PI / 2,
        'Annotation pitch',
      ),
    }));
    if (parsed.some((annotation) => annotation.timeMs < pointStartTimeMs)) {
      throw new Error('An event annotation cannot occur before the pull.');
    }
    this.requireTournamentPlayers(
      game.id,
      uniqueIds(
        parsed.flatMap((annotation) => annotation.playerId === null ? [] : [annotation.playerId]),
        'Annotation player',
      ),
    );
    return parsed;
  }

  private replaceEventAnnotations(
    eventId: number,
    annotations: SaveEventSpatialAnnotationInput[],
  ): void {
    this.database.prepare('DELETE FROM game_event_annotations WHERE event_id = ?').run(eventId);
    const insert = this.database.prepare(
      `INSERT INTO game_event_annotations (
         event_id, role, player_id, time_ms, frame_index,
         panorama_yaw, panorama_pitch, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    annotations.forEach((annotation, index) => insert.run(
      eventId,
      annotation.role,
      annotation.playerId,
      annotation.timeMs,
      annotation.frameIndex,
      annotation.panoramaYaw,
      annotation.panoramaPitch,
      index,
    ));
  }

  private validateHighlightInput(
    game: GameTrackingRow,
    input: SaveHighlightInput,
  ): SaveHighlightInput {
    if (game.has_video !== 1) throw new Error('Highlights require a game with video.');
    const startTimeMs = timecode(input.startTimeMs);
    const endTimeMs = timecode(input.endTimeMs);
    if (endTimeMs <= startTimeMs) throw new Error('A highlight must end after it starts.');
    const description = requiredText(input.description, 500, 'Highlight description');
    const playerIds = uniqueIds(input.playerIds, 'Highlight player');
    this.requireTournamentPlayers(game.id, playerIds);
    return { startTimeMs, endTimeMs, description, playerIds };
  }

  private replaceHighlightPlayers(highlightId: number, playerIds: number[]): void {
    this.database
      .prepare('DELETE FROM game_highlight_players WHERE highlight_id = ?')
      .run(highlightId);
    const insert = this.database.prepare(
      `INSERT INTO game_highlight_players (highlight_id, player_id, sort_order)
       VALUES (?, ?, ?)`,
    );
    playerIds.forEach((playerId, index) => insert.run(highlightId, playerId, index));
  }

  private resolvePointStrategies(
    game: GameTrackingRow,
    input: Pick<StartPointInput, 'initialOffenseStrategyId' | 'initialDefenseStrategyId'>,
    current?: {
      initial_offense_strategy_id: number | null;
      initial_defense_strategy_id: number | null;
    },
  ): { offenseStrategyId: number | null; defenseStrategyId: number | null } {
    return {
      offenseStrategyId: this.resolveOptionalStrategy(
        game,
        'offense',
        input.initialOffenseStrategyId === undefined
          ? current?.initial_offense_strategy_id
          : input.initialOffenseStrategyId,
      ),
      defenseStrategyId: this.resolveOptionalStrategy(
        game,
        'defense',
        input.initialDefenseStrategyId === undefined
          ? current?.initial_defense_strategy_id
          : input.initialDefenseStrategyId,
      ),
    };
  }

  private resolvePaperStrategy(
    game: GameTrackingRow,
    kind: StrategyKind,
    strategyId: number | null | undefined,
  ): number | null {
    if (strategyId !== null && strategyId !== undefined) {
      return this.requireStrategy(game, strategyId, kind).id;
    }
    return null;
  }

  private resolveOptionalStrategy(
    game: GameTrackingRow,
    kind: StrategyKind,
    strategyId: number | null | undefined,
  ): number | null {
    if (strategyId !== null && strategyId !== undefined) {
      return this.requireStrategy(game, strategyId, kind).id;
    }
    return null;
  }

  private requireStrategy(
    game: GameTrackingRow,
    strategyId: number,
    kind: StrategyKind,
  ): { id: number; name: string } {
    if (!Number.isSafeInteger(strategyId) || strategyId <= 0) {
      throw new Error(`Select a valid ${kind}.`);
    }
    const strategy = this.database
      .prepare(
        `SELECT id, name FROM season_strategies
          WHERE id = ? AND season_roster_id = ? AND kind = ?`,
      )
      .get(strategyId, game.season_roster_id, kind) as { id: number; name: string } | undefined;
    if (!strategy) throw new Error(`Select an ${kind} from this season roster.`);
    return strategy;
  }

  private strategyName(strategyId: number): string {
    const strategy = this.database
      .prepare('SELECT name FROM season_strategies WHERE id = ?')
      .get(strategyId) as { name: string } | undefined;
    if (!strategy) throw new Error('Selected strategy does not exist.');
    return strategy.name;
  }

  private requireGame(token: string): GameTrackingRow {
    const row = this.database.prepare(gameQuery('WHERE games.token = ?')).get(token) as
      | GameTrackingRow
      | undefined;
    if (!row) throw new Error('Game not found.');
    return row;
  }

  private requirePoint(gameId: number, pointId: number): {
    id: number;
    sequence_number: number;
    start_time_ms: number;
    initial_offense_strategy_id: number | null;
    initial_defense_strategy_id: number | null;
  } {
    const row = this.database
      .prepare(
        `SELECT id, sequence_number, start_time_ms, initial_offense_strategy_id,
                initial_defense_strategy_id
           FROM game_points WHERE id = ? AND game_id = ?`,
      )
      .get(pointId, gameId) as {
        id: number;
        sequence_number: number;
        start_time_ms: number;
        initial_offense_strategy_id: number | null;
        initial_defense_strategy_id: number | null;
      } | undefined;
    if (!row) throw new Error('Point not found.');
    return row;
  }

  private requireTournamentPlayers(gameId: number, playerIds: number[]): void {
    if (playerIds.length === 0) return;
    const unique = [...new Set(playerIds)];
    const count = (
      this.database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM games
             JOIN tournament_players
               ON tournament_players.tournament_id = games.tournament_id
            WHERE games.id = ?
              AND tournament_players.player_id IN (SELECT value FROM json_each(?))`,
        )
        .get(gameId, JSON.stringify(unique)) as { count: number }
    ).count;
    if (count !== unique.length) throw new Error('Every selected player must be on the event roster.');
  }

  private replacePointMatchupOverrides(
    pointId: number,
    overrides: Record<number, MatchupRole>,
  ): void {
    this.database
      .prepare('DELETE FROM game_point_player_matchup_overrides WHERE point_id = ?')
      .run(pointId);
    const insert = this.database.prepare(
      `INSERT INTO game_point_player_matchup_overrides (point_id, player_id, matchup_role)
       VALUES (?, ?, ?)`,
    );
    for (const [playerId, matchupRole] of Object.entries(overrides)) {
      insert.run(pointId, Number(playerId), matchupRole);
    }
  }

  private openPoint(gameId: number): { id: number; sequence_number: number } | null {
    return (
      this.database
        .prepare(
          `SELECT game_points.id, game_points.sequence_number
             FROM game_points
            WHERE game_points.game_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM game_events
                 WHERE game_events.point_id = game_points.id
                   AND game_events.type IN ('goal', 'conceded')
              )
            ORDER BY game_points.sequence_number DESC LIMIT 1`,
        )
        .get(gameId) as { id: number; sequence_number: number } | undefined
    ) ?? null;
  }

  private requiredSnapshot(token: string): GameTrackingSnapshot {
    const loaded = this.getSnapshot(token);
    if (!loaded) throw new Error('Game not found.');
    return loaded;
  }
}

function gameQuery(suffix: string): string {
  return `SELECT games.id, games.token, games.title, teams.name AS team_name,
                 teams.slug AS team_slug, tournaments.id AS tournament_id,
                 tournaments.name AS tournament_name, tournaments.season_roster_id,
                 games.opponent_name,
                 games.played_at, games.player_count, games.initial_our_score,
                 games.initial_opponent_score, games.initial_lineup_endzone, games.has_video
            FROM games
            JOIN teams ON teams.id = games.team_id
            JOIN tournaments ON tournaments.id = games.tournament_id
            ${suffix}`;
}

function requiredEndzone(value: unknown): TeamEndzone {
  if (value !== 'left' && value !== 'right') {
    throw new Error('Select the left or right endzone.');
  }
  return value;
}

function optionalEndzone(value: unknown): TeamEndzone | null {
  return value === null || value === undefined ? null : requiredEndzone(value);
}

function snapshot(data: TrackingGameData): GameTrackingSnapshot {
  const currentPoint = [...data.points].reverse().find((point) => !calculatePointState(point).ended) ?? null;
  return {
    data,
    statistics: calculateGameStatistics(data),
    currentPointId: currentPoint?.id ?? null,
    currentPointState: currentPoint ? calculatePointState(currentPoint) : null,
  };
}

function mapEvent(row: EventRow, annotations: EventAnnotationRow[]): TrackingEvent {
  const type = parseGameEventType(row.type);
  return {
    id: row.id,
    pointId: row.point_id,
    timeMs: row.time_ms,
    type,
    payload: parseGameEventPayload(type, JSON.parse(row.payload_json) as unknown),
    annotations: annotations.map((annotation) => ({
      id: annotation.id,
      role: annotation.role,
      playerId: annotation.player_id,
      timeMs: annotation.time_ms,
      frameIndex: annotation.frame_index,
      panoramaYaw: annotation.panorama_yaw,
      panoramaPitch: annotation.panorama_pitch,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function payloadPlayerIds(type: GameEventType, payload: GameEventPayload): number[] {
  switch (type) {
    case 'possession_start':
      return present([(payload as PossessionStartPayload).playerId]);
    case 'completion': {
      const value = payload as { throwerId: number | null; receiverId: number | null };
      return present([value.throwerId, value.receiverId]);
    }
    case 'turnover': {
      const value = payload as { throwerId: number | null; intendedReceiverId: number | null };
      return present([value.throwerId, value.intendedReceiverId]);
    }
    case 'defended': return present([(payload as { defenderId: number | null }).defenderId]);
    case 'goal': {
      const value = payload as { throwerId: number | null; receiverId: number | null };
      return present([value.throwerId, value.receiverId]);
    }
    case 'substitution': {
      const value = payload as { outgoingPlayerId: number | null; incomingPlayerId: number | null };
      return present([value.outgoingPlayerId, value.incomingPlayerId]);
    }
    case 'opponent_turnover':
    case 'conceded':
    case 'stoppage':
    case 'score_set':
    case 'strategy_set':
      return [];
  }
}

function requireVideoPlayerAttribution(type: GameEventType, payload: GameEventPayload): void {
  if (type === 'possession_start') {
    if ((payload as PossessionStartPayload).playerId === null) {
      throw new Error('Select the player starting possession.');
    }
  } else if (type === 'completion') {
    const value = payload as { throwerId: number | null; receiverId: number | null };
    if (value.throwerId === null) throw new Error('Select the completion thrower.');
    if (value.receiverId === null) throw new Error('Select the completion receiver.');
  } else if (type === 'turnover') {
    const value = payload as { throwerId: number | null };
    if (value.throwerId === null) throw new Error('Select the turnover thrower.');
  } else if (type === 'defended') {
    const value = payload as DefendedPayload;
    if (value.defenderId === null) throw new Error('Select the defender.');
  } else if (type === 'goal') {
    const value = payload as {
      throwerId: number | null;
      receiverId: number | null;
      callahan: boolean;
    };
    if (!value.callahan && value.throwerId === null) throw new Error('Select the goal thrower.');
    if (value.receiverId === null) throw new Error('Select the goal scorer.');
  }
}

function activePayloadPlayerIds(type: GameEventType, payload: GameEventPayload): number[] {
  if (type === 'substitution') {
    const outgoing = (payload as { outgoingPlayerId: number | null }).outgoingPlayerId;
    return present([outgoing]);
  }
  return payloadPlayerIds(type, payload);
}

function present(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null);
}

function timecode(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Timecode must be a non-negative whole number of milliseconds.');
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative whole number.`);
  }
  return value;
}

function finiteRange(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function spatialAnnotationRole(value: unknown): SpatialAnnotationRole {
  if (
    value === 'handler' ||
    value === 'thrower' ||
    value === 'receiver' ||
    value === 'intended_receiver' ||
    value === 'defender' ||
    value === 'scorer' ||
    value === 'outgoing_player' ||
    value === 'incoming_player'
  ) return value;
  throw new Error('Select a supported spatial annotation role.');
}

function statisticCount(value: number, name: string, maximum = 9_999): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be a whole number between 0 and ${maximum}.`);
  }
  return value;
}

function optionalPaperText(value: string | null, name: string): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  if (normalized.length > 80) throw new Error(`${name} must be 80 characters or fewer.`);
  return normalized;
}

function requiredText(value: string, maximum: number, name: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new Error(`${name} is required.`);
  if (normalized.length > maximum) {
    throw new Error(`${name} must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function uniqueIds(values: number[], name: string): number[] {
  const unique = [...new Set(values)];
  if (unique.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${name} selection is invalid.`);
  }
  return unique;
}

function validatedRoleOverrides(
  input: Record<number, MatchupRole>,
  pointPlayerIds: number[],
): Record<number, MatchupRole> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Point matchup role overrides must be an object.');
  }
  const allowed = new Set(pointPlayerIds);
  const parsed: Record<number, MatchupRole> = {};
  for (const [playerIdValue, value] of Object.entries(input)) {
    const playerId = Number(playerIdValue);
    if (!Number.isSafeInteger(playerId) || !allowed.has(playerId)) {
      throw new Error('Every point matchup override must belong to the pull lineup.');
    }
    const role = parseOptionalMatchupRole(value);
    if (role !== null) parsed[playerId] = role;
  }
  return parsed;
}
