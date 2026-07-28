import { describe, expect, it } from 'vitest';
import type { PlayerStatistics, StatisticsCoverage } from './game-stats';
import { mergeSelectedPlayerStatistics } from './player-stat-selection';

function statistics(values: {
  gamesPlayed: number;
  pointsPlayed: number;
  goals: number;
}): PlayerStatistics {
  return {
    playerId: 7,
    playerName: 'Jordan',
    gamesPlayed: values.gamesPlayed,
    pointsPlayed: values.pointsPlayed,
    goals: values.goals,
    assists: values.goals + 1,
  } as PlayerStatistics;
}

function coverage(values: Partial<StatisticsCoverage>): StatisticsCoverage {
  return {
    gameCount: 1,
    playByPlayGames: 0,
    paperPlayerGames: 0,
    paperPointGames: 0,
    ...values,
  };
}

describe('mergeSelectedPlayerStatistics', () => {
  it('sums selected player rows and their game coverage', () => {
    const template = statistics({ gamesPlayed: 9, pointsPlayed: 99, goals: 99 });
    const first = statistics({ gamesPlayed: 1, pointsPlayed: 8, goals: 2 });
    const second = statistics({ gamesPlayed: 1, pointsPlayed: 5, goals: 1 });

    const merged = mergeSelectedPlayerStatistics(template, [
      { statistics: first, coverage: coverage({ playByPlayGames: 1 }) },
      {
        statistics: second,
        coverage: coverage({ paperPlayerGames: 1, paperPointGames: 1 }),
      },
    ]);

    expect(merged.total).toMatchObject({
      playerId: 7,
      playerName: 'Jordan',
      gamesPlayed: 2,
      pointsPlayed: 13,
      goals: 3,
      assists: 5,
    });
    expect(merged.coverage).toEqual({
      gameCount: 2,
      playByPlayGames: 1,
      paperPlayerGames: 1,
      paperPointGames: 1,
    });
    expect(template.pointsPlayed).toBe(99);
    expect(first.pointsPlayed).toBe(8);
  });

  it('returns zero numeric totals and coverage for an empty selection', () => {
    const merged = mergeSelectedPlayerStatistics(
      statistics({ gamesPlayed: 3, pointsPlayed: 20, goals: 4 }),
      [],
    );

    expect(merged.total).toMatchObject({
      playerId: 7,
      playerName: 'Jordan',
      gamesPlayed: 0,
      pointsPlayed: 0,
      goals: 0,
      assists: 0,
    });
    expect(merged.coverage).toEqual({
      gameCount: 0,
      playByPlayGames: 0,
      paperPlayerGames: 0,
      paperPointGames: 0,
    });
  });
});
