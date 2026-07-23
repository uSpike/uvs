import { gameEventIsIncomplete } from './game-events';
import type { MatchupRole } from './matchup';

/** Whether the tracked team began a point with the disc. */
export type StartingPossession = 'offense' | 'defense';

/** Goal line where the tracked team lines up, as seen in the panoramic video. */
export type TeamEndzone = 'left' | 'right';

/** Video-time delay after a score before AutoCam returns to a lineup endzone. */
export const AUTO_CAMERA_ENDZONE_RETURN_DELAY_MS = 10_000;

/** Supported explanations for a tracked-team turnover. */
export type TurnoverReason = 'drop' | 'block' | 'throwaway' | 'unknown';

/** Supported explanations for an unforced opponent turnover. */
export type OpponentTurnoverReason = 'drop' | 'throwaway' | 'unknown';

/** Dead-disc interval categories. */
export type StoppageKind = 'foul' | 'injury' | 'timeout' | 'other';

/** Tactical system category configured on a season roster. */
export type StrategyKind = 'offense' | 'defense';

/** Semantic meaning of a manually marked player position within an event. */
export type SpatialAnnotationRole =
  | 'handler'
  | 'thrower'
  | 'receiver'
  | 'intended_receiver'
  | 'defender'
  | 'turnover_location'
  | 'scorer'
  | 'outgoing_player'
  | 'incoming_player';

/** Every action that may appear on a game's statistics timeline. */
export type GameEventType =
  | 'possession_start'
  | 'completion'
  | 'turnover'
  | 'defended'
  | 'opponent_turnover'
  | 'goal'
  | 'conceded'
  | 'substitution'
  | 'stoppage'
  | 'score_set'
  | 'strategy_set';

/** One season-defined offensive or defensive system available to the game. */
export interface TrackingStrategy {
  id: number;
  name: string;
  kind: StrategyKind;
  isDefault: boolean;
}

/** Player options available to a game recorder. */
export interface TrackingPlayer {
  id: number;
  name: string;
  defaultMatchupRole: MatchupRole | null;
  gameMatchupRoleOverride: MatchupRole | null;
  matchupRole: MatchupRole | null;
}

/** Tournament line and its game-available suggested players. */
export interface TrackingLine {
  id: number;
  name: string;
  suggestedPlayerIds: number[];
}

/** Payload recorded when a tracked player takes possession of a live disc. */
export interface PossessionStartPayload {
  playerId: number | null;
}

/** Payload recorded for a completed pass. */
export interface CompletionPayload {
  throwerId: number | null;
  receiverId: number | null;
}

/** Payload recorded when the tracked team loses possession. */
export interface TurnoverPayload {
  throwerId: number | null;
  intendedReceiverId: number | null;
  reason: TurnoverReason;
}

/** Payload recorded when a tracked player blocks the opponent. */
export interface DefendedPayload {
  defenderId: number | null;
}

/** Payload recorded when the opponent loses possession without a tracked block. */
export interface OpponentTurnoverPayload {
  reason: OpponentTurnoverReason;
}

/** Payload recorded when the tracked team scores. */
export interface GoalPayload {
  throwerId: number | null;
  receiverId: number | null;
  callahan: boolean;
}

/** Payload recorded when the opponent scores. */
export interface ConcededPayload {
  callahan: boolean;
}

/** Payload recorded for an injury substitution. */
export interface SubstitutionPayload {
  outgoingPlayerId: number | null;
  incomingPlayerId: number | null;
}

/** Payload recorded for a dead-disc interval. */
export interface StoppagePayload {
  kind: StoppageKind;
  endTimeMs: number | null;
}

/** Payload recorded when the visible score is synchronized after a video gap. */
export interface ScoreSetPayload {
  ourScore: number;
  opponentScore: number;
}

/** Payload recorded when the team changes its tactical system during a point. */
export interface StrategySetPayload {
  kind: StrategyKind;
  strategyId: number;
}

/** Payload associated with a game event. */
export type GameEventPayload =
  | PossessionStartPayload
  | CompletionPayload
  | TurnoverPayload
  | DefendedPayload
  | OpponentTurnoverPayload
  | GoalPayload
  | ConcededPayload
  | SubstitutionPayload
  | StoppagePayload
  | ScoreSetPayload
  | StrategySetPayload;

/** One manual, time-aligned player position marked in panorama space. */
export interface EventSpatialAnnotation {
  id: number;
  role: SpatialAnnotationRole;
  playerId: number | null;
  timeMs: number;
  frameIndex: number;
  panoramaYaw: number;
  panoramaPitch: number;
}

/** One persisted, editable game event. */
export interface TrackingEvent {
  id: number;
  pointId: number | null;
  timeMs: number;
  type: GameEventType;
  payload: GameEventPayload;
  annotations: EventSpatialAnnotation[];
  createdAt: string;
  updatedAt: string;
}

/** One point and the players active when its pull was released. */
export interface TrackingPoint {
  id: number;
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
  events: TrackingEvent[];
}

/** Return the latest manually marked position that established a player's possession. */
export function latestHandlerSpatialAnnotation(
  point: TrackingPoint,
  playerId: number,
): EventSpatialAnnotation | null {
  return point.events
    .flatMap((event) => event.annotations)
    .filter((annotation) =>
      annotation.playerId === playerId &&
      (annotation.role === 'handler' || annotation.role === 'receiver'))
    .sort((left, right) => right.timeMs - left.timeMs || right.id - left.id)[0] ?? null;
}

/** One deduplicated saved position that may flash during ordinary game playback. */
export interface GamePlaybackAnnotation extends EventSpatialAnnotation {
  eventId: number;
  eventType: GameEventType;
}

/**
 * Flatten saved event positions for playback. Carried thrower positions duplicate the
 * possession/reception that established them, so identical player/time/position labels
 * are emitted only once.
 */
export function gamePlaybackAnnotations(data: TrackingGameData): GamePlaybackAnnotation[] {
  const seen = new Set<string>();
  const annotations: GamePlaybackAnnotation[] = [];
  const events = [
    ...data.points.flatMap((point) => point.events),
    ...data.standaloneEvents,
  ].sort((left, right) => left.timeMs - right.timeMs || left.id - right.id);
  for (const event of events) {
    for (const annotation of event.annotations) {
      const key = [
        annotation.playerId ?? 'unknown',
        annotation.timeMs,
        annotation.frameIndex,
        annotation.panoramaYaw,
        annotation.panoramaPitch,
      ].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      annotations.push({ ...annotation, eventId: event.id, eventType: event.type });
    }
  }
  return annotations.sort((left, right) => left.timeMs - right.timeMs || left.id - right.id);
}

/** Whole-game player totals copied from a paper score sheet. */
export interface ManualPlayerGameStatistics {
  playerId: number;
  pointsPlayed: number;
  hockeyAssists: number;
  assists: number;
  goals: number;
  blocks: number;
}

/** One point-level summary copied from a paper score sheet. Scores are after the point. */
export interface ManualPointSummary {
  id: number;
  sequenceNumber: number;
  lineId: number;
  startingPossession: StartingPossession;
  initialDefenseType: string | null;
  offenseStrategyId: number | null;
  defenseStrategyId: number | null;
  ourTurnovers: number;
  scoringMethod: string | null;
  scorerPlayerId: number | null;
  ourScore: number;
  opponentScore: number;
}

/** A noteworthy video range, optionally attributed to tournament players. */
export interface GameHighlight {
  id: number;
  startTimeMs: number;
  endTimeMs: number;
  description: string;
  playerIds: number[];
  createdAt: string;
  updatedAt: string;
}

/** Game fields needed by the recorder and statistics reducer. */
export interface TrackingGame {
  id: number;
  token: string;
  title: string;
  teamName: string;
  teamSlug: string;
  tournamentId: number;
  tournamentName: string;
  opponentName: string;
  playedAt: string | null;
  hasVideo: boolean;
  expectedPlayerCount: number;
  initialOurScore: number;
  initialOpponentScore: number;
  initialLineupEndzone: TeamEndzone;
}

/** Complete persisted input used to calculate one game's state. */
export interface TrackingGameData {
  game: TrackingGame;
  players: TrackingPlayer[];
  lines: TrackingLine[];
  strategies: TrackingStrategy[];
  points: TrackingPoint[];
  standaloneEvents: TrackingEvent[];
  highlights: GameHighlight[];
  manualPlayerStatistics: ManualPlayerGameStatistics[];
  manualPoints: ManualPointSummary[];
}

/** Current possession and handler derived for an open point. */
export interface PointState {
  possession: StartingPossession;
  handlerPlayerId: number | null;
  activePlayerIds: number[];
  ended: boolean;
  endTimeMs: number | null;
  outcome: 'goal' | 'conceded' | null;
  openStoppageEventId: number | null;
  offenseStrategyId: number | null;
  defenseStrategyId: number | null;
}

/** Statistics attributed to one player. */
export interface PlayerStatistics {
  playerId: number;
  playerName: string;
  timePlayedMs: number;
  pointsPlayed: number;
  oPointsPlayed: number;
  dPointsPlayed: number;
  oPointsWon: number;
  dPointsWon: number;
  completions: number;
  receptions: number;
  turnovers: number;
  goals: number;
  assists: number;
  hockeyAssists: number;
  blocks: number;
  pulls: number;
  plusMinus: number;
  timeWithDiscMs: number;
}

/** Statistics attributed to one tournament line without summing player totals. */
export interface LineStatistics {
  lineId: number;
  lineName: string;
  timePlayedMs: number;
  pointsPlayed: number;
  oPointsPlayed: number;
  dPointsPlayed: number;
  oPointsWon: number;
  dPointsWon: number;
  completions: number;
  turnovers: number;
  blocks: number;
  goalsFor: number;
  goalsAgainst: number;
  plusMinus: number;
}

/** Point outcomes grouped by the 4/3 preferred matchup majority. */
export interface MatchupPointStatistics {
  matchup: MatchupRole;
  pointsPlayed: number;
  pointsWon: number;
  oPointsPlayed: number;
  oPointsWon: number;
  dPointsPlayed: number;
  dPointsWon: number;
}

/** Team point statistics split into MMP, FMP, and unclassified lineups. */
export interface MatchupStatistics {
  mmp: MatchupPointStatistics;
  fmp: MatchupPointStatistics;
  unclassifiedPoints: number;
}

/** Number of games contributing each level of statistical detail. */
export interface StatisticsCoverage {
  gameCount: number;
  playByPlayGames: number;
  paperPlayerGames: number;
  paperPointGames: number;
}

/** Score and statistics derived from one game's event timeline. */
export interface CalculatedGameStatistics {
  ourScore: number;
  opponentScore: number;
  playerStatistics: PlayerStatistics[];
  lineStatistics: LineStatistics[];
  matchupStatistics: MatchupStatistics;
  coverage: StatisticsCoverage;
  warnings: string[];
}

/** Recorder data together with all state derived from its timeline. */
export interface GameTrackingSnapshot {
  data: TrackingGameData;
  statistics: CalculatedGameStatistics;
  currentPointId: number | null;
  currentPointState: PointState | null;
}

/** Score and outcome displayed for one play-by-play point. */
export interface PointResultSummary {
  pointId: number;
  sequenceNumber: number;
  ourScore: number;
  opponentScore: number;
  result: 'won' | 'lost' | 'open';
  breakAgainst: boolean;
}

/** Score visible at a particular position in a game's video timeline. */
export interface GameScore {
  ourScore: number;
  opponentScore: number;
}

interface ParticipationInterval {
  playerId: number;
  startTimeMs: number;
  endTimeMs: number;
}

interface PointCalculation {
  point: TrackingPoint;
  state: PointState;
  terminalEvent: TrackingEvent | null;
  participation: ParticipationInterval[];
  activeAtTerminal: Set<number>;
  matchup: MatchupRole | null;
}

/** Classify exactly seven pull-release roles as a 4/3 MMP or FMP point. */
export function classifyMatchupRoles(roles: Array<MatchupRole | null>): MatchupRole | null {
  if (roles.length !== 7 || roles.some((role) => role === null)) return null;
  const mmpCount = roles.filter((role) => role === 'mmp').length;
  if (mmpCount === 4) return 'mmp';
  if (mmpCount === 3) return 'fmp';
  return null;
}

/** Calculate possession, active players, and terminal state for one point. */
export function calculatePointState(point: TrackingPoint): PointState {
  const active = new Set(point.startingPlayerIds);
  let possession = point.startingPossession;
  let handlerPlayerId: number | null = null;
  let ended = false;
  let endTimeMs: number | null = null;
  let outcome: PointState['outcome'] = null;
  let openStoppageEventId: number | null = null;
  let offenseStrategyId = point.initialOffenseStrategyId;
  let defenseStrategyId = point.initialDefenseStrategyId;

  for (const event of sortedEvents(point.events)) {
    if (ended) continue;
    switch (event.type) {
      case 'possession_start':
        possession = 'offense';
        handlerPlayerId = (event.payload as PossessionStartPayload).playerId;
        break;
      case 'completion':
        possession = 'offense';
        handlerPlayerId = (event.payload as CompletionPayload).receiverId;
        break;
      case 'turnover':
        possession = 'defense';
        handlerPlayerId = null;
        break;
      case 'defended':
      case 'opponent_turnover':
        possession = 'offense';
        handlerPlayerId = null;
        break;
      case 'goal':
        ended = true;
        endTimeMs = event.timeMs;
        outcome = 'goal';
        handlerPlayerId = null;
        break;
      case 'conceded':
        ended = true;
        endTimeMs = event.timeMs;
        outcome = 'conceded';
        handlerPlayerId = null;
        break;
      case 'substitution': {
        const payload = event.payload as SubstitutionPayload;
        if (payload.outgoingPlayerId !== null) active.delete(payload.outgoingPlayerId);
        if (payload.incomingPlayerId !== null) active.add(payload.incomingPlayerId);
        if (handlerPlayerId === payload.outgoingPlayerId) handlerPlayerId = null;
        break;
      }
      case 'stoppage':
        if ((event.payload as StoppagePayload).endTimeMs === null) {
          openStoppageEventId = event.id;
        }
        break;
      case 'score_set':
        break;
      case 'strategy_set': {
        const payload = event.payload as StrategySetPayload;
        if (payload.kind === 'offense') offenseStrategyId = payload.strategyId;
        else defenseStrategyId = payload.strategyId;
        break;
      }
    }
  }

  return {
    possession,
    handlerPlayerId,
    activePlayerIds: [...active],
    ended,
    endTimeMs,
    outcome,
    openStoppageEventId,
    offenseStrategyId,
    defenseStrategyId,
  };
}

/** Return the opposite panoramic-video goal line. */
export function oppositeEndzone(endzone: TeamEndzone): TeamEndzone {
  return endzone === 'left' ? 'right' : 'left';
}

/**
 * Select the endzone AutoCam should frame at a video time, or null while a
 * point is live and the whole field should participate in framing.
 */
export function autoCameraEndzoneAtTime(
  data: Pick<TrackingGameData, 'game' | 'points'>,
  timeMs: number,
): TeamEndzone | null {
  const points = [...data.points].sort(
    (left, right) => left.sequenceNumber - right.sequenceNumber || left.id - right.id,
  );
  if (points.length === 0) return null;

  let inferredEndzone = data.game.initialLineupEndzone;

  for (const point of points) {
    const lineupEndzone = point.lineupEndzoneOverride ?? inferredEndzone;
    if (timeMs < point.startTimeMs) return lineupEndzone;

    const state = calculatePointState(point);
    if (!state.ended || state.endTimeMs === null || timeMs < state.endTimeMs) return null;

    const scoredEndzone = state.outcome === 'goal'
      ? oppositeEndzone(lineupEndzone)
      : lineupEndzone;
    // Teams change ends after every point. After our goal, that is also the
    // endzone where we remain to pull; after a concession, it is where we receive.
    inferredEndzone = oppositeEndzone(lineupEndzone);
    if (timeMs < state.endTimeMs + AUTO_CAMERA_ENDZONE_RETURN_DELAY_MS) {
      return scoredEndzone;
    }
  }

  return inferredEndzone;
}

/**
 * Return the next useful playback time when the current time is inside an
 * unrecorded gap. The same buffer is preserved after a score and before a pull.
 */
export function autoSkipTargetTimeMs(
  data: Pick<TrackingGameData, 'points'>,
  timeMs: number,
  bufferMs: number,
): number | null {
  if (!Number.isFinite(timeMs) || !Number.isFinite(bufferMs)) return null;
  const currentTimeMs = Math.max(0, timeMs);
  const safeBufferMs = Math.max(0, bufferMs);
  const points = [...data.points].sort(
    (left, right) => left.startTimeMs - right.startTimeMs || left.id - right.id,
  );
  const firstPoint = points[0];
  if (!firstPoint) return null;

  const firstPointLeadInMs = Math.max(0, firstPoint.startTimeMs - safeBufferMs);
  if (currentTimeMs < firstPointLeadInMs) return firstPointLeadInMs;

  for (let index = 0; index < points.length - 1; index += 1) {
    const state = calculatePointState(points[index]);
    if (!state.ended || state.endTimeMs === null) continue;
    const nextPointLeadInMs = Math.max(0, points[index + 1].startTimeMs - safeBufferMs);
    const gapStartMs = state.endTimeMs + safeBufferMs;
    if (
      gapStartMs < nextPointLeadInMs &&
      currentTimeMs >= gapStartMs &&
      currentTimeMs < nextPointLeadInMs
    ) return nextPointLeadInMs;
  }

  return null;
}

/** Calculate the score immediately after each recorded point. */
export function calculatePointResults(data: TrackingGameData): PointResultSummary[] {
  let ourScore = data.game.initialOurScore;
  let opponentScore = data.game.initialOpponentScore;
  const pointByTerminalEventId = new Map<number, TrackingPoint>();
  for (const point of data.points) {
    const terminal = sortedEvents(point.events).find(
      (event) => event.type === 'goal' || event.type === 'conceded',
    );
    if (terminal) pointByTerminalEventId.set(terminal.id, point);
  }

  const resultByPointId = new Map<number, PointResultSummary>();
  for (const event of sortedEvents([
    ...data.standaloneEvents,
    ...data.points.flatMap((point) => point.events),
  ])) {
    if (event.type === 'score_set') {
      const payload = event.payload as ScoreSetPayload;
      ourScore = payload.ourScore;
      opponentScore = payload.opponentScore;
      continue;
    }
    const point = pointByTerminalEventId.get(event.id);
    if (!point) continue;
    const won = event.type === 'goal';
    if (won) ourScore += 1;
    else opponentScore += 1;
    resultByPointId.set(point.id, {
      pointId: point.id,
      sequenceNumber: point.sequenceNumber,
      ourScore,
      opponentScore,
      result: won ? 'won' : 'lost',
      breakAgainst: !won && point.startingPossession === 'offense',
    });
  }

  return [...data.points]
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber || left.id - right.id)
    .map((point) => resultByPointId.get(point.id) ?? {
      pointId: point.id,
      sequenceNumber: point.sequenceNumber,
      ourScore,
      opponentScore,
      result: 'open',
      breakAgainst: false,
    });
}

/** Calculate the score after applying only scoring events reached in the video. */
export function calculateScoreAtTime(data: TrackingGameData, timeMs: number): GameScore {
  let ourScore = data.game.initialOurScore;
  let opponentScore = data.game.initialOpponentScore;
  const cutoffTimeMs = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  const terminalEventIds = new Set(
    data.points
      .map((point) => sortedEvents(point.events).find(
        (event) => event.type === 'goal' || event.type === 'conceded',
      )?.id)
      .filter((id): id is number => id !== undefined),
  );

  for (const event of sortedEvents([
    ...data.standaloneEvents,
    ...data.points.flatMap((point) => point.events),
  ])) {
    if (event.timeMs > cutoffTimeMs) break;
    if (event.type === 'score_set') {
      const payload = event.payload as ScoreSetPayload;
      ourScore = payload.ourScore;
      opponentScore = payload.opponentScore;
    } else if (terminalEventIds.has(event.id) && event.type === 'goal') {
      ourScore += 1;
    } else if (terminalEventIds.has(event.id) && event.type === 'conceded') {
      opponentScore += 1;
    }
  }

  return { ourScore, opponentScore };
}

/** Return the latest recorded position in a point, including a closed stoppage's end. */
export function latestPointTimeMs(point: TrackingPoint): number {
  let latestTimeMs = point.startTimeMs;
  for (const event of point.events) {
    latestTimeMs = Math.max(latestTimeMs, event.timeMs);
    if (event.type === 'stoppage') {
      const endTimeMs = (event.payload as StoppagePayload).endTimeMs;
      if (endTimeMs !== null) latestTimeMs = Math.max(latestTimeMs, endTimeMs);
    }
  }
  return latestTimeMs;
}

/** Calculate the scoreboard and every supported player and line statistic. */
export function calculateGameStatistics(data: TrackingGameData): CalculatedGameStatistics {
  const players = new Map(
    data.players.map((player) => [player.id, emptyPlayerStatistics(player)]),
  );
  const lines = new Map(data.lines.map((line) => [line.id, emptyLineStatistics(line)]));
  const playerRoles = new Map(data.players.map((player) => [player.id, player.matchupRole]));
  const matchupStatistics = emptyMatchupStatistics();
  const warnings: string[] = [];
  const pointCalculations = data.points.map((point) =>
    calculatePoint(point, warnings, playerRoles, data.game.expectedPlayerCount),
  );
  const terminalEventIds = new Set(
    pointCalculations
      .map((calculation) => calculation.terminalEvent?.id)
      .filter((id): id is number => id !== undefined),
  );

  let ourScore = data.game.initialOurScore;
  let opponentScore = data.game.initialOpponentScore;
  const allEvents = sortedEvents([
    ...data.standaloneEvents,
    ...data.points.flatMap((point) => point.events),
  ]);
  for (const event of allEvents) {
    if (event.type === 'score_set') {
      const payload = event.payload as ScoreSetPayload;
      ourScore = payload.ourScore;
      opponentScore = payload.opponentScore;
    } else if (terminalEventIds.has(event.id) && event.type === 'goal') {
      ourScore += 1;
    } else if (terminalEventIds.has(event.id) && event.type === 'conceded') {
      opponentScore += 1;
    }
  }

  for (const calculation of pointCalculations) {
    calculatePointStatistics(calculation, players, lines, warnings);
    calculateMatchupStatistics(calculation, matchupStatistics);
  }

  if (data.manualPoints.length > 0) {
    for (const line of lines.values()) {
      line.pointsPlayed = 0;
      line.oPointsPlayed = 0;
      line.dPointsPlayed = 0;
      line.oPointsWon = 0;
      line.dPointsWon = 0;
      line.turnovers = 0;
      line.goalsFor = 0;
      line.goalsAgainst = 0;
      line.plusMinus = 0;
    }
    resetMatchupStatistics(matchupStatistics);
    let previousOurScore = data.game.initialOurScore;
    let previousOpponentScore = data.game.initialOpponentScore;
    for (const point of [...data.manualPoints].sort((left, right) => left.sequenceNumber - right.sequenceNumber)) {
      const scored = point.ourScore > previousOurScore;
      const line = lines.get(point.lineId);
      if (!line) {
        warnings.push(`Paper point ${point.sequenceNumber} references an unavailable line.`);
      } else {
        line.pointsPlayed += 1;
        line.turnovers += point.ourTurnovers;
        if (point.startingPossession === 'offense') line.oPointsPlayed += 1;
        else line.dPointsPlayed += 1;
        if (scored) {
          line.goalsFor += 1;
          line.plusMinus += 1;
          if (point.startingPossession === 'offense') line.oPointsWon += 1;
          else line.dPointsWon += 1;
        } else {
          line.goalsAgainst += 1;
          line.plusMinus -= 1;
        }
      }
      matchupStatistics.unclassifiedPoints += 1;
      previousOurScore = point.ourScore;
      previousOpponentScore = point.opponentScore;
    }
    ourScore = previousOurScore;
    opponentScore = previousOpponentScore;
  }

  if (data.manualPlayerStatistics.length > 0) {
    for (const paper of data.manualPlayerStatistics) {
      const stats = players.get(paper.playerId);
      if (!stats) {
        warnings.push(`Paper player totals reference an unavailable player.`);
        continue;
      }
      stats.pointsPlayed = paper.pointsPlayed;
      stats.hockeyAssists = paper.hockeyAssists;
      stats.assists = paper.assists;
      stats.goals = paper.goals;
      stats.blocks = paper.blocks;
    }
    const scorerGoals = new Map<number, number>();
    for (const point of data.manualPoints) {
      if (point.scorerPlayerId !== null) {
        scorerGoals.set(point.scorerPlayerId, (scorerGoals.get(point.scorerPlayerId) ?? 0) + 1);
      }
    }
    for (const paper of data.manualPlayerStatistics) {
      const detailedGoals = scorerGoals.get(paper.playerId) ?? 0;
      if (detailedGoals !== paper.goals) {
        const name = players.get(paper.playerId)?.playerName ?? 'Unknown player';
        warnings.push(`${name}'s paper total has ${paper.goals} goals, but the point summaries credit ${detailedGoals}.`);
      }
    }
  }

  return {
    ourScore,
    opponentScore,
    playerStatistics: [...players.values()].sort((left, right) =>
      left.playerName.localeCompare(right.playerName),
    ),
    lineStatistics: [...lines.values()],
    matchupStatistics,
    coverage: {
      gameCount: 1,
      playByPlayGames: data.points.length > 0 ? 1 : 0,
      paperPlayerGames: data.manualPlayerStatistics.length > 0 ? 1 : 0,
      paperPointGames: data.manualPoints.length > 0 ? 1 : 0,
    },
    warnings,
  };
}

/** Merge statistics from several games in the same tournament or season. */
export function mergeGameStatistics(
  calculatedGames: CalculatedGameStatistics[],
  players: Array<Pick<TrackingPlayer, 'id' | 'name'>>,
  lines: TrackingLine[],
): Pick<CalculatedGameStatistics, 'playerStatistics' | 'lineStatistics' | 'matchupStatistics' | 'coverage'> {
  const playerTotals = new Map(players.map((player) => [player.id, emptyPlayerStatistics(player)]));
  const lineTotals = new Map(lines.map((line) => [line.id, emptyLineStatistics(line)]));
  const matchupStatistics = emptyMatchupStatistics();
  const coverage: StatisticsCoverage = {
    gameCount: 0,
    playByPlayGames: 0,
    paperPlayerGames: 0,
    paperPointGames: 0,
  };

  for (const game of calculatedGames) {
    for (const stats of game.playerStatistics) {
      const total = playerTotals.get(stats.playerId);
      if (total) addNumericStatistics(total, stats, ['playerId', 'playerName']);
    }
    for (const stats of game.lineStatistics) {
      const total = lineTotals.get(stats.lineId);
      if (total) addNumericStatistics(total, stats, ['lineId', 'lineName']);
    }
    addNumericStatistics(matchupStatistics.mmp, game.matchupStatistics.mmp, ['matchup']);
    addNumericStatistics(matchupStatistics.fmp, game.matchupStatistics.fmp, ['matchup']);
    matchupStatistics.unclassifiedPoints += game.matchupStatistics.unclassifiedPoints;
    addNumericStatistics(coverage, game.coverage, []);
  }

  return {
    playerStatistics: [...playerTotals.values()].sort((left, right) =>
      left.playerName.localeCompare(right.playerName),
    ),
    lineStatistics: [...lineTotals.values()],
    matchupStatistics,
    coverage,
  };
}

function calculatePoint(
  point: TrackingPoint,
  warnings: string[],
  playerRoles: Map<number, MatchupRole | null>,
  expectedPlayerCount: number,
): PointCalculation {
  const events = sortedEvents(point.events);
  const active = new Map(point.startingPlayerIds.map((playerId) => [playerId, point.startTimeMs]));
  const participation: ParticipationInterval[] = [];
  let terminalEvent: TrackingEvent | null = null;
  let activeAtTerminal = new Set<number>();
  let possession = point.startingPossession;
  let handlerPlayerId: number | null = null;
  const matchup = classifyMatchupRoles(
    point.startingPlayerIds.map(
      (playerId) => point.matchupRoleOverrides[playerId] ?? playerRoles.get(playerId) ?? null,
    ),
  );

  if (expectedPlayerCount === 7 && matchup === null) {
    warnings.push(
      `Point ${point.sequenceNumber} cannot be classified as MMP or FMP from its pull lineup.`,
    );
  }

  if (point.startingPossession === 'defense' && point.pullerPlayerId === null) {
    warnings.push(`Point ${point.sequenceNumber} has an unknown puller.`);
  } else if (
    point.pullerPlayerId !== null &&
    !point.startingPlayerIds.includes(point.pullerPlayerId)
  ) {
    warnings.push(`Point ${point.sequenceNumber} attributes the pull to an inactive player.`);
  }

  for (const event of events) {
    if (event.timeMs < point.startTimeMs) {
      warnings.push(`Point ${point.sequenceNumber} has an event before its pull.`);
    }
    if (terminalEvent) {
      warnings.push(`Point ${point.sequenceNumber} has an event after it ended.`);
      continue;
    }
    if (gameEventIsIncomplete(event.type, event.payload)) {
      warnings.push(`Point ${point.sequenceNumber} has an incomplete ${event.type.replace('_', ' ')}.`);
    }
    const selectedPlayers = statisticsActorIds(event);
    if (selectedPlayers.some((playerId) => !active.has(playerId))) {
      warnings.push(`Point ${point.sequenceNumber} attributes an event to a player who was not active.`);
    }
    if (event.type === 'substitution') {
      const payload = event.payload as SubstitutionPayload;
      if (payload.outgoingPlayerId !== null) {
        const startTimeMs = active.get(payload.outgoingPlayerId);
        if (startTimeMs === undefined) {
          warnings.push(`Point ${point.sequenceNumber} substitutes a player who was not active.`);
        } else {
          participation.push({
            playerId: payload.outgoingPlayerId,
            startTimeMs,
            endTimeMs: Math.max(startTimeMs, event.timeMs),
          });
          active.delete(payload.outgoingPlayerId);
        }
      }
      if (payload.incomingPlayerId !== null) {
        if (active.has(payload.incomingPlayerId)) {
          warnings.push(`Point ${point.sequenceNumber} substitutes in an active player.`);
        } else {
          active.set(payload.incomingPlayerId, Math.max(point.startTimeMs, event.timeMs));
        }
      }
      if (handlerPlayerId === payload.outgoingPlayerId) handlerPlayerId = null;
    } else if (event.type === 'possession_start') {
      if (possession !== 'offense') warnings.push(`Point ${point.sequenceNumber} starts a tracked possession during opponent possession.`);
      const payload = event.payload as PossessionStartPayload;
      if (
        handlerPlayerId !== null &&
        payload.playerId !== null &&
        handlerPlayerId !== payload.playerId
      ) {
        warnings.push(`Point ${point.sequenceNumber} changes handlers without a completion or turnover.`);
      }
      possession = 'offense';
      handlerPlayerId = payload.playerId;
    } else if (event.type === 'completion') {
      if (possession !== 'offense') warnings.push(`Point ${point.sequenceNumber} records a completion during opponent possession.`);
      const payload = event.payload as CompletionPayload;
      if (
        handlerPlayerId !== null &&
        payload.throwerId !== null &&
        handlerPlayerId !== payload.throwerId
      ) {
        warnings.push(`Point ${point.sequenceNumber} has a completion by someone other than the current handler.`);
      }
      possession = 'offense';
      handlerPlayerId = payload.receiverId;
    } else if (event.type === 'turnover') {
      if (possession !== 'offense') warnings.push(`Point ${point.sequenceNumber} records a tracked-team turnover during opponent possession.`);
      const payload = event.payload as TurnoverPayload;
      if (
        handlerPlayerId !== null &&
        payload.throwerId !== null &&
        handlerPlayerId !== payload.throwerId
      ) {
        warnings.push(`Point ${point.sequenceNumber} has a turnover by someone other than the current handler.`);
      }
      possession = 'defense';
      handlerPlayerId = null;
    } else if (event.type === 'defended' || event.type === 'opponent_turnover') {
      if (possession !== 'defense') warnings.push(`Point ${point.sequenceNumber} records an opponent turnover during tracked-team possession.`);
      possession = 'offense';
      handlerPlayerId = null;
    } else if (event.type === 'goal' || event.type === 'conceded') {
      if (event.type === 'goal') {
        const payload = event.payload as GoalPayload;
        const callahan = payload.callahan;
        if ((callahan && possession !== 'defense') || (!callahan && possession !== 'offense')) {
          warnings.push(`Point ${point.sequenceNumber} records a goal during inconsistent possession.`);
        }
        if (
          !callahan &&
          handlerPlayerId !== null &&
          payload.throwerId !== null &&
          handlerPlayerId !== payload.throwerId
        ) {
          warnings.push(`Point ${point.sequenceNumber} has a goal thrown by someone other than the current handler.`);
        }
      } else if (possession !== 'defense') {
        warnings.push(`Point ${point.sequenceNumber} records a conceded goal during tracked-team possession.`);
      }
      terminalEvent = event;
      activeAtTerminal = new Set(active.keys());
      for (const [playerId, startTimeMs] of active) {
        participation.push({
          playerId,
          startTimeMs,
          endTimeMs: Math.max(startTimeMs, event.timeMs),
        });
      }
    }
  }

  return {
    point,
    state: calculatePointState(point),
    terminalEvent,
    participation,
    activeAtTerminal,
    matchup,
  };
}

function calculateMatchupStatistics(
  calculation: PointCalculation,
  statistics: MatchupStatistics,
): void {
  const terminalEvent = calculation.terminalEvent;
  if (!terminalEvent) return;
  if (!calculation.matchup) {
    statistics.unclassifiedPoints += 1;
    return;
  }
  const target = statistics[calculation.matchup];
  target.pointsPlayed += 1;
  if (calculation.point.startingPossession === 'offense') {
    target.oPointsPlayed += 1;
    if (terminalEvent.type === 'goal') target.oPointsWon += 1;
  } else {
    target.dPointsPlayed += 1;
    if (terminalEvent.type === 'goal') target.dPointsWon += 1;
  }
  if (terminalEvent.type === 'goal') target.pointsWon += 1;
}

function calculatePointStatistics(
  calculation: PointCalculation,
  players: Map<number, PlayerStatistics>,
  lines: Map<number, LineStatistics>,
  warnings: string[],
): void {
  const { point, terminalEvent, participation, activeAtTerminal } = calculation;
  const line = lines.get(point.lineId);
  if (!line) warnings.push(`Point ${point.sequenceNumber} references an unavailable line.`);
  const participants = new Set<number>();

  if (terminalEvent) {
    const pointDuration = Math.max(0, terminalEvent.timeMs - point.startTimeMs);
    if (line) {
      line.timePlayedMs += pointDuration;
      line.pointsPlayed += 1;
      if (point.startingPossession === 'offense') line.oPointsPlayed += 1;
      else line.dPointsPlayed += 1;
      if (terminalEvent.type === 'goal') {
        line.goalsFor += 1;
        line.plusMinus += 1;
        if (point.startingPossession === 'offense') line.oPointsWon += 1;
        else line.dPointsWon += 1;
      } else {
        line.goalsAgainst += 1;
        line.plusMinus -= 1;
      }
    }

    for (const interval of participation) {
      const duration = Math.max(0, interval.endTimeMs - interval.startTimeMs);
      if (duration <= 0) continue;
      const stats = players.get(interval.playerId);
      if (!stats) continue;
      stats.timePlayedMs += duration;
      participants.add(interval.playerId);
    }
    for (const playerId of participants) {
      const stats = players.get(playerId);
      if (!stats) continue;
      stats.pointsPlayed += 1;
      if (point.startingPossession === 'offense') {
        stats.oPointsPlayed += 1;
        if (terminalEvent.type === 'goal') stats.oPointsWon += 1;
      } else {
        stats.dPointsPlayed += 1;
        if (terminalEvent.type === 'goal') stats.dPointsWon += 1;
      }
    }
    const plusMinus = terminalEvent.type === 'goal' ? 1 : -1;
    for (const playerId of activeAtTerminal) {
      const stats = players.get(playerId);
      if (stats) stats.plusMinus += plusMinus;
    }
  }

  if (point.pullerPlayerId !== null) {
    const puller = players.get(point.pullerPlayerId);
    if (puller) puller.pulls += 1;
  }

  const orderedEvents = sortedEvents(point.events);
  const terminalIndex = terminalEvent
    ? orderedEvents.findIndex((event) => event.id === terminalEvent.id)
    : -1;
  const events = terminalIndex >= 0 ? orderedEvents.slice(0, terminalIndex + 1) : orderedEvents;
  const stoppages = events
    .filter((event) => event.type === 'stoppage')
    .map((event) => {
      const end = (event.payload as StoppagePayload).endTimeMs;
      return { start: event.timeMs, end: end ?? terminalEvent?.timeMs ?? event.timeMs };
    });
  let handlerId: number | null = null;
  let handlerStartMs = 0;
  let previousCompletion: { payload: CompletionPayload; timeMs: number } | null = null;

  const closeHandler = (endTimeMs: number): void => {
    if (handlerId === null) return;
    const stats = players.get(handlerId);
    if (stats) {
      stats.timeWithDiscMs += liveDuration(handlerStartMs, endTimeMs, stoppages);
    }
    handlerId = null;
  };

  for (const event of events) {
    switch (event.type) {
      case 'possession_start': {
        const playerId = (event.payload as PossessionStartPayload).playerId;
        closeHandler(event.timeMs);
        handlerId = playerId;
        handlerStartMs = event.timeMs;
        break;
      }
      case 'completion': {
        const payload = event.payload as CompletionPayload;
        closeHandler(event.timeMs);
        if (payload.throwerId !== null) increment(players, payload.throwerId, 'completions');
        if (payload.receiverId !== null) increment(players, payload.receiverId, 'receptions');
        if (line) line.completions += 1;
        handlerId = payload.receiverId;
        handlerStartMs = event.timeMs;
        previousCompletion = { payload, timeMs: event.timeMs };
        break;
      }
      case 'turnover': {
        const payload = event.payload as TurnoverPayload;
        closeHandler(event.timeMs);
        const chargedPlayerId = payload.reason === 'drop'
          ? payload.intendedReceiverId
          : payload.throwerId;
        if (chargedPlayerId !== null) increment(players, chargedPlayerId, 'turnovers');
        if (line) line.turnovers += 1;
        previousCompletion = null;
        break;
      }
      case 'defended': {
        closeHandler(event.timeMs);
        const defenderId = (event.payload as DefendedPayload).defenderId;
        if (defenderId !== null) increment(players, defenderId, 'blocks');
        if (line) line.blocks += 1;
        previousCompletion = null;
        break;
      }
      case 'opponent_turnover':
        closeHandler(event.timeMs);
        previousCompletion = null;
        break;
      case 'goal': {
        const payload = event.payload as GoalPayload;
        closeHandler(event.timeMs);
        if (payload.receiverId !== null) {
          increment(players, payload.receiverId, 'goals');
          if (payload.callahan) increment(players, payload.receiverId, 'blocks');
        }
        if (!payload.callahan) {
          if (payload.throwerId !== null) {
            increment(players, payload.throwerId, 'assists');
            increment(players, payload.throwerId, 'completions');
          }
          if (payload.receiverId !== null) increment(players, payload.receiverId, 'receptions');
          if (line) line.completions += 1;
          if (
            previousCompletion?.payload.throwerId !== null &&
            previousCompletion?.payload.receiverId === payload.throwerId
          ) {
            increment(
              players,
              previousCompletion.payload.throwerId,
              'hockeyAssists',
            );
          }
        } else if (line) {
          line.blocks += 1;
        }
        previousCompletion = null;
        break;
      }
      case 'conceded':
        closeHandler(event.timeMs);
        previousCompletion = null;
        break;
      case 'substitution': {
        const outgoing = (event.payload as SubstitutionPayload).outgoingPlayerId;
        if (outgoing !== null && handlerId === outgoing) closeHandler(event.timeMs);
        break;
      }
      case 'stoppage':
      case 'score_set':
      case 'strategy_set':
        break;
    }
  }
}

function liveDuration(
  startTimeMs: number,
  endTimeMs: number,
  stoppages: Array<{ start: number; end: number }>,
): number {
  const duration = Math.max(0, endTimeMs - startTimeMs);
  const overlaps = stoppages
    .map((stoppage) => ({
      start: Math.max(startTimeMs, stoppage.start),
      end: Math.min(endTimeMs, stoppage.end),
    }))
    .filter((stoppage) => stoppage.end > stoppage.start)
    .sort((left, right) => left.start - right.start);
  let stopped = 0;
  let mergedStart = -1;
  let mergedEnd = -1;
  for (const overlap of overlaps) {
    if (mergedStart < 0) {
      mergedStart = overlap.start;
      mergedEnd = overlap.end;
    } else if (overlap.start <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, overlap.end);
    } else {
      stopped += mergedEnd - mergedStart;
      mergedStart = overlap.start;
      mergedEnd = overlap.end;
    }
  }
  if (mergedStart >= 0) stopped += mergedEnd - mergedStart;
  return Math.max(0, duration - stopped);
}

function statisticsActorIds(event: TrackingEvent): number[] {
  switch (event.type) {
    case 'possession_start':
      return compactIds([(event.payload as PossessionStartPayload).playerId]);
    case 'completion': {
      const payload = event.payload as CompletionPayload;
      return compactIds([payload.throwerId, payload.receiverId]);
    }
    case 'turnover': {
      const payload = event.payload as TurnoverPayload;
      return compactIds([payload.throwerId, payload.intendedReceiverId]);
    }
    case 'defended':
      return compactIds([(event.payload as DefendedPayload).defenderId]);
    case 'goal': {
      const payload = event.payload as GoalPayload;
      return compactIds([payload.throwerId, payload.receiverId]);
    }
    case 'substitution':
      return compactIds([(event.payload as SubstitutionPayload).outgoingPlayerId]);
    case 'opponent_turnover':
    case 'conceded':
    case 'stoppage':
    case 'score_set':
    case 'strategy_set':
      return [];
  }
}

function compactIds(ids: Array<number | null>): number[] {
  return ids.filter((id): id is number => id !== null);
}

function emptyPlayerStatistics(player: Pick<TrackingPlayer, 'id' | 'name'>): PlayerStatistics {
  return {
    playerId: player.id,
    playerName: player.name,
    timePlayedMs: 0,
    pointsPlayed: 0,
    oPointsPlayed: 0,
    dPointsPlayed: 0,
    oPointsWon: 0,
    dPointsWon: 0,
    completions: 0,
    receptions: 0,
    turnovers: 0,
    goals: 0,
    assists: 0,
    hockeyAssists: 0,
    blocks: 0,
    pulls: 0,
    plusMinus: 0,
    timeWithDiscMs: 0,
  };
}

function emptyLineStatistics(line: TrackingLine): LineStatistics {
  return {
    lineId: line.id,
    lineName: line.name,
    timePlayedMs: 0,
    pointsPlayed: 0,
    oPointsPlayed: 0,
    dPointsPlayed: 0,
    oPointsWon: 0,
    dPointsWon: 0,
    completions: 0,
    turnovers: 0,
    blocks: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    plusMinus: 0,
  };
}

function emptyMatchupStatistics(): MatchupStatistics {
  const empty = (matchup: MatchupRole): MatchupPointStatistics => ({
    matchup,
    pointsPlayed: 0,
    pointsWon: 0,
    oPointsPlayed: 0,
    oPointsWon: 0,
    dPointsPlayed: 0,
    dPointsWon: 0,
  });
  return { mmp: empty('mmp'), fmp: empty('fmp'), unclassifiedPoints: 0 };
}

function resetMatchupStatistics(statistics: MatchupStatistics): void {
  for (const target of [statistics.mmp, statistics.fmp]) {
    target.pointsPlayed = 0;
    target.pointsWon = 0;
    target.oPointsPlayed = 0;
    target.oPointsWon = 0;
    target.dPointsPlayed = 0;
    target.dPointsWon = 0;
  }
  statistics.unclassifiedPoints = 0;
}

function increment(
  players: Map<number, PlayerStatistics>,
  playerId: number,
  field: keyof PlayerStatistics,
): void {
  const stats = players.get(playerId);
  if (stats && typeof stats[field] === 'number') {
    (stats[field] as number) += 1;
  }
}

function sortedEvents(events: TrackingEvent[]): TrackingEvent[] {
  return [...events].sort((left, right) => left.timeMs - right.timeMs || left.id - right.id);
}

function addNumericStatistics<T extends object>(
  target: T,
  source: T,
  excluded: Array<keyof T>,
): void {
  const excludedFields = new Set<keyof T>(excluded);
  for (const key of Object.keys(source) as Array<keyof T>) {
    if (
      !excludedFields.has(key) &&
      typeof target[key] === 'number' &&
      typeof source[key] === 'number'
    ) {
      (target[key] as number) += source[key] as number;
    }
  }
}
