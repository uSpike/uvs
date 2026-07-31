import { describe, expect, it } from 'vitest';
import { selectAnalysisExportFormat } from './analysis-export-format';

describe('analysis export format selection', () => {
  it('keeps JSON as the default for existing URLs', () => {
    expect(selectAnalysisExportFormat(new URLSearchParams())).toBe('json');
  });

  it.each([
    ['json', 'json'],
    ['markdown', 'markdown'],
  ] as const)('selects the explicit %s representation', (requested, expected) => {
    expect(
      selectAnalysisExportFormat(new URLSearchParams({ format: requested })),
    ).toBe(expected);
  });

  it.each([
    new URLSearchParams({ format: 'csv' }),
    new URLSearchParams({ format: '' }),
    new URLSearchParams('format=json&format=markdown'),
  ])('rejects an unsupported or ambiguous selector', (searchParams) => {
    expect(() => selectAnalysisExportFormat(searchParams)).toThrow(
      /json or markdown/,
    );
  });
});
