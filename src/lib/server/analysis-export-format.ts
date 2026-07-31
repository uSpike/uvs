/** Download representations supported by the statistics analysis endpoints. */
export type AnalysisExportFormat = 'json' | 'markdown';

/**
 * Resolve an optional analysis-export format selector.
 *
 * JSON remains the default so existing download URLs keep their current
 * behavior. The selector is deliberately strict so a mistyped format never
 * downloads content under an unexpected file type.
 */
export function selectAnalysisExportFormat(
  searchParams: URLSearchParams,
): AnalysisExportFormat {
  const requested = searchParams.getAll('format');
  if (requested.length === 0) return 'json';
  if (requested.length !== 1) {
    throw new Error('Select one analysis export format: json or markdown.');
  }
  if (requested[0] === 'json' || requested[0] === 'markdown') {
    return requested[0];
  }
  throw new Error('Analysis export format must be json or markdown.');
}
