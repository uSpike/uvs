/** Preferred gender matchup role used for mixed-line point classification. */
export type MatchupRole = 'mmp' | 'fmp';

/** Parse a matchup role at an input boundary. */
export function parseMatchupRole(value: unknown, field = 'Matchup role'): MatchupRole {
  if (value === 'mmp' || value === 'fmp') return value;
  throw new Error(`${field} must be MMP or FMP.`);
}

/** Parse a nullable role override at an input boundary. */
export function parseOptionalMatchupRole(
  value: unknown,
  field = 'Matchup role override',
): MatchupRole | null {
  if (value === null || value === undefined || value === '') return null;
  return parseMatchupRole(value, field);
}
