import type { PlayerStatistics, StatisticsCoverage } from './game-stats';

/** One game's player statistics and game-level coverage used by season filtering. */
export interface SelectablePlayerGameStatistics {
  statistics: PlayerStatistics;
  coverage: StatisticsCoverage;
}

/** Player totals and coverage merged from the currently selected games. */
export interface SelectedPlayerStatistics {
  total: PlayerStatistics;
  coverage: StatisticsCoverage;
}

/**
 * Merge one player's per-game statistics without mutating the server-provided rows.
 *
 * The template supplies the complete PlayerStatistics shape and stable player identity.
 * Every other numeric field starts at zero so an empty selection has useful totals.
 */
export function mergeSelectedPlayerStatistics(
  template: PlayerStatistics,
  games: SelectablePlayerGameStatistics[],
): SelectedPlayerStatistics {
  const total = { ...template };
  const mutableTotal = total as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(total)) {
    if (key !== 'playerId' && typeof value === 'number') mutableTotal[key] = 0;
  }

  const coverage: StatisticsCoverage = {
    gameCount: 0,
    playByPlayGames: 0,
    paperPlayerGames: 0,
    paperPointGames: 0,
  };
  for (const game of games) {
    for (const [key, value] of Object.entries(game.statistics)) {
      if (key === 'playerId' || typeof value !== 'number') continue;
      const current = mutableTotal[key];
      if (typeof current === 'number') mutableTotal[key] = current + value;
    }
    coverage.gameCount += game.coverage.gameCount;
    coverage.playByPlayGames += game.coverage.playByPlayGames;
    coverage.paperPlayerGames += game.coverage.paperPlayerGames;
    coverage.paperPointGames += game.coverage.paperPointGames;
  }
  return { total, coverage };
}
