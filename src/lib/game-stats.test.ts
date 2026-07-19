import { describe, expect, it } from 'vitest';
import {
  calculateGameStatistics,
  calculatePointResults,
  calculatePointState,
  autoCameraEndzoneAtTime,
  latestPointTimeMs,
  type GameEventPayload,
  type GameEventType,
  type TrackingEvent,
  type TrackingGameData,
  type TrackingPoint,
} from './game-stats';

let nextEventId = 1;

function event(
  pointId: number | null,
  timeMs: number,
  type: GameEventType,
  payload: GameEventPayload,
): TrackingEvent {
  return {
    id: nextEventId++,
    pointId,
    timeMs,
    type,
    payload,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function point(overrides: Partial<TrackingPoint> = {}): TrackingPoint {
  return {
    id: 1,
    sequenceNumber: 1,
    lineId: 1,
    startingPossession: 'offense',
    startTimeMs: 1_000,
    pullerPlayerId: null,
    initialOffenseStrategyId: null,
    initialDefenseStrategyId: null,
    startingPlayerIds: [1, 2, 3],
    matchupRoleOverrides: {},
    events: [],
    ...overrides,
    lineupEndzoneOverride: overrides.lineupEndzoneOverride ?? null,
  };
}

function gameData(points: TrackingPoint[], standaloneEvents: TrackingEvent[] = []): TrackingGameData {
  return {
    game: {
      id: 1,
      token: 'game-token',
      title: 'Test game',
      teamName: 'Reco',
      teamSlug: 'reco',
      tournamentId: 1,
      tournamentName: 'Test tournament',
      opponentName: 'Opponent',
      playedAt: null,
      hasVideo: true,
      expectedPlayerCount: 3,
      initialOurScore: 0,
      initialOpponentScore: 0,
      initialLineupEndzone: 'left',
    },
    players: [
      { id: 1, name: 'Alex', defaultMatchupRole: 'mmp', gameMatchupRoleOverride: null, matchupRole: 'mmp' },
      { id: 2, name: 'Blair', defaultMatchupRole: 'fmp', gameMatchupRoleOverride: null, matchupRole: 'fmp' },
      { id: 3, name: 'Casey', defaultMatchupRole: 'mmp', gameMatchupRoleOverride: null, matchupRole: 'mmp' },
      { id: 4, name: 'Devon', defaultMatchupRole: 'fmp', gameMatchupRoleOverride: null, matchupRole: 'fmp' },
      { id: 5, name: 'Emery', defaultMatchupRole: 'mmp', gameMatchupRoleOverride: null, matchupRole: 'mmp' },
      { id: 6, name: 'Frankie', defaultMatchupRole: 'fmp', gameMatchupRoleOverride: null, matchupRole: 'fmp' },
      { id: 7, name: 'Gray', defaultMatchupRole: 'mmp', gameMatchupRoleOverride: null, matchupRole: 'mmp' },
    ],
    lines: [{ id: 1, name: 'O line', suggestedPlayerIds: [1, 2, 3] }],
    strategies: [],
    points,
    standaloneEvents,
    highlights: [],
    manualPlayerStatistics: [],
    manualPoints: [],
  };
}

describe('game statistics', () => {
  it('frames the lineup end before a pull and infers the next end after scores', () => {
    const first = point({
      events: [event(1, 5_000, 'goal', { throwerId: 1, receiverId: 2, callahan: false })],
    });
    const second = point({
      id: 2,
      sequenceNumber: 2,
      startTimeMs: 20_000,
      events: [event(2, 25_000, 'conceded', { callahan: false })],
    });
    const data = gameData([first, second]);

    expect(autoCameraEndzoneAtTime(data, 0)).toBe('left');
    expect(autoCameraEndzoneAtTime(data, 1_000)).toBeNull();
    expect(autoCameraEndzoneAtTime(data, 5_000)).toBe('right');
    expect(autoCameraEndzoneAtTime(data, 14_999)).toBe('right');
    expect(autoCameraEndzoneAtTime(data, 15_000)).toBe('right');
    expect(autoCameraEndzoneAtTime(data, 20_000)).toBeNull();
    expect(autoCameraEndzoneAtTime(data, 25_000)).toBe('right');
    expect(autoCameraEndzoneAtTime(data, 34_999)).toBe('right');
    expect(autoCameraEndzoneAtTime(data, 35_000)).toBe('left');
  });

  it('uses a point endzone override as the basis for later inference', () => {
    const overridden = point({
      lineupEndzoneOverride: 'right',
      events: [event(1, 5_000, 'goal', { throwerId: 1, receiverId: 2, callahan: false })],
    });
    const data = gameData([overridden]);

    expect(autoCameraEndzoneAtTime(data, 0)).toBe('right');
    expect(autoCameraEndzoneAtTime(data, 5_000)).toBe('left');
    expect(autoCameraEndzoneAtTime(data, 15_000)).toBe('left');
  });

  it('reports each point score, result, and breaks against the offense', () => {
    const first = point({
      events: [event(1, 5_000, 'goal', { throwerId: 1, receiverId: 2, callahan: false })],
    });
    const second = point({
      id: 2,
      sequenceNumber: 2,
      startTimeMs: 7_000,
      startingPossession: 'offense',
      events: [event(2, 10_000, 'conceded', { callahan: false })],
    });
    const data = gameData([
      first,
      second,
      point({ id: 3, sequenceNumber: 3, startTimeMs: 12_000 }),
    ], [event(null, 500, 'score_set', { ourScore: 3, opponentScore: 2 })]);

    expect(calculatePointResults(data)).toEqual([
      { pointId: 1, sequenceNumber: 1, ourScore: 4, opponentScore: 2, result: 'won', breakAgainst: false },
      { pointId: 2, sequenceNumber: 2, ourScore: 4, opponentScore: 3, result: 'lost', breakAgainst: true },
      { pointId: 3, sequenceNumber: 3, ourScore: 4, opponentScore: 3, result: 'open', breakAgainst: false },
    ]);
  });

  it('uses paper player totals and point summaries without inventing play-by-play', () => {
    const data = gameData([]);
    data.manualPlayerStatistics = [
      { playerId: 1, pointsPlayed: 5, hockeyAssists: 2, assists: 3, goals: 1, blocks: 4 },
      { playerId: 2, pointsPlayed: 4, hockeyAssists: 0, assists: 1, goals: 0, blocks: 1 },
    ];
    data.manualPoints = [
      {
        id: 1,
        sequenceNumber: 1,
        lineId: 1,
        startingPossession: 'offense',
        initialDefenseType: null,
        offenseStrategyId: null,
        defenseStrategyId: null,
        ourTurnovers: 2,
        scoringMethod: 'End-zone isolation',
        scorerPlayerId: 1,
        ourScore: 1,
        opponentScore: 0,
      },
      {
        id: 2,
        sequenceNumber: 2,
        lineId: 1,
        startingPossession: 'defense',
        initialDefenseType: 'Zone',
        offenseStrategyId: null,
        defenseStrategyId: null,
        ourTurnovers: 1,
        scoringMethod: null,
        scorerPlayerId: null,
        ourScore: 1,
        opponentScore: 1,
      },
    ];

    const calculated = calculateGameStatistics(data);

    expect(calculated).toMatchObject({ ourScore: 1, opponentScore: 1, warnings: [] });
    expect(calculated.playerStatistics.find((stats) => stats.playerId === 1)).toMatchObject({
      pointsPlayed: 5,
      hockeyAssists: 2,
      assists: 3,
      goals: 1,
      blocks: 4,
      completions: 0,
    });
    expect(calculated.lineStatistics[0]).toMatchObject({
      pointsPlayed: 2,
      oPointsPlayed: 1,
      oPointsWon: 1,
      dPointsPlayed: 1,
      dPointsWon: 0,
      turnovers: 3,
      goalsFor: 1,
      goalsAgainst: 1,
      plusMinus: 0,
    });
    expect(calculated.matchupStatistics.unclassifiedPoints).toBe(2);
  });

  it('tracks scoring passes, hockey assists, disc time, and exact stoppage exclusion', () => {
    nextEventId = 1;
    const first = point();
    first.events = [
      event(1, 1_500, 'possession_start', { playerId: 1 }),
      event(1, 2_000, 'completion', { throwerId: 1, receiverId: 2 }),
      event(1, 3_000, 'stoppage', { kind: 'foul', endTimeMs: 5_000 }),
      event(1, 7_000, 'completion', { throwerId: 2, receiverId: 3 }),
      event(1, 9_000, 'goal', { throwerId: 3, receiverId: 1, callahan: false }),
    ];

    const calculated = calculateGameStatistics(gameData([first]));
    const alex = calculated.playerStatistics.find((stats) => stats.playerId === 1)!;
    const blair = calculated.playerStatistics.find((stats) => stats.playerId === 2)!;
    const casey = calculated.playerStatistics.find((stats) => stats.playerId === 3)!;

    expect(calculated).toMatchObject({ ourScore: 1, opponentScore: 0, warnings: [] });
    expect(alex).toMatchObject({
      timePlayedMs: 8_000,
      pointsPlayed: 1,
      oPointsWon: 1,
      completions: 1,
      receptions: 1,
      goals: 1,
      plusMinus: 1,
      timeWithDiscMs: 500,
    });
    expect(blair).toMatchObject({
      completions: 1,
      receptions: 1,
      hockeyAssists: 1,
      timeWithDiscMs: 3_000,
    });
    expect(casey).toMatchObject({
      completions: 1,
      receptions: 1,
      assists: 1,
      timeWithDiscMs: 2_000,
    });
    expect(calculated.lineStatistics[0]).toMatchObject({
      timePlayedMs: 8_000,
      pointsPlayed: 1,
      oPointsPlayed: 1,
      oPointsWon: 1,
      completions: 3,
      goalsFor: 1,
      plusMinus: 1,
    });
  });

  it('credits every participant with a point win but only active scorers with plus-minus', () => {
    nextEventId = 20;
    const defense = point({
      id: 2,
      sequenceNumber: 2,
      startingPossession: 'defense',
      startTimeMs: 10_000,
      pullerPlayerId: 1,
    });
    defense.events = [
      event(2, 11_000, 'defended', { defenderId: 2 }),
      event(2, 12_000, 'completion', { throwerId: 1, receiverId: 2 }),
      event(2, 13_000, 'substitution', { outgoingPlayerId: 3, incomingPlayerId: 4 }),
      event(2, 14_000, 'turnover', {
        throwerId: 2,
        intendedReceiverId: 4,
        reason: 'drop',
      }),
      event(2, 16_000, 'goal', { throwerId: null, receiverId: 1, callahan: true }),
    ];
    const scoreSet = event(null, 17_000, 'score_set', { ourScore: 5, opponentScore: 4 });

    const calculated = calculateGameStatistics(gameData([defense], [scoreSet]));
    const byId = new Map(calculated.playerStatistics.map((stats) => [stats.playerId, stats]));

    expect(calculated.ourScore).toBe(5);
    expect(calculated.opponentScore).toBe(4);
    expect(byId.get(1)).toMatchObject({
      dPointsPlayed: 1,
      dPointsWon: 1,
      pulls: 1,
      goals: 1,
      blocks: 1,
      plusMinus: 1,
    });
    expect(byId.get(2)).toMatchObject({ dPointsWon: 1, blocks: 1, plusMinus: 1 });
    expect(byId.get(3)).toMatchObject({
      timePlayedMs: 3_000,
      dPointsPlayed: 1,
      dPointsWon: 1,
      plusMinus: 0,
    });
    expect(byId.get(4)).toMatchObject({
      timePlayedMs: 3_000,
      dPointsPlayed: 1,
      dPointsWon: 1,
      turnovers: 1,
      plusMinus: 1,
    });
    expect(calculated.lineStatistics[0]).toMatchObject({ blocks: 2, goalsFor: 1 });
  });

  it('derives the live handler and flags incomplete attribution', () => {
    nextEventId = 40;
    const open = point();
    open.events = [
      event(1, 2_000, 'completion', { throwerId: 1, receiverId: 2 }),
      event(1, 3_000, 'turnover', {
        throwerId: 2,
        intendedReceiverId: null,
        reason: 'throwaway',
      }),
      event(1, 4_000, 'defended', { defenderId: null }),
    ];

    expect(calculatePointState(open)).toMatchObject({
      possession: 'offense',
      handlerPlayerId: null,
      activePlayerIds: [1, 2, 3],
      ended: false,
    });
    expect(calculateGameStatistics(gameData([open])).warnings).toContain(
      'Point 1 has an incomplete defended.',
    );
  });

  it('finds the latest resume time for an open point', () => {
    nextEventId = 50;
    const open = point({ startTimeMs: 1_000 });
    open.events = [
      event(1, 2_000, 'completion', { throwerId: 1, receiverId: 2 }),
      event(1, 3_000, 'stoppage', { kind: 'foul', endTimeMs: 5_000 }),
    ];

    expect(latestPointTimeMs(open)).toBe(5_000);
    expect(latestPointTimeMs(point({ startTimeMs: 7_000 }))).toBe(7_000);
  });

  it('classifies 4/3 pull lineups using point overrides and aggregates outcomes', () => {
    nextEventId = 60;
    const mmpPoint = point({
      id: 10,
      sequenceNumber: 1,
      startingPlayerIds: [1, 2, 3, 4, 5, 6, 7],
      events: [event(10, 2_000, 'goal', { throwerId: 1, receiverId: 2, callahan: false })],
    });
    const fmpPoint = point({
      id: 11,
      sequenceNumber: 2,
      startingPossession: 'defense',
      startTimeMs: 3_000,
      startingPlayerIds: [1, 2, 3, 4, 5, 6, 7],
      matchupRoleOverrides: { 7: 'fmp' },
      events: [event(11, 4_000, 'conceded', { callahan: false })],
    });

    expect(calculateGameStatistics(gameData([mmpPoint, fmpPoint])).matchupStatistics).toEqual({
      mmp: {
        matchup: 'mmp',
        pointsPlayed: 1,
        pointsWon: 1,
        oPointsPlayed: 1,
        oPointsWon: 1,
        dPointsPlayed: 0,
        dPointsWon: 0,
      },
      fmp: {
        matchup: 'fmp',
        pointsPlayed: 1,
        pointsWon: 0,
        oPointsPlayed: 0,
        oPointsWon: 0,
        dPointsPlayed: 1,
        dPointsWon: 0,
      },
      unclassifiedPoints: 0,
    });
  });
});
