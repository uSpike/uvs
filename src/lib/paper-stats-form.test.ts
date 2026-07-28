import { describe, expect, it } from 'vitest';
import {
  classifyPaperPoints,
  optionalPaperStatistic,
  paperPointScoringSides,
  paperStatisticOrZero,
} from './paper-stats-form';

describe('paper stats form values', () => {
  it('classifies scoring sides and later O/D starts with nonzero initial scores', () => {
    const scores = [
      { ourScore: 4, opponentScore: 2 },
      { ourScore: 4, opponentScore: 3 },
      { ourScore: 5, opponentScore: 3 },
    ];

    expect(classifyPaperPoints(3, 2, 'offense', scores)).toEqual([
      { startingPossession: 'offense', scoringSide: 'us' },
      { startingPossession: 'defense', scoringSide: 'opponent' },
      { startingPossession: 'offense', scoringSide: 'us' },
    ]);
    expect(paperPointScoringSides(3, 2, scores)).toEqual([true, false, true]);
  });

  it('keeps consecutive breaks on D and consecutive breaks against on O', () => {
    expect(classifyPaperPoints(0, 0, 'defense', [
      { ourScore: 1, opponentScore: 0 },
      { ourScore: 2, opponentScore: 0 },
    ])).toEqual([
      { startingPossession: 'defense', scoringSide: 'us' },
      { startingPossession: 'defense', scoringSide: 'us' },
    ]);

    expect(classifyPaperPoints(0, 0, 'offense', [
      { ourScore: 0, opponentScore: 1 },
      { ourScore: 0, opponentScore: 2 },
    ])).toEqual([
      { startingPossession: 'offense', scoringSide: 'opponent' },
      { startingPossession: 'offense', scoringSide: 'opponent' },
    ]);
  });

  it('marks an invalid score and the following O/D start as unavailable', () => {
    expect(classifyPaperPoints(0, 0, 'offense', [
      { ourScore: 1, opponentScore: 1 },
      { ourScore: 2, opponentScore: 1 },
    ])).toEqual([
      { startingPossession: 'offense', scoringSide: null },
      { startingPossession: null, scoringSide: 'us' },
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
