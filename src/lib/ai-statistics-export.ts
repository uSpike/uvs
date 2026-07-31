import {
  calculateGameStatistics,
  calculatePointResults,
  calculatePointState,
  mergeGameStatistics,
  type CalculatedGameStatistics,
  type GameEventPayload,
  type GameEventType,
  type ManualPointSummary,
  type TrackingEvent,
  type TrackingGameData,
  type TrackingLine,
  type TrackingPoint,
} from './game-stats';
import type { MatchupRole } from './matchup';
import { STAT_DESCRIPTIONS } from './stat-descriptions';

/** Stable identifier for self-describing, read-only statistics exports. */
export const AI_STATISTICS_EXPORT_FORMAT = 'uvs-ai-statistics';

/** Current schema version for self-describing statistics exports. */
export const AI_STATISTICS_EXPORT_VERSION = 1;

/** Team metadata accepted when building an analysis export. */
export interface AiStatisticsTeamInput {
  id: number;
  name: string;
  slug?: string;
}

/** Season metadata accepted when building an analysis export. */
export interface AiStatisticsSeasonInput {
  id: number;
  name: string;
}

/** Event metadata accepted when building an analysis export. */
export interface AiStatisticsTournamentInput {
  id: number;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  seasonRosterId?: number;
  lines?: Array<{ id: number; name: string }>;
}

/** Game metadata used only to identify a game-scoped export. */
export interface AiStatisticsGameScopeInput {
  id: number;
  title: string;
  opponentName: string;
  playedAt: string | null;
  token?: string;
}

/** Exact collection represented by one analysis export. */
export interface AiStatisticsScopeInput {
  type: 'game' | 'tournament' | 'season';
  team: AiStatisticsTeamInput;
  season: AiStatisticsSeasonInput | null;
  tournament?: AiStatisticsTournamentInput | null;
  game?: AiStatisticsGameScopeInput | null;
}

/** Player metadata accepted from either a game roster or a season roster. */
export interface AiStatisticsPlayerInput {
  id: number;
  name: string;
  defaultMatchupRole?: MatchupRole | null;
  matchupRole?: MatchupRole | null;
}

/** Line metadata accepted from either game tracking or event configuration. */
export interface AiStatisticsLineInput {
  id: number;
  name: string;
  tournamentId?: number;
  suggestedPlayerIds?: number[];
}

/** Non-secret game metadata used to explain inclusion and exclusion decisions. */
export interface AiStatisticsAvailableGameInput {
  id: number;
  title: string;
  tournamentId: number;
  tournamentName: string;
  opponentName: string;
  playedAt: string | null;
}

/** Complete input used to create one self-describing statistics file. */
export interface AiStatisticsExportInput {
  scope: AiStatisticsScopeInput;
  games: TrackingGameData[];
  players: AiStatisticsPlayerInput[];
  lines: AiStatisticsLineInput[];
  tournaments: AiStatisticsTournamentInput[];
  availableGameIds?: number[];
  availableGames?: AiStatisticsAvailableGameInput[];
}

interface PlayerReference {
  id: number;
  name: string;
  defaultMatchupRole: MatchupRole | null;
}

interface LineReference {
  id: number;
  tournamentId: number | null;
  name: string;
}

interface TournamentReference {
  id: number;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
}

interface StrategyReference {
  id: number;
  name: string;
  kind: 'offense' | 'defense';
  isDefault: boolean;
}

interface ResolvedPlayer {
  playerId: number;
  playerName: string | null;
}

interface ResolvedLine {
  lineId: number;
  lineName: string | null;
}

interface ResolvedStrategy {
  strategyId: number;
  strategyName: string | null;
  kind: 'offense' | 'defense' | null;
}

const SEMANTICS = {
  intendedUse: [
    'This is a read-only analysis file, not a database backup and not an import format.',
    'Use derivedStatistics as the reducer output for the captured data, not as proof that recording is complete. Use chronological rawSources to find sequences, combinations, and tactical patterns without adding those records to derived totals again.',
    'Player names are included intentionally so player-level patterns can be analyzed.',
  ],
  sportContext: {
    sport: 'Ultimate (flying disc)',
    overview:
      'Ultimate is a possession sport. A point begins when the pull is released and ends when either team scores. Possession alternates after a turnover.',
    perspective:
      '"tracked team", "our", and "we" mean the team named in scope.team. "opponent" means that game’s opponent.',
    pointStarts:
      'An O-start means the tracked team began the point receiving the pull on offense. A D-start means the tracked team began by pulling on defense.',
    oDSplits:
      'Every player statistic prefixed o or d is classified by how the point started, not by possession at the instant of the action.',
    matchupRoles:
      'MMP and FMP are recorded mixed-ultimate preferred matchup-role labels. Do not infer identity or gender beyond the recorded role.',
  },
  calculationRules: [
    'A completed play-by-play point requires a first terminal goal or conceded event. Later events are ignored by calculated point totals and produce a warning.',
    'Actions and pulls in an open point can still contribute to action, connection, pull, and player event totals even though that point contributes no completed-point or playing-time totals.',
    'A hold is an O-start point won by the tracked team. A break is a D-start point won by the tracked team. A break against is an O-start point lost.',
    'A clean hold is an O-start win with no tracked-team turnover.',
    'A player receives pointsPlayed credit for a completed point only with positive-duration participation. Participation and time respect substitutions. timePlayedMs includes recorded stoppage time; timeWithDiscMs excludes recorded stoppages.',
    'Player plusMinus and O/D efficiency score the players active when a point ends. Line statistics are calculated independently and must not be reconstructed by summing player rows.',
    'A drop turnover is charged to the known intended receiver. Other turnover reasons are charged to the known thrower as passerTurnovers; throwaway and stall also increment their named subtype.',
    'On a normal goal, the receiver gets a goal and the thrower gets an assist plus a completion/attempt. A hockey assist goes to the thrower of the immediately preceding completion only when its receiver next throws the goal without an intervening possession loss.',
    'A tracked-team Callahan gives the scorer both a goal and a block, has no assist or throw, and contributes +2 extendedPlusMinus. Being Callahaned contributes −1 extendedPlusMinus to each active tracked-team player.',
    'The score starts at initialScore. Terminal scoring events increment it, while score_set may synchronize it after an unrecorded video gap. The latest recorded score therefore need not equal the number of exported point-ending events.',
    'Connection attempts require both a known thrower and receiver or intended receiver. Goals are a subset of successful connection completions.',
    'Every credited or uncredited opponent turnover adds a defensive conversion opportunity. Several can occur before one tracked-team goal, but at most the currently pending opportunity converts; a tracked-team turnover clears it. A Callahan is always one conversion and also creates an opportunity when none was pending.',
  ],
  paperDataPolicy: [
    'Play-by-play events, paper player totals, and paper point summaries are separate raw sources and must never be added together.',
    'When paper point summaries exist, they replace calculated team and line point/outcome/turnover fields for that game and make matchup points unclassified.',
    'Paper player totals overwrite only pointsPlayed, hockeyAssists, assists, goals, blocks, and extendedPlusMinus. extendedPlusMinus is replaced with goals + assists + blocks; all negative components are omitted even if play-by-play turnovers remain in other fields. Other player fields may remain unavailable or partial.',
    'A calculated game containing paper data is therefore a field-level hybrid. Consult each game’s sources, coverage, and warnings before interpreting any zero.',
    'Paper goal thrower/receiver fields validate paper assists/goals; they are not added a second time to derived player totals.',
  ],
  analysisGuardrails: [
    'Treat null as unknown, unrecorded, or not applicable according to the field definition.',
    'A numeric zero can be a true observed zero or an unavailable field in paper-only/partial data. Check sources and coverage first.',
    'Recompute rates from the supplied numerator and denominator. A zero denominator means the rate is null/not estimable. Do not average percentages.',
    'Compare O-start and D-start performance separately and report games, points, or attempts as sample sizes.',
    'Surface data warnings and small-sample limitations with every finding.',
    'Describe correlations as associations, not causes; opponents, lineups, game state, and recording coverage can confound patterns.',
  ],
  dataDictionary: {
    conventions: {
      idFields:
        'Integer IDs are stable references only within the source database. Join them to the matching object in references.',
      timeFields:
        'Every field ending in Ms is milliseconds. Point/event timeMs values are positions relative to that game’s video, not wall-clock timestamps.',
      dateTimeFields:
        'playedAt is an ISO date-time when known. startsOn and endsOn are ISO calendar dates when known.',
      null:
        'null means unknown, unrecorded, unavailable, or not applicable; use the containing field’s definition.',
      counts:
        'Unless explicitly described as a net value, calculated numeric statistics are non-negative counts.',
      rates:
        'The export stores count numerators and denominators instead of percentages. For proportions such as completion/hold/break percentage, calculate a ratio in [0,1], or null when the denominator is zero. Per-game, per-point, and per-10-point rates can exceed 1.',
      gameSelection:
        'aggregate and games contain only scope.includedGameIds. scope.excludedGames were available in the requested event/season but deliberately omitted; use their title/opponent/date summaries to consider selection bias.',
    },
    sourceFlags: {
      timedPointPlayByPlay:
        'At least one video-timed point exists. This does not guarantee every point or actor was recorded.',
      standaloneTimelineEvents:
        'At least one time-aligned event exists outside a point, such as score synchronization after an unrecorded gap.',
      paperPlayerTotals:
        'At least one whole-game player total was entered from a paper score sheet.',
      paperPointSummaries:
        'At least one point-level score/line summary was entered from a paper score sheet.',
    },
    coverage: {
      gameCount: 'Number of games included in these statistics.',
      playByPlayGames:
        'Included games containing at least one timed tracked point; completeness can still vary.',
      paperPlayerGames: 'Included games containing paper player totals.',
      paperPointGames: 'Included games containing paper point summaries.',
      categories:
        'Coverage categories are nonexclusive: one game may contribute to playByPlayGames, paperPlayerGames, and paperPointGames.',
    },
    recordedScoreSummary: {
      gamesCompared: 'Number of included games whose latest recorded scores were compared.',
      trackedTeamAhead:
        'Games where the tracked team’s latest recorded score is greater; this does not certify a completed win.',
      opponentAhead:
        'Games where the opponent’s latest recorded score is greater; this does not certify a completed loss.',
      level:
        'Games with equal latest recorded scores. An empty 0–0 game can mean missing recording rather than a completed tie.',
      trackedTeamScoreTotal:
        'Sum of latest recorded tracked-team scores, including any nonzero initial score.',
      opponentScoreTotal:
        'Sum of latest recorded opponent scores, including any nonzero initial score.',
      recordedScoreDifferential: 'trackedTeamScoreTotal minus opponentScoreTotal.',
      completionKnown:
        'Always false in schema version 1 because the database does not persist a game-completed flag.',
    },
    dataQualityStatuses: {
      review_warnings: 'Calculation warnings exist and must be reviewed with any finding.',
      hybrid_sources:
        'Both timed play-by-play and paper data contribute; calculated fields use the documented field-level precedence rules.',
      mixed_source_coverage:
        'Games in this aggregate use different or hybrid source types; compare only fields supported by each source.',
      limited_to_paper_fields: 'Only field-limited paper sources are present.',
      recorded_without_calculation_warnings:
        'Play-by-play exists and the reducer found no warning; completeness is still not guaranteed.',
      no_statistical_source: 'No play-by-play points or paper statistics are present.',
      standalone_timeline_only:
        'Standalone timeline events exist, but no point play-by-play or paper statistics are present.',
      no_calculation_warnings:
        'Aggregate contains no reducer warnings; this is not a completeness guarantee.',
    },
    sourceProfiles: {
      timed_point_only: 'Timed point play-by-play exists and no paper source exists.',
      paper_only: 'One or both paper sources exist and no timed point play-by-play exists.',
      hybrid: 'Timed point play-by-play and at least one paper source both exist.',
      standalone_timeline_only:
        'Only events outside points exist; these may synchronize score but provide no point statistics.',
      none: 'No timed points, standalone events, or paper statistics exist.',
    },
    pointFields: {
      sequenceNumber: 'One-based chronological point number within the recorded source.',
      startCode: '"O" when the tracked team starts on offense; "D" when it starts on defense.',
      startingPossession: STAT_DESCRIPTIONS.pointStart,
      startTimeMs: 'Video-relative time when the pull was released.',
      endTimeMs: 'Video-relative time of the first terminal goal/conceded event, or null.',
      durationMs: 'endTimeMs minus startTimeMs for a completed point, otherwise null.',
      line: 'Named event-specific line assigned at the pull. This is not inferred from players.',
      startingPlayers: 'Players active when the pull was released.',
      puller: 'Tracked-team player credited with the pull on a D-start, when known.',
      result: '"won", "lost", or "open" from the tracked-team perspective.',
      breakAgainst: 'True when the tracked team lost a point that began as an O-start.',
      scoreAfterPoint:
        'Cumulative tracked-team and opponent scores after a completed point; null for an open point.',
      strategy:
        'Configured offensive or defensive tactical system. null means unknown or not recorded.',
    },
    eventTypes: {
      possession_start:
        'Tracked team gains or resumes live possession; playerId is the handler when known.',
      completion: 'Tracked-team pass completed from throwerId to receiverId.',
      turnover:
        'Tracked team loses possession. drop is charged to the intended receiver; other reasons are charged to the thrower when known.',
      defended: 'Tracked player receives credit for causing an opponent turnover (a defensive block).',
      opponent_turnover:
        'Opponent loses possession without a tracked player receiving block credit.',
      goal:
        'Tracked team scores. A normal goal has thrower/receiver; a Callahan is an immediate defensive score with no thrower.',
      conceded: 'Opponent scores. callahan=true means the tracked team was Callahaned.',
      substitution: 'Active outgoing player is replaced by the incoming player during the point.',
      stoppage: 'Dead-disc interval such as a foul, injury, timeout, or other stoppage.',
      score_set: 'Manual scoreboard synchronization after an unrecorded gap.',
      strategy_set: 'Tracked team changes its configured offensive or defensive system.',
    },
    eventFields: {
      includedInDerivedStatistics:
        'False only for a point event after its first terminal goal/conceded event; those events remain visible for auditing but the reducer ignores them.',
      actors:
        'Resolved player references involved in this event. For a turnover, chargedPlayer follows the reducer’s drop-versus-passer attribution rule.',
      strategy: 'Resolved configured strategy for strategy_set; otherwise null.',
    },
    eventPayloadFields: {
      playerId: 'Referenced player with possession; null means unknown.',
      throwerId: 'Referenced throwing player; null means unknown or not applicable.',
      receiverId: 'Referenced receiving/scoring player; null means unknown.',
      intendedReceiverId: 'Referenced intended receiver on a turnover; null means unknown.',
      defenderId: 'Referenced player credited with a defensive block; null means unknown.',
      reason:
        'Turnover classification: drop, block, throwaway, stall, penalty, or unknown; opponent turnovers support a smaller subset.',
      callahan:
        'True when a defender intercepts an opponent pass in the end zone the defender’s team is attacking (the opponent’s defended end zone), producing an immediate goal.',
      outgoingPlayerId: 'Referenced player leaving the point; null means unknown.',
      incomingPlayerId: 'Referenced player entering the point; null means unknown.',
      kind: 'For stoppage: foul/injury/timeout/other. For strategy: offense/defense.',
      endTimeMs: 'Video-relative end of a stoppage; null means the stoppage was not closed.',
      ourScore: 'Tracked-team cumulative score at a score synchronization.',
      opponentScore: 'Opponent cumulative score at a score synchronization.',
      strategyId: 'Referenced configured tactic.',
    },
    paperPointFields: {
      initialDefenseType: 'Free-text defense noted on the paper sheet, or null.',
      ourTurnovers: 'Number of tracked-team turnovers recorded for this point.',
      scoringMethod: 'Free-text description of how the point was scored, or null.',
      thrower: 'Player credited with the scoring pass, or null when unknown/not applicable.',
      receiver: 'Player credited with catching the goal, or null when unknown.',
      scoreAfterPoint: 'Cumulative score manually entered after this point.',
    },
    calculatedStatistics: {
      game: {
        ourScore:
          'Tracked team’s latest recorded score after initial score, terminal events, score_set events, and any paper point summaries. It is not proof the game completed.',
        opponentScore:
          'Opponent’s latest recorded score under the same rules. It is not proof the game completed.',
        warnings: 'Reducer-detected inconsistencies or missing attribution for this game.',
      },
      team: {
        pointsPlayed: STAT_DESCRIPTIONS.pointsPlayed,
        oPointsPlayed: STAT_DESCRIPTIONS.offensePointsPlayed,
        dPointsPlayed: STAT_DESCRIPTIONS.defensePointsPlayed,
        oPointsWon: 'O-start points won by the tracked team (holds).',
        dPointsWon: 'D-start points won by the tracked team (breaks).',
        cleanHolds: STAT_DESCRIPTIONS.cleanHolds,
        defensiveConversionOpportunities:
          'Opponent turnovers that created a chance to score before the tracked team’s next turnover.',
        defensiveConversions: STAT_DESCRIPTIONS.defensiveConversion,
      },
      player: {
        playerId: 'Join to references.players.id.',
        playerName: 'Convenience copy of the referenced player name.',
        gamesPlayed: STAT_DESCRIPTIONS.gamesPlayed,
        timePlayedMs: STAT_DESCRIPTIONS.timePlayed,
        pointsPlayed: STAT_DESCRIPTIONS.pointsPlayed,
        oPointsPlayed: STAT_DESCRIPTIONS.offensePointsPlayed,
        dPointsPlayed: STAT_DESCRIPTIONS.defensePointsPlayed,
        oPointsWon: 'O-start points won while this player participated.',
        dPointsWon: 'D-start points won while this player participated.',
        completions: STAT_DESCRIPTIONS.completions,
        throwingAttempts: 'Completed throws plus turnovers with a known thrower.',
        receptions: STAT_DESCRIPTIONS.receptions,
        receivingTargets: 'Known completed or failed targets to this player.',
        drops: STAT_DESCRIPTIONS.drops,
        passerTurnovers: STAT_DESCRIPTIONS.passerTurnovers,
        throwaways: STAT_DESCRIPTIONS.throwaways,
        stalls: STAT_DESCRIPTIONS.stalls,
        touches: STAT_DESCRIPTIONS.touches,
        turnovers:
          'Tracked-team turnovers charged to this player: drops to the intended receiver; all other recorded reasons to the thrower.',
        goals: STAT_DESCRIPTIONS.goals,
        assists: 'Scoring passes thrown by this player on non-Callahan goals.',
        hockeyAssists:
          'Completed passes thrown by this player immediately before the receiver throws the goal, without an intervening possession loss.',
        blocks: STAT_DESCRIPTIONS.blocks,
        pulls: STAT_DESCRIPTIONS.pulls,
        plusMinus: STAT_DESCRIPTIONS.plusMinus,
        extendedPlusMinus:
          'Play-by-play: goals, assists, and credited blocks are +1; charged drops/passer turnovers are −1; a Callahan scorer gets +2 and active players being Callahaned get −1. With paper player totals, this field is replaced by goals + assists + blocks and omits all negative components.',
        oEfficiency:
          'Integer net result while active at the score on O-start points: +1 for a hold, −1 for a break against. Not a percentage.',
        dEfficiency:
          'Integer net result while active at the score on D-start points: +1 for a break, −1 for an opponent hold. Not a percentage.',
        timeWithDiscMs: STAT_DESCRIPTIONS.discTime,
        oPrefix:
          'Fields oCompletions through oBlocks count actions during points that started on offense.',
        dPrefix:
          'Fields dCompletions through dBlocks count actions during points that started on defense.',
      },
      line: {
        lineId: 'Join to references.lines.id.',
        lineName: 'Convenience copy of the referenced line name.',
        timePlayedMs: 'Sum of pull-to-terminal duration for completed points assigned to this line.',
        pointsPlayed: STAT_DESCRIPTIONS.pointsPlayed,
        oPointsPlayed: STAT_DESCRIPTIONS.offensePointsPlayed,
        dPointsPlayed: STAT_DESCRIPTIONS.defensePointsPlayed,
        oPointsWon: 'O-start wins assigned to this line.',
        dPointsWon: 'D-start wins assigned to this line.',
        cleanHolds: STAT_DESCRIPTIONS.cleanHolds,
        defensiveConversionOpportunities:
          'Opponent turnovers during this line’s points that created a conversion chance.',
        defensiveConversions: STAT_DESCRIPTIONS.defensiveConversion,
        completions: STAT_DESCRIPTIONS.completions,
        turnovers: STAT_DESCRIPTIONS.turnovers,
        blocks: STAT_DESCRIPTIONS.blocks,
        goalsFor: STAT_DESCRIPTIONS.goalsFor,
        goalsAgainst: STAT_DESCRIPTIONS.goalsAgainst,
        plusMinus: 'goalsFor minus goalsAgainst for this line.',
      },
      connection: {
        throwerPlayerId: 'Known thrower; join to references.players.id.',
        receiverPlayerId: 'Known receiver/intended receiver; join to references.players.id.',
        attempts: STAT_DESCRIPTIONS.connectionAttempts,
        completions: 'Successful connection attempts, including normal scoring passes.',
        goals: 'Successful connection attempts that directly scored.',
        turnovers: 'Failed connection attempts that caused a tracked-team turnover.',
      },
      matchup: {
        classification:
          'Exactly seven known pull-lineup roles with four MMP roles classify as MMP; three MMP roles classify as FMP; all other points are unclassified.',
        pointsPlayed: 'Completed points with this pull-lineup matchup classification.',
        pointsWon: 'Those points won by the tracked team.',
        oPointsPlayed: 'Classified points that began on offense.',
        oPointsWon: 'Classified O-start points won.',
        dPointsPlayed: 'Classified points that began on defense.',
        dPointsWon: 'Classified D-start points won.',
        unclassifiedPoints: 'Completed points without a valid MMP/FMP classification.',
      },
    },
  },
} as const;

/**
 * Create a versioned JSON value that carries both statistics and enough semantics
 * for an AI without prior Ultimate Video Stats context to interpret them safely.
 */
export function createAiStatisticsExport(
  input: AiStatisticsExportInput,
  exportedAt = new Date().toISOString(),
) {
  const games = chronologicalGames(input.games);
  const players = playerReferences(input, games);
  const tournaments = tournamentReferences(input, games);
  const lines = lineReferences(input, games, tournaments);
  const strategies = strategyReferences(games);
  const playerLookup = new Map(players.map((player) => [player.id, player]));
  const lineLookup = new Map(lines.map((line) => [line.id, line]));
  const strategyLookup = new Map(strategies.map((strategy) => [strategy.id, strategy]));
  const calculatedGames = games.map(calculateGameStatistics);
  const derivedStatistics = mergeGameStatistics(
    calculatedGames,
    players,
    lines.map((line): TrackingLine => ({
      id: line.id,
      name: line.name,
      suggestedPlayerIds: [],
    })),
  );
  const includedGameIds = games.map((data) => data.game.id);
  const availableGameMetadata = new Map<number, AiStatisticsAvailableGameInput>();
  for (const game of input.availableGames ?? []) availableGameMetadata.set(game.id, game);
  for (const data of games) availableGameMetadata.set(data.game.id, data.game);
  const availableGameIds = uniqueIds(
    input.availableGameIds ??
      input.availableGames?.map((game) => game.id) ??
      includedGameIds,
  );
  const availableGames = availableGameIds.map((id) => {
    const game = availableGameMetadata.get(id);
    return {
      id,
      title: game?.title ?? null,
      tournamentId: game?.tournamentId ?? null,
      tournamentName: game?.tournamentName ?? null,
      opponentName: game?.opponentName ?? null,
      playedAt: game?.playedAt ?? null,
    };
  });
  const includedGameIdSet = new Set(includedGameIds);

  return {
    format: AI_STATISTICS_EXPORT_FORMAT,
    version: AI_STATISTICS_EXPORT_VERSION,
    exportedAt,
    scope: {
      type: input.scope.type,
      team: {
        id: input.scope.team.id,
        name: input.scope.team.name,
      },
      season: input.scope.season
        ? { id: input.scope.season.id, name: input.scope.season.name }
        : null,
      tournament: input.scope.tournament
        ? {
            id: input.scope.tournament.id,
            name: input.scope.tournament.name,
            startsOn: input.scope.tournament.startsOn,
            endsOn: input.scope.tournament.endsOn,
          }
        : null,
      game: input.scope.game
        ? {
            id: input.scope.game.id,
            title: input.scope.game.title,
            opponentName: input.scope.game.opponentName,
            playedAt: input.scope.game.playedAt,
          }
        : null,
      availableGameIds,
      availableGames,
      includedGameIds,
      excludedGameIds: availableGameIds.filter((id) => !includedGameIdSet.has(id)),
      excludedGames: availableGames.filter((game) => !includedGameIdSet.has(game.id)),
    },
    semantics: SEMANTICS,
    references: {
      players,
      tournaments,
      lines,
      strategies,
    },
    aggregate: {
      recordedScoreSummary: aggregateRecordedScoreSummary(calculatedGames),
      derivedStatistics,
      dataQuality: aggregateDataQuality(games, calculatedGames),
    },
    games: games.map((data, index) =>
      exportedGame(
        data,
        calculatedGames[index],
        playerLookup,
        lineLookup,
        strategyLookup,
      )
    ),
  };
}

/** Fully materialized schema-v1 value returned by createAiStatisticsExport. */
export type AiStatisticsExport = ReturnType<typeof createAiStatisticsExport>;

/** Serialize an AI statistics export as a private, non-cacheable JSON download. */
export function createAiStatisticsDownload(exported: unknown, filenameBase: string): Response {
  const safeBase = filenameBase
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'uvs-ai-statistics';
  return new Response(`${JSON.stringify(exported, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${safeBase}.json"`,
      'cache-control': 'private, no-store',
    },
  });
}

function exportedGame(
  data: TrackingGameData,
  calculated: CalculatedGameStatistics,
  players: Map<number, PlayerReference>,
  lines: Map<number, LineReference>,
  strategies: Map<number, StrategyReference>,
) {
  const pointResults = new Map(
    calculatePointResults(data).map((result) => [result.pointId, result]),
  );
  return {
    id: data.game.id,
    title: data.game.title,
    tournamentId: data.game.tournamentId,
    tournamentName: data.game.tournamentName,
    opponentName: data.game.opponentName,
    playedAt: data.game.playedAt,
    hasVideo: data.game.hasVideo,
    expectedPlayerCount: data.game.expectedPlayerCount,
    sources: {
      timedPointPlayByPlay: data.points.length > 0,
      standaloneTimelineEvents: data.standaloneEvents.length > 0,
      paperPlayerTotals: data.manualPlayerStatistics.length > 0,
      paperPointSummaries: data.manualPoints.length > 0,
    },
    score: {
      initial: {
        trackedTeam: data.game.initialOurScore,
        opponent: data.game.initialOpponentScore,
      },
      latestRecorded: {
        trackedTeam: calculated.ourScore,
        opponent: calculated.opponentScore,
      },
    },
    coverage: calculated.coverage,
    warnings: calculated.warnings,
    dataQuality: gameDataQuality(data, calculated),
    playerMatchupRoles: data.players
      .map((player) => ({
        player: resolvedPlayer(player.id, players),
        defaultMatchupRole: player.defaultMatchupRole,
        gameOverride: player.gameMatchupRoleOverride,
        effectiveMatchupRole: player.matchupRole,
      }))
      .sort((left, right) => left.player.playerId - right.player.playerId),
    derivedStatistics: calculated,
    rawSources: {
      playByPlay: {
        points: [...data.points]
          .sort((left, right) =>
            left.sequenceNumber - right.sequenceNumber || left.id - right.id)
          .map((point) =>
            exportedPoint(
              point,
              pointResults.get(point.id) ?? null,
              players,
              lines,
              strategies,
            )
          ),
        standaloneEvents: sortedEvents(data.standaloneEvents).map((event) =>
          exportedEvent(event, players, strategies)
        ),
      },
      paper: {
        playerTotals: data.manualPlayerStatistics
          .map((statistics) => ({
            player: resolvedPlayer(statistics.playerId, players),
            pointsPlayed: statistics.pointsPlayed,
            hockeyAssists: statistics.hockeyAssists,
            assists: statistics.assists,
            goals: statistics.goals,
            blocks: statistics.blocks,
          }))
          .sort((left, right) => left.player.playerId - right.player.playerId),
        pointSummaries: exportedManualPoints(
          data.manualPoints,
          data.game.initialOurScore,
          data.game.initialOpponentScore,
          players,
          lines,
          strategies,
        ),
      },
    },
  };
}

function exportedPoint(
  point: TrackingPoint,
  result: ReturnType<typeof calculatePointResults>[number] | null,
  players: Map<number, PlayerReference>,
  lines: Map<number, LineReference>,
  strategies: Map<number, StrategyReference>,
) {
  const state = calculatePointState(point);
  const events = sortedEvents(point.events);
  const terminalEventIndex = events.findIndex(
    (event) => event.type === 'goal' || event.type === 'conceded',
  );
  return {
    id: point.id,
    sequenceNumber: point.sequenceNumber,
    startCode: point.startingPossession === 'offense' ? 'O' : 'D',
    startingPossession: point.startingPossession,
    startTimeMs: point.startTimeMs,
    endTimeMs: state.endTimeMs,
    durationMs: state.endTimeMs === null
      ? null
      : Math.max(0, state.endTimeMs - point.startTimeMs),
    line: resolvedLine(point.lineId, lines),
    puller: nullableResolvedPlayer(point.pullerPlayerId, players),
    startingPlayers: point.startingPlayerIds.map((id) => resolvedPlayer(id, players)),
    matchupRoleOverrides: Object.entries(point.matchupRoleOverrides)
      .map(([id, role]) => ({
        player: resolvedPlayer(Number(id), players),
        role,
      }))
      .sort((left, right) => left.player.playerId - right.player.playerId),
    initialStrategies: {
      offense: nullableResolvedStrategy(point.initialOffenseStrategyId, strategies),
      defense: nullableResolvedStrategy(point.initialDefenseStrategyId, strategies),
    },
    result: result?.result ?? (state.outcome === 'goal'
      ? 'won'
      : state.outcome === 'conceded' ? 'lost' : 'open'),
    breakAgainst: result?.breakAgainst ?? false,
    scoreAfterPoint: result && result.result !== 'open'
      ? {
          trackedTeam: result.ourScore,
          opponent: result.opponentScore,
        }
      : null,
    finalState: {
      possession: state.possession,
      handler: nullableResolvedPlayer(state.handlerPlayerId, players),
      activePlayers: state.activePlayerIds.map((id) => resolvedPlayer(id, players)),
      ended: state.ended,
      outcome: state.outcome,
      offenseStrategy: nullableResolvedStrategy(state.offenseStrategyId, strategies),
      defenseStrategy: nullableResolvedStrategy(state.defenseStrategyId, strategies),
    },
    events: events.map((event, index) =>
      exportedEvent(
        event,
        players,
        strategies,
        terminalEventIndex < 0 || index <= terminalEventIndex,
      )
    ),
  };
}

function exportedEvent(
  event: TrackingEvent,
  players: Map<number, PlayerReference>,
  strategies: Map<number, StrategyReference>,
  includedInDerivedStatistics = true,
) {
  return {
    id: event.id,
    timeMs: event.timeMs,
    type: event.type,
    includedInDerivedStatistics,
    payload: exportedEventPayload(event.type, event.payload),
    actors: eventActors(event.type, event.payload, players),
    strategy: event.type === 'strategy_set'
      ? nullableResolvedStrategy(payloadId(event.payload, 'strategyId'), strategies)
      : null,
  };
}

function exportedManualPoints(
  manualPoints: ManualPointSummary[],
  initialOurScore: number,
  initialOpponentScore: number,
  players: Map<number, PlayerReference>,
  lines: Map<number, LineReference>,
  strategies: Map<number, StrategyReference>,
) {
  let ourScore = initialOurScore;
  let opponentScore = initialOpponentScore;
  return [...manualPoints]
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber || left.id - right.id)
    .map((point) => {
      const previous = { trackedTeam: ourScore, opponent: opponentScore };
      const won = point.ourScore > ourScore;
      const lost = point.opponentScore > opponentScore;
      ourScore = point.ourScore;
      opponentScore = point.opponentScore;
      return {
        id: point.id,
        sequenceNumber: point.sequenceNumber,
        startCode: point.startingPossession === 'offense' ? 'O' : 'D',
        startingPossession: point.startingPossession,
        line: resolvedLine(point.lineId, lines),
        initialDefenseType: point.initialDefenseType,
        initialStrategies: {
          offense: nullableResolvedStrategy(point.offenseStrategyId, strategies),
          defense: nullableResolvedStrategy(point.defenseStrategyId, strategies),
        },
        ourTurnovers: point.ourTurnovers,
        scoringMethod: point.scoringMethod,
        thrower: nullableResolvedPlayer(point.throwerPlayerId, players),
        receiver: nullableResolvedPlayer(point.receiverPlayerId, players),
        result: won ? 'won' : lost ? 'lost' : 'invalid_or_unchanged_score',
        breakAgainst: lost && point.startingPossession === 'offense',
        scoreBeforePoint: previous,
        scoreAfterPoint: {
          trackedTeam: point.ourScore,
          opponent: point.opponentScore,
        },
      };
    });
}

function playerReferences(
  input: AiStatisticsExportInput,
  games: TrackingGameData[],
): PlayerReference[] {
  const references = new Map<number, PlayerReference>();
  for (const player of input.players) {
    references.set(player.id, {
      id: player.id,
      name: player.name,
      defaultMatchupRole: player.defaultMatchupRole ?? player.matchupRole ?? null,
    });
  }
  for (const player of games.flatMap((game) => game.players)) {
    references.set(player.id, {
      id: player.id,
      name: player.name,
      defaultMatchupRole: player.defaultMatchupRole,
    });
  }
  return [...references.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.id - right.id,
  );
}

function tournamentReferences(
  input: AiStatisticsExportInput,
  games: TrackingGameData[],
): TournamentReference[] {
  const references = new Map<number, TournamentReference>();
  for (const tournament of input.tournaments) {
    references.set(tournament.id, {
      id: tournament.id,
      name: tournament.name,
      startsOn: tournament.startsOn,
      endsOn: tournament.endsOn,
    });
  }
  for (const data of games) {
    if (!references.has(data.game.tournamentId)) {
      references.set(data.game.tournamentId, {
        id: data.game.tournamentId,
        name: data.game.tournamentName,
        startsOn: null,
        endsOn: null,
      });
    }
  }
  return [...references.values()].sort((left, right) =>
    compareNullableDate(left.startsOn, right.startsOn) ||
    left.name.localeCompare(right.name) ||
    left.id - right.id
  );
}

function lineReferences(
  input: AiStatisticsExportInput,
  games: TrackingGameData[],
  tournaments: TournamentReference[],
): LineReference[] {
  const tournamentByLine = new Map<number, number>();
  for (const tournament of input.tournaments) {
    for (const line of tournament.lines ?? []) tournamentByLine.set(line.id, tournament.id);
  }
  for (const data of games) {
    for (const line of data.lines) tournamentByLine.set(line.id, data.game.tournamentId);
  }
  const references = new Map<number, LineReference>();
  for (const line of input.lines) {
    references.set(line.id, {
      id: line.id,
      tournamentId: line.tournamentId ?? tournamentByLine.get(line.id) ?? null,
      name: line.name,
    });
  }
  for (const data of games) {
    for (const line of data.lines) {
      references.set(line.id, {
        id: line.id,
        tournamentId: data.game.tournamentId,
        name: line.name,
      });
    }
  }
  const tournamentOrder = new Map(tournaments.map((tournament, index) => [tournament.id, index]));
  return [...references.values()].sort((left, right) => {
    const leftTournamentOrder =
      tournamentOrder.get(left.tournamentId ?? -1) ?? Number.MAX_SAFE_INTEGER;
    const rightTournamentOrder =
      tournamentOrder.get(right.tournamentId ?? -1) ?? Number.MAX_SAFE_INTEGER;
    return leftTournamentOrder - rightTournamentOrder ||
      left.name.localeCompare(right.name) ||
      left.id - right.id;
  });
}

function strategyReferences(games: TrackingGameData[]): StrategyReference[] {
  const references = new Map<number, StrategyReference>();
  for (const strategy of games.flatMap((game) => game.strategies)) {
    references.set(strategy.id, { ...strategy });
  }
  return [...references.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.id - right.id
  );
}

function aggregateRecordedScoreSummary(calculatedGames: CalculatedGameStatistics[]) {
  let trackedTeamAhead = 0;
  let opponentAhead = 0;
  let level = 0;
  let trackedTeamScoreTotal = 0;
  let opponentScoreTotal = 0;
  for (const game of calculatedGames) {
    trackedTeamScoreTotal += game.ourScore;
    opponentScoreTotal += game.opponentScore;
    if (game.ourScore > game.opponentScore) trackedTeamAhead += 1;
    else if (game.ourScore < game.opponentScore) opponentAhead += 1;
    else level += 1;
  }
  return {
    gamesCompared: calculatedGames.length,
    trackedTeamAhead,
    opponentAhead,
    level,
    trackedTeamScoreTotal,
    opponentScoreTotal,
    recordedScoreDifferential: trackedTeamScoreTotal - opponentScoreTotal,
    completionKnown: false,
    interpretation:
      'Comparisons use each game’s latest recorded score. The database does not store a game-completed flag, so these are not certified wins, losses, or ties.',
  };
}

function aggregateDataQuality(
  games: TrackingGameData[],
  calculatedGames: CalculatedGameStatistics[],
) {
  const warnings = calculatedGames.flatMap((game) => game.warnings);
  const profiles = games.map(sourceProfile);
  const sourceProfiles = {
    timedPointOnlyGames: profiles.filter((profile) => profile === 'timed_point_only').length,
    paperOnlyGames: profiles.filter((profile) => profile === 'paper_only').length,
    hybridGames: profiles.filter((profile) => profile === 'hybrid').length,
    standaloneTimelineOnlyGames:
      profiles.filter((profile) => profile === 'standalone_timeline_only').length,
    gamesWithoutStatisticalSource:
      profiles.filter((profile) => profile === 'none').length,
  };
  const representedProfiles = Object.values(sourceProfiles).filter((count) => count > 0).length;
  return {
    status: warnings.length > 0
      ? 'review_warnings'
      : sourceProfiles.hybridGames > 0
        ? 'hybrid_sources'
        : representedProfiles > 1
          ? 'mixed_source_coverage'
          : sourceProfiles.paperOnlyGames > 0
            ? 'limited_to_paper_fields'
            : sourceProfiles.standaloneTimelineOnlyGames > 0
              ? 'standalone_timeline_only'
              : games.length > 0 &&
                  sourceProfiles.gamesWithoutStatisticalSource === games.length
                ? 'no_statistical_source'
              : 'no_calculation_warnings',
    sourceProfiles,
    gamesWithWarnings: calculatedGames.filter((game) => game.warnings.length > 0).length,
    warningCount: warnings.length,
    warningSummary: [...new Set(warnings)].sort(),
    note:
      'A no_calculation_warnings status does not prove complete recording. Consult coverage and per-game source flags.',
  };
}

function gameDataQuality(data: TrackingGameData, calculated: CalculatedGameStatistics) {
  const hasPlayByPlay = data.points.length > 0;
  const hasPaper = data.manualPlayerStatistics.length > 0 || data.manualPoints.length > 0;
  const hasStandaloneTimeline = data.standaloneEvents.length > 0;
  return {
    status: calculated.warnings.length > 0
      ? 'review_warnings'
      : hasPlayByPlay && hasPaper
        ? 'hybrid_sources'
        : !hasPlayByPlay && hasPaper
        ? 'limited_to_paper_fields'
        : hasPlayByPlay
          ? 'recorded_without_calculation_warnings'
          : hasStandaloneTimeline
            ? 'standalone_timeline_only'
            : 'no_statistical_source',
    sourceProfile: sourceProfile(data),
    note: hasPlayByPlay && hasPaper
      ? 'Paper fields override selected play-by-play-derived fields; follow paperDataPolicy and do not combine raw sources.'
      : hasPaper
      ? 'Paper coverage is field-limited; zeros outside captured paper fields may mean unavailable.'
      : hasPlayByPlay
        ? 'Presence of play-by-play does not guarantee every point or actor was recorded.'
        : hasStandaloneTimeline
          ? 'Standalone events may change the latest recorded score, but no completed-point or paper statistics are available.'
          : 'No play-by-play points or paper statistics were recorded.',
  };
}

function sourceProfile(
  data: TrackingGameData,
): 'timed_point_only' | 'paper_only' | 'hybrid' | 'standalone_timeline_only' | 'none' {
  const hasTimedPoints = data.points.length > 0;
  const hasPaper = data.manualPlayerStatistics.length > 0 || data.manualPoints.length > 0;
  if (hasTimedPoints && hasPaper) return 'hybrid';
  if (hasTimedPoints) return 'timed_point_only';
  if (hasPaper) return 'paper_only';
  if (data.standaloneEvents.length > 0) return 'standalone_timeline_only';
  return 'none';
}

function eventActors(
  type: GameEventType,
  payload: GameEventPayload,
  players: Map<number, PlayerReference>,
): Record<string, ResolvedPlayer | null> {
  switch (type) {
    case 'possession_start':
      return { handler: nullableResolvedPlayer(payloadId(payload, 'playerId'), players) };
    case 'completion':
      return {
        thrower: nullableResolvedPlayer(payloadId(payload, 'throwerId'), players),
        receiver: nullableResolvedPlayer(payloadId(payload, 'receiverId'), players),
      };
    case 'turnover': {
      const reason = payloadRecord(payload).reason;
      const chargedPlayerId = payloadId(
        payload,
        reason === 'drop' ? 'intendedReceiverId' : 'throwerId',
      );
      return {
        thrower: nullableResolvedPlayer(payloadId(payload, 'throwerId'), players),
        intendedReceiver: nullableResolvedPlayer(
          payloadId(payload, 'intendedReceiverId'),
          players,
        ),
        chargedPlayer: nullableResolvedPlayer(chargedPlayerId, players),
      };
    }
    case 'defended':
      return { defender: nullableResolvedPlayer(payloadId(payload, 'defenderId'), players) };
    case 'goal':
      return {
        thrower: nullableResolvedPlayer(payloadId(payload, 'throwerId'), players),
        scorer: nullableResolvedPlayer(payloadId(payload, 'receiverId'), players),
      };
    case 'substitution':
      return {
        outgoingPlayer: nullableResolvedPlayer(
          payloadId(payload, 'outgoingPlayerId'),
          players,
        ),
        incomingPlayer: nullableResolvedPlayer(
          payloadId(payload, 'incomingPlayerId'),
          players,
        ),
      };
    case 'opponent_turnover':
    case 'conceded':
    case 'stoppage':
    case 'score_set':
    case 'strategy_set':
      return {};
  }
}

function exportedEventPayload(
  type: GameEventType,
  payload: GameEventPayload,
): Record<string, unknown> {
  const value = payloadRecord(payload);
  switch (type) {
    case 'possession_start':
      return { playerId: payloadId(payload, 'playerId') };
    case 'completion':
      return {
        throwerId: payloadId(payload, 'throwerId'),
        receiverId: payloadId(payload, 'receiverId'),
      };
    case 'turnover':
      return {
        throwerId: payloadId(payload, 'throwerId'),
        intendedReceiverId: payloadId(payload, 'intendedReceiverId'),
        reason: value.reason,
      };
    case 'defended':
      return { defenderId: payloadId(payload, 'defenderId') };
    case 'opponent_turnover':
      return { reason: value.reason };
    case 'goal':
      return {
        throwerId: payloadId(payload, 'throwerId'),
        receiverId: payloadId(payload, 'receiverId'),
        callahan: value.callahan,
      };
    case 'conceded':
      return { callahan: value.callahan };
    case 'substitution':
      return {
        outgoingPlayerId: payloadId(payload, 'outgoingPlayerId'),
        incomingPlayerId: payloadId(payload, 'incomingPlayerId'),
      };
    case 'stoppage':
      return {
        kind: value.kind,
        endTimeMs: value.endTimeMs,
      };
    case 'score_set':
      return {
        ourScore: value.ourScore,
        opponentScore: value.opponentScore,
      };
    case 'strategy_set':
      return {
        kind: value.kind,
        strategyId: payloadId(payload, 'strategyId'),
      };
  }
}

function payloadId(payload: GameEventPayload, field: string): number | null {
  const value = payloadRecord(payload)[field];
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function payloadRecord(payload: GameEventPayload): Record<string, unknown> {
  return payload as unknown as Record<string, unknown>;
}

function resolvedPlayer(
  id: number,
  players: Map<number, PlayerReference>,
): ResolvedPlayer {
  return {
    playerId: id,
    playerName: players.get(id)?.name ?? null,
  };
}

function nullableResolvedPlayer(
  id: number | null,
  players: Map<number, PlayerReference>,
): ResolvedPlayer | null {
  return id === null ? null : resolvedPlayer(id, players);
}

function resolvedLine(id: number, lines: Map<number, LineReference>): ResolvedLine {
  return {
    lineId: id,
    lineName: lines.get(id)?.name ?? null,
  };
}

function nullableResolvedStrategy(
  id: number | null,
  strategies: Map<number, StrategyReference>,
): ResolvedStrategy | null {
  if (id === null) return null;
  const strategy = strategies.get(id);
  return {
    strategyId: id,
    strategyName: strategy?.name ?? null,
    kind: strategy?.kind ?? null,
  };
}

function chronologicalGames(games: TrackingGameData[]): TrackingGameData[] {
  return games
    .map((game, index) => ({ game, index }))
    .sort((left, right) => {
      const leftDate = left.game.game.playedAt;
      const rightDate = right.game.game.playedAt;
      if (leftDate !== null && rightDate !== null) {
        const comparison = leftDate.localeCompare(rightDate);
        if (comparison !== 0) return comparison;
      } else if (leftDate !== null) {
        return -1;
      } else if (rightDate !== null) {
        return 1;
      }
      return left.index - right.index || left.game.game.id - right.game.game.id;
    })
    .map(({ game }) => game);
}

function sortedEvents(events: TrackingEvent[]): TrackingEvent[] {
  return [...events].sort((left, right) => left.timeMs - right.timeMs || left.id - right.id);
}

function compareNullableDate(left: string | null, right: string | null): number {
  if (left !== null && right !== null) return left.localeCompare(right);
  if (left !== null) return -1;
  if (right !== null) return 1;
  return 0;
}

function uniqueIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
}
