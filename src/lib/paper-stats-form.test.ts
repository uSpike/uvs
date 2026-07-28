import { describe, expect, it } from 'vitest';
import {
  cumulativePaperPointScores,
  optionalPaperStatistic,
  paperPointScoringSides,
  paperStatisticOrZero,
} from './paper-stats-form';

describe('paper stats form values', () => {
  it('round-trips scoring sides with nonzero initial scores', () => {
    const scores = [
      { ourScore: 4, opponentScore: 2 },
      { ourScore: 4, opponentScore: 3 },
      { ourScore: 5, opponentScore: 3 },
    ];

    expect(paperPointScoringSides(3, 2, scores)).toEqual([true, false, true]);
    expect(cumulativePaperPointScores(3, 2, [true, false, true])).toEqual(scores);
  });

  it('recalculates every later score when a scoring side changes or a point is removed', () => {
    expect(cumulativePaperPointScores(0, 0, [false, true])).toEqual([
      { ourScore: 0, opponentScore: 1 },
      { ourScore: 1, opponentScore: 1 },
    ]);
    expect(cumulativePaperPointScores(0, 0, [true])).toEqual([
      { ourScore: 1, opponentScore: 0 },
    ]);
  });

  it('rejects a persisted score sequence that cannot be represented by one scoring side', () => {
    expect(() =>
      paperPointScoringSides(0, 0, [{ ourScore: 1, opponentScore: 1 }]),
    ).toThrow('Paper point 1 score must add exactly one goal');
  });

  it('renders zero as blank and normalizes blank back to zero', () => {
    expect(optionalPaperStatistic(0)).toBeUndefined();
    expect(optionalPaperStatistic(3)).toBe(3);
    expect(paperStatisticOrZero(undefined)).toBe(0);
    expect(paperStatisticOrZero(3)).toBe(3);
  });
});
