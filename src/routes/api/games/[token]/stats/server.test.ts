import { describe, expect, it } from 'vitest';
import { _parseManualSummaryInput } from './+server';

describe('paper statistics request parsing', () => {
  it('defaults blank player totals and point turnovers to zero', () => {
    const parsed = _parseManualSummaryInput({
      playerStatistics: [{
        playerId: 7,
        pointsPlayed: '',
        hockeyAssists: null,
        goals: 2,
      }],
      points: [{
        lineId: 3,
        startingPossession: 'offense',
        ourTurnovers: '',
        ourScore: 1,
        opponentScore: 0,
      }],
    });

    expect(parsed.playerStatistics).toEqual([{
      playerId: 7,
      pointsPlayed: 0,
      hockeyAssists: 0,
      assists: 0,
      goals: 2,
      blocks: 0,
    }]);
    expect(parsed.points[0]).toMatchObject({
      ourTurnovers: 0,
      ourScore: 1,
      opponentScore: 0,
    });
  });

  it.each([-1, 1.5, false, '2'])('rejects invalid paper counts: %j', (value) => {
    expect(() =>
      _parseManualSummaryInput({
        playerStatistics: [{
          playerId: 7,
          pointsPlayed: value,
        }],
        points: [],
      }),
    ).toThrow('Points played is invalid.');
  });
});
