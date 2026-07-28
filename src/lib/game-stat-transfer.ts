import {
  parseGameEventPayload,
  parseGameEventType,
} from './game-events';
import { parseOptionalMatchupRole, type MatchupRole } from './matchup';
import type {
  GameEventPayload,
  GameEventType,
  SpatialAnnotationRole,
  StartingPossession,
  StrategyKind,
  TeamEndzone,
  TrackingGameData,
} from './game-stats';

/** Stable identifier written at the root of every UVS game-statistics file. */
export const GAME_STATISTICS_EXPORT_FORMAT = 'uvs-game-statistics';

/** Current schema version for UVS game-statistics files. */
export const GAME_STATISTICS_EXPORT_VERSION = 2;

/** Maximum accepted UTF-8 JSON file size for a game-statistics import. */
export const MAX_GAME_STATISTICS_EXPORT_BYTES = 25_000_000;

/** Source roster reference used to remap a player during import. */
export interface ExportedPlayerReference {
  id: number;
  name: string;
}

/** Source event-line reference used to remap a line during import. */
export interface ExportedLineReference {
  id: number;
  name: string;
}

/** Source season-strategy reference used to remap a strategy during import. */
export interface ExportedStrategyReference {
  id: number;
  name: string;
  kind: StrategyKind;
}

/** One exported spatial annotation without a database-owned destination ID. */
export interface ExportedSpatialAnnotation {
  role: SpatialAnnotationRole;
  playerId: number | null;
  timeMs: number;
  frameIndex: number;
  panoramaYaw: number;
  panoramaPitch: number;
}

/** One exported timeline event, retaining its source ID for stable same-time ordering. */
export interface ExportedGameEvent {
  sourceId: number;
  timeMs: number;
  type: GameEventType;
  payload: GameEventPayload;
  annotations: ExportedSpatialAnnotation[];
}

/** One exported play-by-play point and all of its timeline events. */
export interface ExportedGamePoint {
  sourceId: number;
  sequenceNumber: number;
  lineId: number;
  startingPossession: StartingPossession;
  startTimeMs: number;
  pullerPlayerId: number | null;
  lineupEndzoneOverride: TeamEndzone | null;
  initialOffenseStrategyId: number | null;
  initialDefenseStrategyId: number | null;
  startingPlayerIds: number[];
  matchupRoleOverrides: Record<number, MatchupRole>;
  events: ExportedGameEvent[];
}

/** One exported video highlight. */
export interface ExportedGameHighlight {
  startTimeMs: number;
  endTimeMs: number;
  description: string;
  playerIds: number[];
}

/** One exported paper player-total row. */
export interface ExportedManualPlayerStatistics {
  playerId: number;
  pointsPlayed: number;
  hockeyAssists: number;
  assists: number;
  goals: number;
  blocks: number;
}

/** One exported paper point-summary row. */
export interface ExportedManualPoint {
  sequenceNumber: number;
  lineId: number;
  startingPossession: StartingPossession;
  initialDefenseType: string | null;
  offenseStrategyId: number | null;
  defenseStrategyId: number | null;
  ourTurnovers: number;
  scoringMethod: string | null;
  throwerPlayerId: number | null;
  receiverPlayerId: number | null;
  ourScore: number;
  opponentScore: number;
}

/** Current portable backup of all statistics attached to one game. */
export interface GameStatisticsExport {
  format: typeof GAME_STATISTICS_EXPORT_FORMAT;
  version: typeof GAME_STATISTICS_EXPORT_VERSION;
  exportedAt: string;
  sourceGame: {
    title: string;
    teamName: string;
    opponentName: string;
    playedAt: string | null;
    hasVideo: boolean;
  };
  baseline: {
    initialOurScore: number;
    initialOpponentScore: number;
    initialLineupEndzone: TeamEndzone;
  };
  references: {
    players: ExportedPlayerReference[];
    lines: ExportedLineReference[];
    strategies: ExportedStrategyReference[];
  };
  statistics: {
    gameMatchupRoleOverrides: Record<number, MatchupRole>;
    points: ExportedGamePoint[];
    standaloneEvents: ExportedGameEvent[];
    highlights: ExportedGameHighlight[];
    manualPlayerStatistics: ExportedManualPlayerStatistics[];
    manualPoints: ExportedManualPoint[];
  };
}

/** Version-two portable backup of all statistics attached to one game. */
export type GameStatisticsExportV2 = GameStatisticsExport;

/** Build a portable, calculated-field-free statistics backup from persisted game data. */
export function createGameStatisticsExport(
  data: TrackingGameData,
  exportedAt = new Date().toISOString(),
): GameStatisticsExport {
  return {
    format: GAME_STATISTICS_EXPORT_FORMAT,
    version: GAME_STATISTICS_EXPORT_VERSION,
    exportedAt,
    sourceGame: {
      title: data.game.title,
      teamName: data.game.teamName,
      opponentName: data.game.opponentName,
      playedAt: data.game.playedAt,
      hasVideo: data.game.hasVideo,
    },
    baseline: {
      initialOurScore: data.game.initialOurScore,
      initialOpponentScore: data.game.initialOpponentScore,
      initialLineupEndzone: data.game.initialLineupEndzone,
    },
    references: {
      players: data.players.map((player) => ({ id: player.id, name: player.name })),
      lines: data.lines.map((line) => ({ id: line.id, name: line.name })),
      strategies: data.strategies.map((strategy) => ({
        id: strategy.id,
        name: strategy.name,
        kind: strategy.kind,
      })),
    },
    statistics: {
      gameMatchupRoleOverrides: Object.fromEntries(
        data.players.flatMap((player) =>
          player.gameMatchupRoleOverride === null
            ? []
            : [[player.id, player.gameMatchupRoleOverride]],
        ),
      ),
      points: data.points.map((point) => ({
        sourceId: point.id,
        sequenceNumber: point.sequenceNumber,
        lineId: point.lineId,
        startingPossession: point.startingPossession,
        startTimeMs: point.startTimeMs,
        pullerPlayerId: point.pullerPlayerId,
        lineupEndzoneOverride: point.lineupEndzoneOverride,
        initialOffenseStrategyId: point.initialOffenseStrategyId,
        initialDefenseStrategyId: point.initialDefenseStrategyId,
        startingPlayerIds: point.startingPlayerIds,
        matchupRoleOverrides: point.matchupRoleOverrides,
        events: point.events.map(exportEvent),
      })),
      standaloneEvents: data.standaloneEvents.map(exportEvent),
      highlights: data.highlights.map((highlight) => ({
        startTimeMs: highlight.startTimeMs,
        endTimeMs: highlight.endTimeMs,
        description: highlight.description,
        playerIds: highlight.playerIds,
      })),
      manualPlayerStatistics: data.manualPlayerStatistics.map((statistics) => ({ ...statistics })),
      manualPoints: data.manualPoints.map((point) => ({
        sequenceNumber: point.sequenceNumber,
        lineId: point.lineId,
        startingPossession: point.startingPossession,
        initialDefenseType: point.initialDefenseType,
        offenseStrategyId: point.offenseStrategyId,
        defenseStrategyId: point.defenseStrategyId,
        ourTurnovers: point.ourTurnovers,
        scoringMethod: point.scoringMethod,
        throwerPlayerId: point.throwerPlayerId,
        receiverPlayerId: point.receiverPlayerId,
        ourScore: point.ourScore,
        opponentScore: point.opponentScore,
      })),
    },
  };
}

/** Parse and normalize an untrusted supported UVS game-statistics file. */
export function parseGameStatisticsExport(value: unknown): GameStatisticsExport {
  const root = object(value, 'Statistics file');
  if (root.format !== GAME_STATISTICS_EXPORT_FORMAT) {
    throw new Error('Select an Ultimate Video Stats game-statistics JSON file.');
  }
  if (root.version !== 1 && root.version !== GAME_STATISTICS_EXPORT_VERSION) {
    throw new Error(`Statistics file version ${String(root.version)} is not supported.`);
  }
  const sourceVersion = root.version;
  const sourceGame = object(root.sourceGame, 'Source game');
  const baseline = object(root.baseline, 'Score baseline');
  const references = object(root.references, 'References');
  const statistics = object(root.statistics, 'Statistics');
  const players = limitedArray(references.players, 500, 'Player references')
    .map((item, index) => {
      const player = object(item, `Player reference ${index + 1}`);
      return {
        id: positiveInteger(player.id, `Player reference ${index + 1}`),
        name: requiredText(player.name, 160, `Player reference ${index + 1} name`),
      };
    });
  const lines = limitedArray(references.lines, 500, 'Line references')
    .map((item, index) => {
      const line = object(item, `Line reference ${index + 1}`);
      return {
        id: positiveInteger(line.id, `Line reference ${index + 1}`),
        name: requiredText(line.name, 80, `Line reference ${index + 1} name`),
      };
    });
  const strategies = limitedArray(references.strategies, 500, 'Strategy references')
    .map((item, index) => {
      const strategy = object(item, `Strategy reference ${index + 1}`);
      return {
        id: positiveInteger(strategy.id, `Strategy reference ${index + 1}`),
        name: requiredText(strategy.name, 80, `Strategy reference ${index + 1} name`),
        kind: strategyKind(strategy.kind, `Strategy reference ${index + 1}`),
      };
    });
  requireUniqueIds(players, 'Player references');
  requireUniqueIds(lines, 'Line references');
  requireUniqueIds(strategies, 'Strategy references');

  const points = limitedArray(statistics.points, 2_000, 'Points')
    .map((item, index) => parsePoint(item, index));
  requireUniqueSourceIds(points, 'Points');
  const standaloneEvents = limitedArray(
    statistics.standaloneEvents,
    100_000,
    'Standalone events',
  ).map((item, index) => parseEvent(item, `Standalone event ${index + 1}`));
  const eventIds = [
    ...points.flatMap((point) => point.events.map((event) => event.sourceId)),
    ...standaloneEvents.map((event) => event.sourceId),
  ];
  if (new Set(eventIds).size !== eventIds.length) {
    throw new Error('Every exported event must have a unique source ID.');
  }
  if (eventIds.length > 100_000) throw new Error('Statistics file contains too many events.');

  return {
    format: GAME_STATISTICS_EXPORT_FORMAT,
    version: GAME_STATISTICS_EXPORT_VERSION,
    exportedAt: requiredIsoDate(root.exportedAt, 'Export date'),
    sourceGame: {
      title: requiredText(sourceGame.title, 160, 'Source game title'),
      teamName: requiredText(sourceGame.teamName, 120, 'Source team name'),
      opponentName: requiredText(sourceGame.opponentName, 160, 'Source opponent name'),
      playedAt: optionalText(sourceGame.playedAt, 40, 'Source game date'),
      hasVideo: boolean(sourceGame.hasVideo, 'Source video availability'),
    },
    baseline: {
      initialOurScore: count(baseline.initialOurScore, 'Initial team score', 999),
      initialOpponentScore: count(baseline.initialOpponentScore, 'Initial opponent score', 999),
      initialLineupEndzone: endzone(baseline.initialLineupEndzone, 'Initial lineup endzone'),
    },
    references: { players, lines, strategies },
    statistics: {
      gameMatchupRoleOverrides: matchupOverrides(
        statistics.gameMatchupRoleOverrides,
        'Game matchup overrides',
      ),
      points,
      standaloneEvents,
      highlights: limitedArray(statistics.highlights, 10_000, 'Highlights')
        .map((item, index) => {
          const highlight = object(item, `Highlight ${index + 1}`);
          return {
            startTimeMs: count(highlight.startTimeMs, `Highlight ${index + 1} start`),
            endTimeMs: count(highlight.endTimeMs, `Highlight ${index + 1} end`),
            description: requiredText(
              highlight.description,
              500,
              `Highlight ${index + 1} description`,
            ),
            playerIds: positiveIntegerArray(
              highlight.playerIds,
              `Highlight ${index + 1} players`,
              500,
            ),
          };
        }),
      manualPlayerStatistics: limitedArray(
        statistics.manualPlayerStatistics,
        500,
        'Paper player statistics',
      ).map((item, index) => {
        const row = object(item, `Paper player row ${index + 1}`);
        return {
          playerId: positiveInteger(row.playerId, `Paper player row ${index + 1}`),
          pointsPlayed: count(row.pointsPlayed, 'Points played'),
          hockeyAssists: count(row.hockeyAssists, 'Hockey assists'),
          assists: count(row.assists, 'Assists'),
          goals: count(row.goals, 'Goals'),
          blocks: count(row.blocks, 'Defenses'),
        };
      }),
      manualPoints: limitedArray(statistics.manualPoints, 2_000, 'Paper points')
        .map((item, index) => parseManualPoint(item, index, sourceVersion)),
    },
  };
}

function exportEvent(event: TrackingGameData['standaloneEvents'][number]): ExportedGameEvent {
  return {
    sourceId: event.id,
    timeMs: event.timeMs,
    type: event.type,
    payload: event.payload,
    annotations: event.annotations.map((annotation) => ({
      role: annotation.role,
      playerId: annotation.playerId,
      timeMs: annotation.timeMs,
      frameIndex: annotation.frameIndex,
      panoramaYaw: annotation.panoramaYaw,
      panoramaPitch: annotation.panoramaPitch,
    })),
  };
}

function parsePoint(value: unknown, index: number): ExportedGamePoint {
  const label = `Point ${index + 1}`;
  const point = object(value, label);
  return {
    sourceId: positiveInteger(point.sourceId, `${label} source ID`),
    sequenceNumber: positiveInteger(point.sequenceNumber, `${label} sequence`),
    lineId: positiveInteger(point.lineId, `${label} line`),
    startingPossession: possession(point.startingPossession, label),
    startTimeMs: count(point.startTimeMs, `${label} pull time`),
    pullerPlayerId: optionalPositiveInteger(point.pullerPlayerId, `${label} puller`),
    lineupEndzoneOverride: optionalEndzone(point.lineupEndzoneOverride, `${label} endzone`),
    initialOffenseStrategyId: optionalPositiveInteger(
      point.initialOffenseStrategyId,
      `${label} offense`,
    ),
    initialDefenseStrategyId: optionalPositiveInteger(
      point.initialDefenseStrategyId,
      `${label} defense`,
    ),
    startingPlayerIds: positiveIntegerArray(point.startingPlayerIds, `${label} players`, 500),
    matchupRoleOverrides: matchupOverrides(point.matchupRoleOverrides, `${label} matchup overrides`),
    events: limitedArray(point.events, 20_000, `${label} events`)
      .map((event, eventIndex) => parseEvent(event, `${label} event ${eventIndex + 1}`)),
  };
}

function parseEvent(value: unknown, label: string): ExportedGameEvent {
  const event = object(value, label);
  const type = parseGameEventType(event.type);
  return {
    sourceId: positiveInteger(event.sourceId, `${label} source ID`),
    timeMs: count(event.timeMs, `${label} time`),
    type,
    payload: parseGameEventPayload(type, event.payload),
    annotations: limitedArray(event.annotations, 12, `${label} spatial annotations`)
      .map((item, index) => {
        const annotation = object(item, `${label} annotation ${index + 1}`);
        return {
          role: spatialRole(annotation.role, `${label} annotation ${index + 1}`),
          playerId: optionalPositiveInteger(
            annotation.playerId,
            `${label} annotation ${index + 1} player`,
          ),
          timeMs: count(annotation.timeMs, `${label} annotation ${index + 1} time`),
          frameIndex: count(annotation.frameIndex, `${label} annotation ${index + 1} frame`),
          panoramaYaw: finiteRange(
            annotation.panoramaYaw,
            -Math.PI,
            Math.PI,
            `${label} annotation ${index + 1} yaw`,
          ),
          panoramaPitch: finiteRange(
            annotation.panoramaPitch,
            -Math.PI / 2,
            Math.PI / 2,
            `${label} annotation ${index + 1} pitch`,
          ),
        };
      }),
  };
}

function parseManualPoint(
  value: unknown,
  index: number,
  sourceVersion: 1 | typeof GAME_STATISTICS_EXPORT_VERSION,
): ExportedManualPoint {
  const label = `Paper point ${index + 1}`;
  const point = object(value, label);
  return {
    sequenceNumber: positiveInteger(point.sequenceNumber, `${label} sequence`),
    lineId: positiveInteger(point.lineId, `${label} line`),
    startingPossession: possession(point.startingPossession, label),
    initialDefenseType: optionalText(point.initialDefenseType, 80, `${label} defense type`),
    offenseStrategyId: optionalPositiveInteger(point.offenseStrategyId, `${label} offense`),
    defenseStrategyId: optionalPositiveInteger(point.defenseStrategyId, `${label} defense`),
    ourTurnovers: count(point.ourTurnovers, `${label} turnovers`),
    scoringMethod: optionalText(point.scoringMethod, 80, `${label} scoring method`),
    throwerPlayerId: sourceVersion === 1
      ? null
      : optionalPositiveInteger(point.throwerPlayerId, `${label} thrower`),
    receiverPlayerId: sourceVersion === 1
      ? optionalPositiveInteger(point.scorerPlayerId, `${label} scorer`)
      : optionalPositiveInteger(point.receiverPlayerId, `${label} receiver`),
    ourScore: count(point.ourScore, `${label} team score`, 999),
    opponentScore: count(point.opponentScore, `${label} opponent score`, 999),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function limitedArray(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  if (value.length > maximum) throw new Error(`${label} contains too many entries.`);
  return value;
}

function positiveIntegerArray(value: unknown, label: string, maximum: number): number[] {
  const values = limitedArray(value, maximum, label).map((item) => positiveInteger(item, label));
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates.`);
  return values;
}

function requiredText(value: unknown, maximum: number, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${label} is invalid.`);
  return normalized;
}

function optionalText(value: unknown, maximum: number, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return requiredText(value, maximum, label);
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} is invalid.`);
  return parsed;
}

function optionalPositiveInteger(value: unknown, label: string): number | null {
  return value === null || value === undefined || value === ''
    ? null
    : positiveInteger(value, label);
}

function count(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
}

function finiteRange(value: unknown, minimum: number, maximum: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid.`);
  return value;
}

function requiredIsoDate(value: unknown, label: string): string {
  const text = requiredText(value, 40, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} is invalid.`);
  return text;
}

function possession(value: unknown, label: string): StartingPossession {
  if (value !== 'offense' && value !== 'defense') {
    throw new Error(`${label} must start on offense or defense.`);
  }
  return value;
}

function strategyKind(value: unknown, label: string): StrategyKind {
  if (value !== 'offense' && value !== 'defense') throw new Error(`${label} kind is invalid.`);
  return value;
}

function endzone(value: unknown, label: string): TeamEndzone {
  if (value !== 'left' && value !== 'right') throw new Error(`${label} is invalid.`);
  return value;
}

function optionalEndzone(value: unknown, label: string): TeamEndzone | null {
  return value === null || value === undefined || value === '' ? null : endzone(value, label);
}

function matchupOverrides(value: unknown, label: string): Record<number, MatchupRole> {
  const overrides = object(value, label);
  const result: Record<number, MatchupRole> = {};
  for (const [playerIdValue, roleValue] of Object.entries(overrides)) {
    const playerId = positiveInteger(playerIdValue, `${label} player`);
    const role = parseOptionalMatchupRole(roleValue);
    if (role === null) throw new Error(`${label} contains an invalid role.`);
    result[playerId] = role;
  }
  return result;
}

function spatialRole(value: unknown, label: string): SpatialAnnotationRole {
  const roles: SpatialAnnotationRole[] = [
    'handler',
    'thrower',
    'receiver',
    'intended_receiver',
    'defender',
    'turnover_location',
    'scorer',
    'outgoing_player',
    'incoming_player',
  ];
  if (!roles.includes(value as SpatialAnnotationRole)) throw new Error(`${label} role is invalid.`);
  return value as SpatialAnnotationRole;
}

function requireUniqueIds(
  references: Array<{ id: number }>,
  label: string,
): void {
  if (new Set(references.map((reference) => reference.id)).size !== references.length) {
    throw new Error(`${label} contains duplicate IDs.`);
  }
}

function requireUniqueSourceIds(
  references: Array<{ sourceId: number }>,
  label: string,
): void {
  if (new Set(references.map((reference) => reference.sourceId)).size !== references.length) {
    throw new Error(`${label} contains duplicate source IDs.`);
  }
}
