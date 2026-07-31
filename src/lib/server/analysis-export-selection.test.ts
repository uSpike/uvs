import { describe, expect, it } from 'vitest';
import { selectAnalysisExportGameIds } from './analysis-export-selection';

describe('event analysis-export game selection', () => {
  const available = [30, 10, 20];

  it('selects every game when no selector is supplied', () => {
    expect(selectAnalysisExportGameIds(new URLSearchParams(), available)).toEqual(available);
  });

  it('ignores the independently selected download representation', () => {
    const query = new URLSearchParams('games=30,20&format=markdown');
    expect(selectAnalysisExportGameIds(query, available)).toEqual([30, 20]);
  });

  it('accepts repeated gameId parameters in event chronology', () => {
    const query = new URLSearchParams('gameId=20&gameId=30&gameId=20');
    expect(selectAnalysisExportGameIds(query, available)).toEqual([30, 20]);
  });

  it('accepts comma-separated games and mixed selector forms', () => {
    const query = new URLSearchParams('games=20%2C30&gameId=10');
    expect(selectAnalysisExportGameIds(query, available)).toEqual([30, 10, 20]);
  });

  it.each([
    'games=',
    'games=10%2C',
    'games=10%2C%2C20',
    'gameId=',
  ])('rejects an empty selection token: %s', (query) => {
    expect(() =>
      selectAnalysisExportGameIds(new URLSearchParams(query), available)
    ).toThrow('Select at least one valid game to export.');
  });

  it.each([
    'gameId=0',
    'gameId=-1',
    'gameId=1.5',
    'gameId=1e2',
    'games=10%2Cword',
  ])('rejects a non-positive-integer selection: %s', (query) => {
    expect(() =>
      selectAnalysisExportGameIds(new URLSearchParams(query), available)
    ).toThrow('Game selections must be positive integer IDs.');
  });

  it('rejects games outside the event', () => {
    expect(() =>
      selectAnalysisExportGameIds(
        new URLSearchParams('games=10%2C99'),
        available,
      )
    ).toThrow('Selected game does not belong to this event.');
  });

  it('allows an empty event only when no explicit selection is supplied', () => {
    expect(selectAnalysisExportGameIds(new URLSearchParams(), [])).toEqual([]);
    expect(() =>
      selectAnalysisExportGameIds(new URLSearchParams('gameId=1'), [])
    ).toThrow('Selected game does not belong to this event.');
  });
});
