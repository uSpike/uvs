import { describe, expect, it } from 'vitest';
import {
  calculateGameStatistics,
  mergeGameStatistics,
  type TrackingGameData,
} from './game-stats';
import {
  AI_STATISTICS_EXPORT_FORMAT,
  AI_STATISTICS_EXPORT_VERSION,
  createAiStatisticsDownload,
  createAiStatisticsExport,
} from './ai-statistics-export';

const EXPORTED_AT = '2026-07-29T12:00:00.000Z';

function trackedGame(overrides: Partial<TrackingGameData['game']> = {}): TrackingGameData {
  return {
    game: {
      id: 11,
      token: 'secret-game-access-token',
      title: 'Pool play',
      teamName: 'Union',
      teamSlug: 'union',
      tournamentId: 7,
      tournamentName: 'Summer Invite',
      opponentName: 'Rivals',
      playedAt: '2026-07-20T10:00:00.000Z',
      hasVideo: true,
      expectedPlayerCount: 3,
      initialOurScore: 0,
      initialOpponentScore: 0,
      initialLineupEndzone: 'left',
      ...overrides,
    },
    players: [
      {
        id: 1,
        name: 'Alex',
        defaultMatchupRole: 'mmp',
        gameMatchupRoleOverride: null,
        matchupRole: 'mmp',
      },
      {
        id: 2,
        name: 'Blair',
        defaultMatchupRole: 'fmp',
        gameMatchupRoleOverride: null,
        matchupRole: 'fmp',
      },
      {
        id: 3,
        name: 'Casey',
        defaultMatchupRole: 'mmp',
        gameMatchupRoleOverride: null,
        matchupRole: 'mmp',
      },
    ],
    lines: [{ id: 4, name: 'O line', suggestedPlayerIds: [1, 2, 3] }],
    strategies: [
      { id: 8, name: 'Hex', kind: 'offense', isDefault: true },
      { id: 9, name: 'Person', kind: 'defense', isDefault: true },
    ],
    points: [{
      id: 21,
      sequenceNumber: 1,
      lineId: 4,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      lineupEndzoneOverride: null,
      initialOffenseStrategyId: 8,
      initialDefenseStrategyId: 9,
      startingPlayerIds: [1, 2, 3],
      matchupRoleOverrides: {},
      events: [
        {
          id: 32,
          pointId: 21,
          timeMs: 3_000,
          type: 'goal',
          payload: { throwerId: 2, receiverId: 3, callahan: false },
          annotations: [{
            id: 99,
            role: 'scorer',
            playerId: 3,
            timeMs: 3_000,
            frameIndex: 90,
            panoramaYaw: 0.2,
            panoramaPitch: -0.1,
          }],
          createdAt: '2026-07-20T10:01:00.000Z',
          updatedAt: '2026-07-20T10:01:00.000Z',
        },
        {
          id: 31,
          pointId: 21,
          timeMs: 2_000,
          type: 'completion',
          payload: { throwerId: 1, receiverId: 2 },
          annotations: [],
          createdAt: '2026-07-20T10:00:30.000Z',
          updatedAt: '2026-07-20T10:00:30.000Z',
        },
      ],
    }],
    standaloneEvents: [],
    highlights: [{
      id: 1,
      startTimeMs: 1_000,
      endTimeMs: 3_000,
      description: 'Private highlight note',
      playerIds: [1, 2, 3],
      createdAt: '2026-07-20T10:02:00.000Z',
      updatedAt: '2026-07-20T10:02:00.000Z',
    }],
    manualPlayerStatistics: [],
    manualPoints: [],
  };
}

function exportInput(games: TrackingGameData[]) {
  return {
    scope: {
      type: 'tournament' as const,
      team: { id: 5, name: 'Union', slug: 'private-team-slug' },
      season: { id: 6, name: '2026' },
      tournament: {
        id: 7,
        name: 'Summer Invite',
        startsOn: '2026-07-20',
        endsOn: '2026-07-21',
      },
    },
    games,
    players: trackedGame().players,
    lines: trackedGame().lines,
    tournaments: [{
      id: 7,
      name: 'Summer Invite',
      startsOn: '2026-07-20',
      endsOn: '2026-07-21',
      lines: [{ id: 4, name: 'O line' }],
    }],
  };
}

describe('AI statistics export', () => {
  it('exports chronological raw actions, calculated totals, and embedded semantics', () => {
    const later = trackedGame({
      id: 12,
      title: 'Bracket play',
      opponentName: 'Surge',
      playedAt: '2026-07-21T11:00:00.000Z',
    });
    const earlier = trackedGame();
    const exported = createAiStatisticsExport(exportInput([later, earlier]), EXPORTED_AT);
    const expected = mergeGameStatistics(
      [calculateGameStatistics(earlier), calculateGameStatistics(later)],
      earlier.players,
      earlier.lines,
    );

    expect(exported).toMatchObject({
      format: AI_STATISTICS_EXPORT_FORMAT,
      version: AI_STATISTICS_EXPORT_VERSION,
      exportedAt: EXPORTED_AT,
      scope: {
        type: 'tournament',
        team: { id: 5, name: 'Union' },
        includedGameIds: [11, 12],
        excludedGameIds: [],
      },
      aggregate: {
        recordedScoreSummary: {
          gamesCompared: 2,
          trackedTeamAhead: 2,
          opponentAhead: 0,
          level: 0,
          trackedTeamScoreTotal: 2,
          opponentScoreTotal: 0,
          completionKnown: false,
        },
        derivedStatistics: expected,
      },
    });
    expect(exported.games.map((game) => game.id)).toEqual([11, 12]);
    expect(exported.games[0].rawSources.playByPlay.points[0]).toMatchObject({
      startCode: 'O',
      durationMs: 2_000,
      result: 'won',
      scoreAfterPoint: { trackedTeam: 1, opponent: 0 },
      line: { lineId: 4, lineName: 'O line' },
      startingPlayers: [
        { playerId: 1, playerName: 'Alex' },
        { playerId: 2, playerName: 'Blair' },
        { playerId: 3, playerName: 'Casey' },
      ],
    });
    const events = exported.games[0].rawSources.playByPlay.points[0].events;
    expect(events.map((event) => event.id)).toEqual([31, 32]);
    expect(events[0]).toMatchObject({
      type: 'completion',
      actors: {
        thrower: { playerId: 1, playerName: 'Alex' },
        receiver: { playerId: 2, playerName: 'Blair' },
      },
    });
    expect(exported.semantics.sportContext.pointStarts).toContain('O-start');
    expect(exported.semantics.paperDataPolicy.join(' ')).toContain('field-level hybrid');
    expect(exported.semantics.analysisGuardrails.join(' ')).toContain('numeric zero');
    expect(exported.semantics.dataDictionary.eventTypes.goal).toContain('Callahan');
    expect(exported.semantics.dataDictionary.calculatedStatistics.player.oEfficiency)
      .toContain('Not a percentage');
    expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
  });

  it('does not leak access fields, spatial annotations, edit timestamps, or highlights', () => {
    const game = trackedGame();
    Object.assign(game.points[0].events[0].payload, {
      futurePrivatePayloadField: 'must not enter version one implicitly',
    });
    const exported = createAiStatisticsExport(exportInput([game]), EXPORTED_AT);
    const keys = recursiveKeys(exported);
    const json = JSON.stringify(exported);

    expect(keys).not.toContain('token');
    expect(keys).not.toContain('teamSlug');
    expect(keys).not.toContain('slug');
    expect(keys).not.toContain('annotations');
    expect(keys).not.toContain('createdAt');
    expect(keys).not.toContain('updatedAt');
    expect(keys).not.toContain('highlights');
    expect(json).not.toContain('secret-game-access-token');
    expect(json).not.toContain('Private highlight note');
    expect(json).not.toContain('panoramaYaw');
    expect(json).not.toContain('futurePrivatePayloadField');
  });

  it('keeps paper sources separate and warns that uncaptured zeroes are unavailable', () => {
    const paper = trackedGame({ hasVideo: false });
    paper.points = [];
    paper.manualPlayerStatistics = [{
      playerId: 1,
      pointsPlayed: 1,
      hockeyAssists: 0,
      assists: 1,
      goals: 0,
      blocks: 0,
    }, {
      playerId: 2,
      pointsPlayed: 1,
      hockeyAssists: 0,
      assists: 0,
      goals: 1,
      blocks: 0,
    }];
    paper.manualPoints = [{
      id: 40,
      sequenceNumber: 1,
      lineId: 4,
      startingPossession: 'defense',
      initialDefenseType: 'Zone',
      offenseStrategyId: 8,
      defenseStrategyId: 9,
      ourTurnovers: 1,
      scoringMethod: 'Break-side pass',
      throwerPlayerId: 1,
      receiverPlayerId: 2,
      ourScore: 1,
      opponentScore: 0,
    }];

    const exported = createAiStatisticsExport(exportInput([paper]), EXPORTED_AT);
    const game = exported.games[0];

    expect(game.sources).toEqual({
      timedPointPlayByPlay: false,
      standaloneTimelineEvents: false,
      paperPlayerTotals: true,
      paperPointSummaries: true,
    });
    expect(game.dataQuality.status).toBe('limited_to_paper_fields');
    expect(game.rawSources.paper.pointSummaries[0]).toMatchObject({
      startCode: 'D',
      result: 'won',
      thrower: { playerId: 1, playerName: 'Alex' },
      receiver: { playerId: 2, playerName: 'Blair' },
      scoreBeforePoint: { trackedTeam: 0, opponent: 0 },
      scoreAfterPoint: { trackedTeam: 1, opponent: 0 },
    });
    expect(game.derivedStatistics.coverage).toEqual({
      gameCount: 1,
      playByPlayGames: 0,
      paperPlayerGames: 1,
      paperPointGames: 1,
    });
    expect(game.dataQuality.note).toContain('may mean unavailable');
  });

  it('marks hybrid reducer output and explains paper extended plus/minus replacement', () => {
    const hybrid = trackedGame();
    hybrid.manualPlayerStatistics = [{
      playerId: 1,
      pointsPlayed: 1,
      hockeyAssists: 1,
      assists: 0,
      goals: 0,
      blocks: 0,
    }];

    const exported = createAiStatisticsExport(exportInput([hybrid]), EXPORTED_AT);

    expect(exported.games[0].sources).toMatchObject({
      timedPointPlayByPlay: true,
      paperPlayerTotals: true,
    });
    expect(exported.games[0].dataQuality).toMatchObject({
      status: 'hybrid_sources',
      sourceProfile: 'hybrid',
    });
    expect(exported.aggregate.dataQuality.status).toBe('hybrid_sources');
    expect(exported.semantics.paperDataPolicy.join(' ')).toContain(
      'extendedPlusMinus is replaced with goals + assists + blocks',
    );
  });

  it('charges a recorded drop to its intended receiver without generated blame prose', () => {
    const game = trackedGame();
    game.points[0].events = [{
      id: 41,
      pointId: 21,
      timeMs: 2_000,
      type: 'turnover',
      payload: { throwerId: 1, intendedReceiverId: 2, reason: 'drop' },
      annotations: [],
      createdAt: '2026-07-20T10:00:30.000Z',
      updatedAt: '2026-07-20T10:00:30.000Z',
    }];

    const exported = createAiStatisticsExport(exportInput([game]), EXPORTED_AT);
    const event = exported.games[0].rawSources.playByPlay.points[0].events[0];

    expect(event).toMatchObject({
      type: 'turnover',
      includedInDerivedStatistics: true,
      actors: {
        thrower: { playerId: 1, playerName: 'Alex' },
        intendedReceiver: { playerId: 2, playerName: 'Blair' },
        chargedPlayer: { playerId: 2, playerName: 'Blair' },
      },
    });
    expect(event).not.toHaveProperty('description');
  });

  it('does not certify empty or score-synchronized games as completed results', () => {
    const empty = trackedGame({ id: 13, title: 'Unrecorded game' });
    empty.points = [];
    const scoreOnly = trackedGame({ id: 14, title: 'Score synchronization only' });
    scoreOnly.points = [];
    scoreOnly.standaloneEvents = [{
      id: 50,
      pointId: null,
      timeMs: 20_000,
      type: 'score_set',
      payload: { ourScore: 4, opponentScore: 3 },
      annotations: [],
      createdAt: '2026-07-20T10:20:00.000Z',
      updatedAt: '2026-07-20T10:20:00.000Z',
    }];

    const exported = createAiStatisticsExport(exportInput([empty, scoreOnly]), EXPORTED_AT);

    expect(exported.games[0]).toMatchObject({
      score: {
        initial: { trackedTeam: 0, opponent: 0 },
        latestRecorded: { trackedTeam: 0, opponent: 0 },
      },
      dataQuality: { status: 'no_statistical_source', sourceProfile: 'none' },
    });
    expect(exported.games[0].score).not.toHaveProperty('final');
    expect(exported.games[1]).toMatchObject({
      sources: { standaloneTimelineEvents: true },
      score: { latestRecorded: { trackedTeam: 4, opponent: 3 } },
      dataQuality: {
        status: 'standalone_timeline_only',
        sourceProfile: 'standalone_timeline_only',
      },
    });
    expect(exported.aggregate.recordedScoreSummary).toMatchObject({
      trackedTeamAhead: 1,
      level: 1,
      completionKnown: false,
    });
    expect(exported.aggregate.recordedScoreSummary).not.toHaveProperty('wins');
  });

  it('identifies excluded games with non-secret context for selection-bias review', () => {
    const included = trackedGame();
    const excluded = trackedGame({
      id: 12,
      title: 'Bracket play',
      opponentName: 'Surge',
      playedAt: '2026-07-21T11:00:00.000Z',
    });
    const input = {
      ...exportInput([included]),
      availableGameIds: [11, 12],
      availableGames: [included.game, excluded.game],
    };

    const exported = createAiStatisticsExport(input, EXPORTED_AT);

    expect(exported.scope.excludedGameIds).toEqual([12]);
    expect(exported.scope.excludedGames).toEqual([{
      id: 12,
      title: 'Bracket play',
      tournamentId: 7,
      tournamentName: 'Summer Invite',
      opponentName: 'Surge',
      playedAt: '2026-07-21T11:00:00.000Z',
    }]);
    expect(JSON.stringify(exported.scope)).not.toContain('secret-game-access-token');
  });

  it('marks events after a point-ending score as excluded from derived statistics', () => {
    const game = trackedGame();
    game.points[0].events.push({
      id: 33,
      pointId: 21,
      timeMs: 4_000,
      type: 'completion',
      payload: { throwerId: 1, receiverId: 2 },
      annotations: [],
      createdAt: '2026-07-20T10:01:30.000Z',
      updatedAt: '2026-07-20T10:01:30.000Z',
    });

    const exported = createAiStatisticsExport(exportInput([game]), EXPORTED_AT);
    const events = exported.games[0].rawSources.playByPlay.points[0].events;

    expect(events.map((event) => [event.id, event.includedInDerivedStatistics])).toEqual([
      [31, true],
      [32, true],
      [33, false],
    ]);
    expect(exported.games[0].warnings).toContain('Point 1 has an event after it ended.');
  });

  it('represents an empty season without inventing statistics', () => {
    const base = exportInput([]);
    const exported = createAiStatisticsExport({
      ...base,
      scope: {
        type: 'season',
        team: base.scope.team,
        season: base.scope.season,
      },
    }, EXPORTED_AT);

    expect(exported.games).toEqual([]);
    expect(exported.aggregate.recordedScoreSummary).toEqual({
      gamesCompared: 0,
      trackedTeamAhead: 0,
      opponentAhead: 0,
      level: 0,
      trackedTeamScoreTotal: 0,
      opponentScoreTotal: 0,
      recordedScoreDifferential: 0,
      completionKnown: false,
      interpretation:
        'Comparisons use each game’s latest recorded score. The database does not store a game-completed flag, so these are not certified wins, losses, or ties.',
    });
    expect(exported.aggregate.derivedStatistics.coverage.gameCount).toBe(0);
  });

  it('creates a safe private JSON download', async () => {
    const response = createAiStatisticsDownload(
      { format: AI_STATISTICS_EXPORT_FORMAT },
      'Union "Summer Invite"\r\nAI stats',
    );

    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition'))
      .toBe('attachment; filename="Union-Summer-Invite-AI-stats.json"');
    expect(await response.text()).toBe(`{\n  "format": "${AI_STATISTICS_EXPORT_FORMAT}"\n}\n`);
  });
});

function recursiveKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(recursiveKeys);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...recursiveKeys(nested)]);
}
