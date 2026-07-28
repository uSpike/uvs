import { describe, expect, it } from 'vitest';
import type { TrackingGameData } from './game-stats';
import {
  createGameStatisticsExport,
  parseGameStatisticsExport,
} from './game-stat-transfer';

const EXPORTED_AT = '2026-07-28T12:00:00.000Z';

function gameData(): TrackingGameData {
  return {
    game: {
      id: 1,
      token: 'portable-stat-test',
      title: 'Pool play',
      teamName: 'Union',
      teamSlug: 'union',
      tournamentId: 1,
      tournamentName: 'Summer Invite',
      opponentName: 'Rivals',
      playedAt: '2026-07-27T15:00:00.000Z',
      hasVideo: false,
      expectedPlayerCount: 7,
      initialOurScore: 0,
      initialOpponentScore: 0,
      initialLineupEndzone: 'left',
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
    ],
    lines: [{ id: 1, name: 'O line', suggestedPlayerIds: [1, 2] }],
    strategies: [],
    points: [],
    standaloneEvents: [],
    highlights: [],
    manualPlayerStatistics: [
      {
        playerId: 1,
        pointsPlayed: 1,
        hockeyAssists: 0,
        assists: 1,
        goals: 0,
        blocks: 0,
      },
      {
        playerId: 2,
        pointsPlayed: 1,
        hockeyAssists: 0,
        assists: 0,
        goals: 1,
        blocks: 0,
      },
    ],
    manualPoints: [{
      id: 1,
      sequenceNumber: 1,
      lineId: 1,
      startingPossession: 'offense',
      initialDefenseType: null,
      offenseStrategyId: null,
      defenseStrategyId: null,
      ourTurnovers: 0,
      scoringMethod: 'Open-side strike',
      throwerPlayerId: 1,
      receiverPlayerId: 2,
      ourScore: 1,
      opponentScore: 0,
    }],
  };
}

describe('game statistics transfer', () => {
  it('exports and parses paper goal thrower and receiver attribution in version two', () => {
    const exported = createGameStatisticsExport(gameData(), EXPORTED_AT);

    expect(exported).toMatchObject({
      version: 2,
      statistics: {
        manualPoints: [{
          throwerPlayerId: 1,
          receiverPlayerId: 2,
        }],
      },
    });
    expect(exported.statistics.manualPoints[0]).not.toHaveProperty('scorerPlayerId');

    const parsed = parseGameStatisticsExport(
      JSON.parse(JSON.stringify(exported)) as unknown,
    );
    expect(parsed).toEqual(exported);
  });

  it('normalizes a legacy version-one scorer as the receiver with no known thrower', () => {
    const current = createGameStatisticsExport(gameData(), EXPORTED_AT);
    const {
      throwerPlayerId: _throwerPlayerId,
      receiverPlayerId,
      ...legacyPoint
    } = current.statistics.manualPoints[0];
    const legacy = {
      ...current,
      version: 1,
      statistics: {
        ...current.statistics,
        manualPoints: [{
          ...legacyPoint,
          scorerPlayerId: receiverPlayerId,
        }],
      },
    };

    const parsed = parseGameStatisticsExport(legacy);

    expect(parsed.version).toBe(2);
    expect(parsed.statistics.manualPoints[0]).toMatchObject({
      throwerPlayerId: null,
      receiverPlayerId: 2,
    });
    expect(parsed.statistics.manualPoints[0]).not.toHaveProperty('scorerPlayerId');
  });

  it('rejects unsupported format versions', () => {
    const exported = createGameStatisticsExport(gameData(), EXPORTED_AT);

    expect(() => parseGameStatisticsExport({ ...exported, version: 3 }))
      .toThrow('Statistics file version 3 is not supported.');
  });
});
