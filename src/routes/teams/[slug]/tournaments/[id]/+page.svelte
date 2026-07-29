<script lang="ts">
  import { ArrowLeft, BarChart3, ChevronDown, ClipboardList, ExternalLink, Play } from '@lucide/svelte';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import GamePaperStatsDialog from '$lib/GamePaperStatsDialog.svelte';
  import GameStatsTransferControl from '$lib/GameStatsTransferControl.svelte';
  import { mergeGameStatistics } from '$lib/game-stats';
  import { STAT_DESCRIPTIONS as statHelp } from '$lib/stat-descriptions';
  import {
    compareTableSortValues,
    initialTableSortDirection,
    type TableSortDirection,
    type TableSortValue,
  } from '$lib/table-sort';

  let { data } = $props();
  type PlayerStatistics = typeof data.statistics.playerStatistics[number];
  type LineStatistics = typeof data.statistics.lineStatistics[number];
  type ConnectionStatistics = typeof data.statistics.connectionStatistics[number];
  type StatisticsTab = 'summary' | 'offense' | 'defense' | 'playing-time' | 'averages';
  type PlayerSortKey =
    | keyof PlayerStatistics
    | 'oWinPercentage' | 'dWinPercentage'
    | 'passingPercentage' | 'oPassingPercentage' | 'dPassingPercentage'
    | 'receivingPercentage' | 'turnoversPerTouch'
    | 'timePerPointMs' | 'discPerPointMs' | 'minutesPerGame' | 'pointsPerGame'
    | 'goalsPerTen' | 'assistsPerTen' | 'hockeyAssistsPerTen' | 'blocksPerTen'
    | 'turnoversPerTen' | 'completionsPerTen' | 'touchesPerTen';
  type LineSortKey =
    | 'lineName' | 'timePlayedMs' | 'pointsPlayed'
    | 'oPointsPlayed' | 'oWinPercentage' | 'dPointsPlayed' | 'dWinPercentage'
    | 'cleanHolds' | 'defensiveConversionPercentage'
    | 'completions' | 'turnovers' | 'blocks' | 'goalsFor' | 'goalsAgainst' | 'plusMinus';
  type ConnectionSortKey =
    | 'throwerName' | 'receiverName' | 'attempts' | 'completions'
    | 'completionPercentage' | 'goals' | 'turnovers';

  let statisticsTab = $state<StatisticsTab>('summary');
  let playerSortKey = $state<PlayerSortKey | null>(null);
  let playerSortDirection = $state<TableSortDirection>('ascending');
  let lineSortKey = $state<LineSortKey | null>(null);
  let lineSortDirection = $state<TableSortDirection>('ascending');
  let connectionSortKey = $state<ConnectionSortKey | null>(null);
  let connectionSortDirection = $state<TableSortDirection>('ascending');
  let excludedGameIds = $state<number[]>([]);
  let availableGameCount = $derived(
    data.games.filter((game) => game.statistics !== null).length,
  );
  let includedGameCount = $derived(
    data.games.filter(
      (game) => game.statistics !== null && !excludedGameIds.includes(game.id),
    ).length,
  );
  let eventStatistics = $derived.by(() =>
    mergeGameStatistics(
      data.games.flatMap((game) =>
        game.statistics !== null && !excludedGameIds.includes(game.id)
          ? [game.statistics]
          : [],
      ),
      data.aggregatePlayers,
      data.aggregateLines,
    ),
  );

  const duration = (milliseconds: number): string => {
    const seconds = Math.round(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const pct = (won: number, played: number): string =>
    played === 0 ? '—' : `${Math.round((won / played) * 100)}%`;
  const passingPct = (attempts: number, passerTurnovers: number): string =>
    pct(attempts - passerTurnovers, attempts);
  const signed = (value: number): string => `${value > 0 ? '+' : ''}${value}`;
  const average = (value: number, count: number): string =>
    count === 0 ? '—' : (value / count).toFixed(1);
  const perTen = (value: number, pointsPlayed: number): string =>
    pointsPlayed === 0 ? '—' : ((value / pointsPlayed) * 10).toFixed(1);
  const averageDuration = (milliseconds: number, count: number): string =>
    count === 0 ? '—' : duration(milliseconds / count);

  function selectStatisticsTab(tab: StatisticsTab): void {
    statisticsTab = tab;
    playerSortKey = null;
  }

  function gameIncludedInTotals(gameId: number): boolean {
    return !excludedGameIds.includes(gameId);
  }

  function setGameIncludedInTotals(gameId: number, included: boolean): void {
    excludedGameIds = included
      ? excludedGameIds.filter((candidate) => candidate !== gameId)
      : excludedGameIds.includes(gameId)
        ? excludedGameIds
        : [...excludedGameIds, gameId];
  }

  function togglePlayerSort(key: PlayerSortKey, kind: 'text' | 'number'): void {
    if (playerSortKey === key) {
      playerSortDirection = playerSortDirection === 'ascending' ? 'descending' : 'ascending';
    } else {
      playerSortKey = key;
      playerSortDirection = initialTableSortDirection(kind);
    }
  }

  function toggleLineSort(key: LineSortKey, kind: 'text' | 'number'): void {
    if (lineSortKey === key) {
      lineSortDirection = lineSortDirection === 'ascending' ? 'descending' : 'ascending';
    } else {
      lineSortKey = key;
      lineSortDirection = initialTableSortDirection(kind);
    }
  }

  function toggleConnectionSort(key: ConnectionSortKey, kind: 'text' | 'number'): void {
    if (connectionSortKey === key) {
      connectionSortDirection =
        connectionSortDirection === 'ascending' ? 'descending' : 'ascending';
    } else {
      connectionSortKey = key;
      connectionSortDirection = initialTableSortDirection(kind);
    }
  }

  function sortedPlayerStatistics(rows: PlayerStatistics[]): PlayerStatistics[] {
    if (playerSortKey === null) return rows;
    const key = playerSortKey;
    return [...rows].sort((left, right) =>
      compareTableSortValues(
        playerSortValue(left, key),
        playerSortValue(right, key),
        playerSortDirection,
      ) || left.playerName.localeCompare(right.playerName)
    );
  }

  function visiblePlayerStatistics(
    statistics: typeof data.statistics,
  ): PlayerStatistics[] {
    return statistics.playerStatistics.filter((stats) => stats.gamesPlayed > 0);
  }

  function sortedLineStatistics(rows: LineStatistics[]): LineStatistics[] {
    if (lineSortKey === null) return rows;
    const key = lineSortKey;
    return [...rows].sort((left, right) =>
      compareTableSortValues(
        lineSortValue(left, key),
        lineSortValue(right, key),
        lineSortDirection,
      ) || left.lineName.localeCompare(right.lineName)
    );
  }

  function sortedConnectionStatistics(rows: ConnectionStatistics[]): ConnectionStatistics[] {
    if (connectionSortKey === null) return rows;
    const key = connectionSortKey;
    return [...rows].sort((left, right) =>
      compareTableSortValues(
        connectionSortValue(left, key),
        connectionSortValue(right, key),
        connectionSortDirection,
      ) ||
      left.throwerName.localeCompare(right.throwerName) ||
      left.receiverName.localeCompare(right.receiverName)
    );
  }

  function playerSortValue(stats: PlayerStatistics, key: PlayerSortKey): TableSortValue {
    if (key === 'oWinPercentage') {
      return stats.oPointsPlayed === 0 ? null : stats.oPointsWon / stats.oPointsPlayed;
    }
    if (key === 'dWinPercentage') {
      return stats.dPointsPlayed === 0 ? null : stats.dPointsWon / stats.dPointsPlayed;
    }
    if (key === 'passingPercentage') {
      return stats.throwingAttempts === 0
        ? null
        : (stats.throwingAttempts - stats.passerTurnovers) / stats.throwingAttempts;
    }
    if (key === 'oPassingPercentage') {
      return stats.oThrowingAttempts === 0
        ? null
        : (stats.oThrowingAttempts - stats.oPasserTurnovers) / stats.oThrowingAttempts;
    }
    if (key === 'dPassingPercentage') {
      return stats.dThrowingAttempts === 0
        ? null
        : (stats.dThrowingAttempts - stats.dPasserTurnovers) / stats.dThrowingAttempts;
    }
    if (key === 'receivingPercentage') {
      return stats.receivingTargets === 0 ? null : stats.receptions / stats.receivingTargets;
    }
    if (key === 'turnoversPerTouch') {
      return stats.touches === 0 ? null : stats.turnovers / stats.touches;
    }
    if (key === 'timePerPointMs') {
      return stats.pointsPlayed === 0 ? null : stats.timePlayedMs / stats.pointsPlayed;
    }
    if (key === 'discPerPointMs') {
      return stats.pointsPlayed === 0 ? null : stats.timeWithDiscMs / stats.pointsPlayed;
    }
    if (key === 'minutesPerGame') {
      return stats.gamesPlayed === 0 ? null : stats.timePlayedMs / stats.gamesPlayed;
    }
    if (key === 'pointsPerGame') {
      return stats.gamesPlayed === 0 ? null : stats.pointsPlayed / stats.gamesPlayed;
    }
    const perTenField = {
      goalsPerTen: 'goals',
      assistsPerTen: 'assists',
      hockeyAssistsPerTen: 'hockeyAssists',
      blocksPerTen: 'blocks',
      turnoversPerTen: 'turnovers',
      completionsPerTen: 'completions',
      touchesPerTen: 'touches',
    } as const;
    if (key in perTenField) {
      return stats.pointsPlayed === 0
        ? null
        : (stats[perTenField[key as keyof typeof perTenField]] / stats.pointsPlayed) * 10;
    }
    return stats[key as keyof PlayerStatistics];
  }

  function lineSortValue(stats: LineStatistics, key: LineSortKey): TableSortValue {
    if (key === 'oWinPercentage') {
      return stats.oPointsPlayed === 0 ? null : stats.oPointsWon / stats.oPointsPlayed;
    }
    if (key === 'dWinPercentage') {
      return stats.dPointsPlayed === 0 ? null : stats.dPointsWon / stats.dPointsPlayed;
    }
    if (key === 'defensiveConversionPercentage') {
      return stats.defensiveConversionOpportunities === 0
        ? null
        : stats.defensiveConversions / stats.defensiveConversionOpportunities;
    }
    return stats[key];
  }

  function connectionSortValue(
    stats: ConnectionStatistics,
    key: ConnectionSortKey,
  ): TableSortValue {
    if (key === 'completionPercentage') {
      return stats.attempts === 0 ? null : stats.completions / stats.attempts;
    }
    return stats[key];
  }
</script>

{#snippet playerHeader(key: PlayerSortKey, label: string, title: string, kind: 'text' | 'number')}
  <th {title} aria-sort={playerSortKey === key ? playerSortDirection : 'none'}>
    <button
      class="sort-column"
      class:active={playerSortKey === key}
      type="button"
      aria-label={`Sort players by ${label}`}
      onclick={() => togglePlayerSort(key, kind)}
    ><span>{label}</span><small aria-hidden="true">{playerSortKey === key ? (playerSortDirection === 'ascending' ? '▲' : '▼') : '↕'}</small></button>
  </th>
{/snippet}

{#snippet lineHeader(key: LineSortKey, label: string, title: string, kind: 'text' | 'number')}
  <th {title} aria-sort={lineSortKey === key ? lineSortDirection : 'none'}>
    <button
      class="sort-column"
      class:active={lineSortKey === key}
      type="button"
      aria-label={`Sort lines by ${label}`}
      onclick={() => toggleLineSort(key, kind)}
    ><span>{label}</span><small aria-hidden="true">{lineSortKey === key ? (lineSortDirection === 'ascending' ? '▲' : '▼') : '↕'}</small></button>
  </th>
{/snippet}

{#snippet connectionHeader(key: ConnectionSortKey, label: string, title: string, kind: 'text' | 'number')}
  <th {title} aria-sort={connectionSortKey === key ? connectionSortDirection : 'none'}>
    <button
      class="sort-column"
      class:active={connectionSortKey === key}
      type="button"
      aria-label={`Sort connections by ${label}`}
      onclick={() => toggleConnectionSort(key, kind)}
    ><span>{label}</span><small aria-hidden="true">{connectionSortKey === key ? (connectionSortDirection === 'ascending' ? '▲' : '▼') : '↕'}</small></button>
  </th>
{/snippet}

{#snippet statisticsSections(statistics: typeof data.statistics)}
  {#if statisticsTab === 'summary'}
    <section class="stats-section">
      <header><h2>Team efficiency</h2><span>Point and possession outcomes</span></header>
      <div class="team-summary">
        <div title={statHelp.holdRate}><span>Hold rate</span><strong>{pct(statistics.teamStatistics.oPointsWon, statistics.teamStatistics.oPointsPlayed)}</strong><small>{statistics.teamStatistics.oPointsWon}/{statistics.teamStatistics.oPointsPlayed} O points</small></div>
        <div title={statHelp.cleanHolds}><span>Clean holds</span><strong>{statistics.teamStatistics.cleanHolds}</strong><small>No turnovers</small></div>
        <div title={statHelp.breakRate}><span>Break rate</span><strong>{pct(statistics.teamStatistics.dPointsWon, statistics.teamStatistics.dPointsPlayed)}</strong><small>{statistics.teamStatistics.dPointsWon}/{statistics.teamStatistics.dPointsPlayed} D points</small></div>
        <div title={statHelp.defensiveConversion}><span>D conversion</span><strong>{pct(statistics.teamStatistics.defensiveConversions, statistics.teamStatistics.defensiveConversionOpportunities)}</strong><small>{statistics.teamStatistics.defensiveConversions}/{statistics.teamStatistics.defensiveConversionOpportunities} possessions</small></div>
      </div>
    </section>

    <section class="stats-section">
      <header><h2 title={statHelp.matchupPoints}>Preferred matchup points</h2><span>{statistics.matchupStatistics.unclassifiedPoints} unclassified</span></header>
      <div class="matchup-summary">
        {#each [statistics.matchupStatistics.mmp, statistics.matchupStatistics.fmp] as stats}
          <div class:mmp={stats.matchup === 'mmp'} class:fmp={stats.matchup === 'fmp'}>
            <strong>{stats.matchup.toUpperCase()}</strong>
            <span>{stats.pointsWon}/{stats.pointsPlayed} won · {pct(stats.pointsWon, stats.pointsPlayed)}</span>
            <small title={`${statHelp.offenseWinPercentage} ${statHelp.defenseWinPercentage}`}>Offense {stats.oPointsWon}/{stats.oPointsPlayed} · Defense {stats.dPointsWon}/{stats.dPointsPlayed}</small>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <section class="stats-section">
    <header>
      <h2>{statisticsTab === 'summary' ? 'Player summary' : statisticsTab === 'offense' ? 'Offense' : statisticsTab === 'defense' ? 'Defense' : statisticsTab === 'playing-time' ? 'Playing time' : 'Per-game and per-10-point averages'}</h2>
      <span>{statisticsTab === 'summary' ? 'Scoring passes count as completions' : statisticsTab === 'offense' ? 'Points that began with our team receiving' : statisticsTab === 'defense' ? 'Points that began with our team pulling' : statisticsTab === 'playing-time' ? 'Participation and disc time' : 'Rate stats normalize different amounts of playing time'}</span>
    </header>
    <div class="table-scroll"><table><thead><tr>
      {@render playerHeader('playerName', 'Player', 'Player name', 'text')}
      {#if statisticsTab === 'summary'}
        {@render playerHeader('pointsPlayed', 'Pts', statHelp.pointsPlayed, 'number')}
        {@render playerHeader('plusMinus', '+/−', statHelp.plusMinus, 'number')}
        {@render playerHeader('extendedPlusMinus', 'Ext +/−', statHelp.extendedPlusMinus, 'number')}
        {@render playerHeader('passingPercentage', 'Pass%', statHelp.passingPercentage, 'number')}
        {@render playerHeader('goals', 'G', statHelp.goals, 'number')}
        {@render playerHeader('assists', 'A', statHelp.assists, 'number')}
        {@render playerHeader('hockeyAssists', '2A', statHelp.hockeyAssists, 'number')}
        {@render playerHeader('blocks', 'Ds', statHelp.blocks, 'number')}
        {@render playerHeader('completions', 'C', statHelp.completions, 'number')}
        {@render playerHeader('drops', 'Drp', statHelp.drops, 'number')}
        {@render playerHeader('passerTurnovers', 'Pass TO', statHelp.passerTurnovers, 'number')}
        {@render playerHeader('turnovers', 'TO', statHelp.turnovers, 'number')}
        {@render playerHeader('touches', 'Touch', statHelp.touches, 'number')}
      {:else if statisticsTab === 'offense'}
        {@render playerHeader('oPointsPlayed', 'O Pts', statHelp.offensePointsPlayed, 'number')}
        {@render playerHeader('oEfficiency', 'O Eff', statHelp.offenseEfficiency, 'number')}
        {@render playerHeader('oWinPercentage', 'O%', statHelp.offenseWinPercentage, 'number')}
        {@render playerHeader('oGoals', 'G', statHelp.goals, 'number')}
        {@render playerHeader('oAssists', 'A', statHelp.assists, 'number')}
        {@render playerHeader('oHockeyAssists', '2A', statHelp.hockeyAssists, 'number')}
        {@render playerHeader('oCompletions', 'C', statHelp.completions, 'number')}
        {@render playerHeader('oPassingPercentage', 'Pass%', statHelp.passingPercentage, 'number')}
        {@render playerHeader('oThrowaways', 'Thrw', statHelp.throwaways, 'number')}
        {@render playerHeader('oStalls', 'Stall', statHelp.stalls, 'number')}
        {@render playerHeader('oDrops', 'Drp', statHelp.drops, 'number')}
        {@render playerHeader('oPasserTurnovers', 'Pass TO', statHelp.passerTurnovers, 'number')}
        {@render playerHeader('oTurnovers', 'TO', statHelp.turnovers, 'number')}
        {@render playerHeader('oBlocks', 'Ds', statHelp.blocks, 'number')}
        {@render playerHeader('oTouches', 'Touch', statHelp.touches, 'number')}
      {:else if statisticsTab === 'defense'}
        {@render playerHeader('dPointsPlayed', 'D Pts', statHelp.defensePointsPlayed, 'number')}
        {@render playerHeader('dEfficiency', 'D Eff', statHelp.defenseEfficiency, 'number')}
        {@render playerHeader('dWinPercentage', 'D%', statHelp.defenseWinPercentage, 'number')}
        {@render playerHeader('dPointsWon', 'Breaks', statHelp.breaks, 'number')}
        {@render playerHeader('dGoals', 'G', statHelp.goals, 'number')}
        {@render playerHeader('dAssists', 'A', statHelp.assists, 'number')}
        {@render playerHeader('dHockeyAssists', '2A', statHelp.hockeyAssists, 'number')}
        {@render playerHeader('dCompletions', 'C', statHelp.completions, 'number')}
        {@render playerHeader('dPassingPercentage', 'Pass%', statHelp.passingPercentage, 'number')}
        {@render playerHeader('dThrowaways', 'Thrw', statHelp.throwaways, 'number')}
        {@render playerHeader('dStalls', 'Stall', statHelp.stalls, 'number')}
        {@render playerHeader('dDrops', 'Drp', statHelp.drops, 'number')}
        {@render playerHeader('dPasserTurnovers', 'Pass TO', statHelp.passerTurnovers, 'number')}
        {@render playerHeader('dTurnovers', 'TO', statHelp.turnovers, 'number')}
        {@render playerHeader('dBlocks', 'Ds', statHelp.blocks, 'number')}
        {@render playerHeader('dTouches', 'Touch', statHelp.touches, 'number')}
      {:else if statisticsTab === 'playing-time'}
        {@render playerHeader('gamesPlayed', 'Games', statHelp.gamesPlayed, 'number')}
        {@render playerHeader('timePlayedMs', 'Time', statHelp.timePlayed, 'number')}
        {@render playerHeader('pointsPlayed', 'Pts', statHelp.pointsPlayed, 'number')}
        {@render playerHeader('oPointsPlayed', 'O', statHelp.offensePointsPlayed, 'number')}
        {@render playerHeader('dPointsPlayed', 'D', statHelp.defensePointsPlayed, 'number')}
        {@render playerHeader('timePerPointMs', 'Time/Pt', statHelp.timePerPoint, 'number')}
        {@render playerHeader('timeWithDiscMs', 'Disc', statHelp.discTime, 'number')}
        {@render playerHeader('discPerPointMs', 'Disc/Pt', statHelp.discPerPoint, 'number')}
        {@render playerHeader('touches', 'Touch', statHelp.touches, 'number')}
        {@render playerHeader('pulls', 'Pulls', statHelp.pulls, 'number')}
      {:else}
        {@render playerHeader('gamesPlayed', 'Games', statHelp.gamesPlayed, 'number')}
        {@render playerHeader('minutesPerGame', 'Time/G', statHelp.perGame, 'number')}
        {@render playerHeader('pointsPerGame', 'Pts/G', statHelp.perGame, 'number')}
        {@render playerHeader('goalsPerTen', 'G/10', statHelp.perTenPoints, 'number')}
        {@render playerHeader('assistsPerTen', 'A/10', statHelp.perTenPoints, 'number')}
        {@render playerHeader('hockeyAssistsPerTen', '2A/10', statHelp.perTenPoints, 'number')}
        {@render playerHeader('blocksPerTen', 'Ds/10', statHelp.perTenPoints, 'number')}
        {@render playerHeader('turnoversPerTen', 'TO/10', statHelp.perTenPoints, 'number')}
        {@render playerHeader('completionsPerTen', 'C/10', statHelp.perTenPoints, 'number')}
        {@render playerHeader('touchesPerTen', 'Touch/10', statHelp.perTenPoints, 'number')}
        {@render playerHeader('discPerPointMs', 'Disc/Pt', statHelp.discPerPoint, 'number')}
      {/if}
    </tr></thead><tbody>
      {#each sortedPlayerStatistics(visiblePlayerStatistics(statistics)) as stats}
        <tr>
          <th><a href={resolve(`/teams/${data.tournament.teamSlug}/players/${stats.playerId}`)}>{stats.playerName}</a></th>
          {#if statisticsTab === 'summary'}
            <td>{stats.pointsPlayed}</td><td>{signed(stats.plusMinus)}</td><td>{signed(stats.extendedPlusMinus)}</td><td>{passingPct(stats.throwingAttempts, stats.passerTurnovers)}</td><td>{stats.goals}</td><td>{stats.assists}</td><td>{stats.hockeyAssists}</td><td>{stats.blocks}</td><td>{stats.completions}</td><td>{stats.drops}</td><td>{stats.passerTurnovers}</td><td>{stats.turnovers}</td><td>{stats.touches}</td>
          {:else if statisticsTab === 'offense'}
            <td>{stats.oPointsPlayed}</td><td>{signed(stats.oEfficiency)}</td><td>{pct(stats.oPointsWon, stats.oPointsPlayed)}</td><td>{stats.oGoals}</td><td>{stats.oAssists}</td><td>{stats.oHockeyAssists}</td><td>{stats.oCompletions}</td><td>{passingPct(stats.oThrowingAttempts, stats.oPasserTurnovers)}</td><td>{stats.oThrowaways}</td><td>{stats.oStalls}</td><td>{stats.oDrops}</td><td>{stats.oPasserTurnovers}</td><td>{stats.oTurnovers}</td><td>{stats.oBlocks}</td><td>{stats.oTouches}</td>
          {:else if statisticsTab === 'defense'}
            <td>{stats.dPointsPlayed}</td><td>{signed(stats.dEfficiency)}</td><td>{pct(stats.dPointsWon, stats.dPointsPlayed)}</td><td>{stats.dPointsWon}</td><td>{stats.dGoals}</td><td>{stats.dAssists}</td><td>{stats.dHockeyAssists}</td><td>{stats.dCompletions}</td><td>{passingPct(stats.dThrowingAttempts, stats.dPasserTurnovers)}</td><td>{stats.dThrowaways}</td><td>{stats.dStalls}</td><td>{stats.dDrops}</td><td>{stats.dPasserTurnovers}</td><td>{stats.dTurnovers}</td><td>{stats.dBlocks}</td><td>{stats.dTouches}</td>
          {:else if statisticsTab === 'playing-time'}
            <td>{stats.gamesPlayed}</td><td>{duration(stats.timePlayedMs)}</td><td>{stats.pointsPlayed}</td><td>{stats.oPointsPlayed}</td><td>{stats.dPointsPlayed}</td><td>{averageDuration(stats.timePlayedMs, stats.pointsPlayed)}</td><td>{duration(stats.timeWithDiscMs)}</td><td>{averageDuration(stats.timeWithDiscMs, stats.pointsPlayed)}</td><td>{stats.touches}</td><td>{stats.pulls}</td>
          {:else}
            <td>{stats.gamesPlayed}</td><td>{averageDuration(stats.timePlayedMs, stats.gamesPlayed)}</td><td>{average(stats.pointsPlayed, stats.gamesPlayed)}</td><td>{perTen(stats.goals, stats.pointsPlayed)}</td><td>{perTen(stats.assists, stats.pointsPlayed)}</td><td>{perTen(stats.hockeyAssists, stats.pointsPlayed)}</td><td>{perTen(stats.blocks, stats.pointsPlayed)}</td><td>{perTen(stats.turnovers, stats.pointsPlayed)}</td><td>{perTen(stats.completions, stats.pointsPlayed)}</td><td>{perTen(stats.touches, stats.pointsPlayed)}</td><td>{averageDuration(stats.timeWithDiscMs, stats.pointsPlayed)}</td>
          {/if}
        </tr>
      {:else}
        <tr class="empty-table-row"><td colspan={statisticsTab === 'summary' ? 14 : statisticsTab === 'offense' ? 16 : statisticsTab === 'defense' ? 17 : statisticsTab === 'playing-time' ? 11 : 12}>No player statistics recorded for this table.</td></tr>
      {/each}
    </tbody></table></div>
  </section>

  {#if statisticsTab === 'summary'}
    <section class="stats-section">
      <header><h2>Lines</h2><span>Independent point and event totals</span></header>
      <div class="table-scroll"><table><thead><tr>
        {@render lineHeader('lineName', 'Line', 'Line name', 'text')}
        {@render lineHeader('timePlayedMs', 'Time', statHelp.timePlayed, 'number')}
        {@render lineHeader('pointsPlayed', 'Pts', statHelp.pointsPlayed, 'number')}
        {@render lineHeader('oPointsPlayed', 'O', statHelp.offensePointsPlayed, 'number')}
        {@render lineHeader('oWinPercentage', 'O%', statHelp.offenseWinPercentage, 'number')}
        {@render lineHeader('dPointsPlayed', 'D', statHelp.defensePointsPlayed, 'number')}
        {@render lineHeader('dWinPercentage', 'D%', statHelp.defenseWinPercentage, 'number')}
        {@render lineHeader('cleanHolds', 'CH', statHelp.cleanHolds, 'number')}
        {@render lineHeader('defensiveConversionPercentage', 'DC%', statHelp.defensiveConversion, 'number')}
        {@render lineHeader('completions', 'C', statHelp.completions, 'number')}
        {@render lineHeader('turnovers', 'TO', statHelp.turnovers, 'number')}
        {@render lineHeader('blocks', 'Ds', statHelp.blocks, 'number')}
        {@render lineHeader('goalsFor', 'GF', statHelp.goalsFor, 'number')}
        {@render lineHeader('goalsAgainst', 'GA', statHelp.goalsAgainst, 'number')}
        {@render lineHeader('plusMinus', '+/−', statHelp.plusMinus, 'number')}
      </tr></thead><tbody>
        {#each sortedLineStatistics(statistics.lineStatistics) as stats}
          <tr><th>{stats.lineName}</th><td>{duration(stats.timePlayedMs)}</td><td>{stats.pointsPlayed}</td><td>{stats.oPointsPlayed}</td><td>{pct(stats.oPointsWon, stats.oPointsPlayed)}</td><td>{stats.dPointsPlayed}</td><td>{pct(stats.dPointsWon, stats.dPointsPlayed)}</td><td>{stats.cleanHolds}</td><td>{pct(stats.defensiveConversions, stats.defensiveConversionOpportunities)}</td><td>{stats.completions}</td><td>{stats.turnovers}</td><td>{stats.blocks}</td><td>{stats.goalsFor}</td><td>{stats.goalsAgainst}</td><td>{signed(stats.plusMinus)}</td></tr>
        {/each}
      </tbody></table></div>
    </section>

    <section class="stats-section">
      <header><h2>Connections</h2><span>Known thrower and receiver pairings</span></header>
      {#if statistics.connectionStatistics.length > 0}
        <div class="table-scroll"><table><thead><tr>
          {@render connectionHeader('throwerName', 'Thrower', 'Thrower name', 'text')}
          {@render connectionHeader('receiverName', 'Receiver', 'Receiver name', 'text')}
          {@render connectionHeader('attempts', 'Att', statHelp.connectionAttempts, 'number')}
          {@render connectionHeader('completions', 'C', statHelp.completions, 'number')}
          {@render connectionHeader('completionPercentage', 'C%', statHelp.connectionPercentage, 'number')}
          {@render connectionHeader('goals', 'G', statHelp.goals, 'number')}
          {@render connectionHeader('turnovers', 'TO', statHelp.turnovers, 'number')}
        </tr></thead><tbody>
          {#each sortedConnectionStatistics(statistics.connectionStatistics) as stats}
            <tr><th><a href={resolve(`/teams/${data.tournament.teamSlug}/players/${stats.throwerPlayerId}`)}>{stats.throwerName}</a></th><td><a href={resolve(`/teams/${data.tournament.teamSlug}/players/${stats.receiverPlayerId}`)}>{stats.receiverName}</a></td><td>{stats.attempts}</td><td>{stats.completions}</td><td>{pct(stats.completions, stats.attempts)}</td><td>{stats.goals}</td><td>{stats.turnovers}</td></tr>
          {/each}
        </tbody></table></div>
      {:else}
        <p class="empty-stat">No passes with both players identified yet.</p>
      {/if}
    </section>
  {/if}
{/snippet}

<svelte:head><title>{data.tournament.name} stats - Ultimate Video Stats</title></svelte:head>

<div class="stats-page">
  <a class="back-link" href={resolve(`/teams/${data.tournament.teamSlug}`)}><ArrowLeft size={15} />{data.tournament.teamName}</a>
  <header class="stats-heading">
    <div><h1>{data.tournament.name}</h1><p>{data.tournament.seasonRosterName} · {data.games.length} {data.games.length === 1 ? 'game' : 'games'}</p></div>
    <BarChart3 size={24} aria-hidden="true" />
  </header>

  <nav class="stats-tabs" aria-label="Statistics view">
    <button class:active={statisticsTab === 'summary'} type="button" aria-pressed={statisticsTab === 'summary'} onclick={() => selectStatisticsTab('summary')}>Summary</button>
    <button class:active={statisticsTab === 'offense'} type="button" aria-pressed={statisticsTab === 'offense'} onclick={() => selectStatisticsTab('offense')}>Offense</button>
    <button class:active={statisticsTab === 'defense'} type="button" aria-pressed={statisticsTab === 'defense'} onclick={() => selectStatisticsTab('defense')}>Defense</button>
    <button class:active={statisticsTab === 'playing-time'} type="button" aria-pressed={statisticsTab === 'playing-time'} onclick={() => selectStatisticsTab('playing-time')}>Playing time</button>
    <button class:active={statisticsTab === 'averages'} type="button" aria-pressed={statisticsTab === 'averages'} onclick={() => selectStatisticsTab('averages')}>Averages</button>
  </nav>

  <section class="stats-section">
    <header><h2>Games</h2></header>
    <div class="game-list">
      <div class="game-list-heading" aria-hidden="true">
        <span>Include</span>
      </div>
      {#each data.games as game}
        <details
          id={`game-${game.token}`}
          class="game-disclosure"
          class:scope-excluded={game.statistics !== null && !gameIncludedInTotals(game.id)}
          open={data.focusedGameToken === game.token}
        >
          <summary>
            <span class="play">{#if game.hasVideo}<Play size={14} fill="currentColor" />{:else}<ClipboardList size={14} />{/if}</span>
            <span class="game-name"><strong>{game.title}</strong><small>vs {game.opponentName}</small></span>
            <time datetime={game.playedAt ?? game.createdAt}>{new Date(game.playedAt ?? game.createdAt).toLocaleDateString()}</time>
            <b title={statHelp.score}>{game.ourScore}–{game.opponentScore}</b>
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (the nested checkbox provides keyboard interaction; stopping the label click keeps the disclosure closed) -->
            <label
              class="game-include-toggle"
              class:disabled={game.statistics === null}
              title={game.statistics === null
                ? 'Statistics are unavailable for this game'
                : `Include ${game.title} in event totals`}
              onclick={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={game.statistics !== null && gameIncludedInTotals(game.id)}
                disabled={game.statistics === null}
                aria-label={`Include ${game.title} versus ${game.opponentName} in event totals`}
                onchange={(event) =>
                  setGameIncludedInTotals(game.id, event.currentTarget.checked)}
              />
            </label>
            <span class="disclosure-chevron"><ChevronDown size={16} aria-hidden="true" /></span>
          </summary>
          <div class="game-breakdown">
            <div class="game-breakdown-actions">
              <span>Game statistics</span>
              <div>
                <GamePaperStatsDialog
                  token={game.token}
                  title={game.title}
                  hasPaperStatistics={(game.statistics?.coverage.paperPlayerGames ?? 0) > 0 || (game.statistics?.coverage.paperPointGames ?? 0) > 0}
                  onSaved={() => void invalidateAll()}
                />
                <GameStatsTransferControl
                  token={game.token}
                  onImported={() => void invalidateAll()}
                />
                <a href={resolve(`/games/${game.token}`)}>{game.hasVideo ? 'Open video and editor' : 'Open game editor'}<ExternalLink size={13} aria-hidden="true" /></a>
              </div>
            </div>
            {#if game.statistics}
              {#if game.statistics.coverage.paperPlayerGames > 0 || game.statistics.coverage.paperPointGames > 0}
                <p class="coverage-note game-coverage-note">Paper records contribute to this game. Video-only statistics may be partial.</p>
              {/if}
              {@render statisticsSections(game.statistics)}
            {:else}
              <p class="game-stat-empty">Statistics are not available for this game.</p>
            {/if}
          </div>
        </details>
      {/each}
    </div>
  </section>

  <details id="event-totals" class="event-disclosure" open>
    <summary>
      <span class="play event-total-icon"><BarChart3 size={14} aria-hidden="true" /></span>
      <span class="game-name">
        <strong>Event totals</strong>
        <small>Overall statistics from selected games</small>
      </span>
      <span class="event-included-count">
        {includedGameCount} of {availableGameCount} included
      </span>
      <span class="disclosure-chevron"><ChevronDown size={16} aria-hidden="true" /></span>
    </summary>
    <div class="event-breakdown">
      {#if includedGameCount === 0}
        <p class="event-stat-empty">Include at least one game to view event totals.</p>
      {:else}
        {#if eventStatistics.coverage.paperPlayerGames > 0 || eventStatistics.coverage.paperPointGames > 0}
          <p class="coverage-note event-coverage-note">Paper records contribute to these totals. Playing time, player O/D splits, and play-by-play fields are partial where complete video statistics were unavailable.</p>
        {/if}
        {@render statisticsSections(eventStatistics)}
      {/if}
    </div>
  </details>
</div>

<style>
  .stats-page { width:min(1180px,calc(100% - 32px)); margin:0 auto; padding:20px 0 48px; }
  .back-link { display:inline-flex; align-items:center; gap:5px; margin-bottom:10px; color:#596158; font-size:12px; font-weight:650; text-decoration:none; }
  .stats-heading { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
  .stats-heading h1,.stats-heading p,.stats-section h2 { margin:0; }
  .stats-heading h1 { font-size:22px; }
  .stats-heading p { margin-top:4px; color:#687066; font-size:12px; }
  .stats-heading :global(svg) { color:#087f9b; }
  .coverage-note { margin:-7px 0 15px; padding:9px 11px; border:1px solid #d9c98e; color:#655719; background:#fff8dc; font-size:10px; }
  .stats-tabs { display:flex; gap:3px; margin:0 0 16px; padding:3px; overflow:auto; border:1px solid #cfd5cc; border-radius:6px; background:#eef1ec; }
  .stats-tabs button { flex:1 0 auto; min-height:34px; padding:6px 14px; border:0; border-radius:4px; color:#5d655b; background:transparent; font-size:11px; font-weight:720; cursor:pointer; }
  .stats-tabs button:hover { color:#252b24; background:#f8faf7; }
  .stats-tabs button.active { color:#fff; background:#087f9b; box-shadow:0 1px 2px rgb(0 0 0 / 15%); }
  .stats-section { margin-bottom:22px; border:1px solid #cfd5cc; background:#fff; }
  .stats-section > header { display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:45px; padding:9px 12px; border-bottom:1px solid #dce1d9; background:#f7f9f6; }
  .stats-section h2 { font-size:14px; }
  .stats-section header span { color:#747c72; font-size:10px; }
  .game-list { display:grid; }
  .game-list-heading { display:grid; grid-template-columns:30px minmax(0,1fr) 100px 48px 58px 20px; align-items:center; gap:9px; min-height:27px; padding:3px 12px; border-bottom:1px solid #e3e6e1; color:#747c72; background:#fbfcfa; font-size:8px; font-weight:700; text-transform:uppercase; }
  .game-list-heading span { grid-column:5; justify-self:center; }
  .game-disclosure { border-top:1px solid #e3e6e1; }
  .game-disclosure:first-of-type { border-top:0; }
  .game-disclosure > summary { display:grid; grid-template-columns:30px minmax(0,1fr) 100px 48px 58px 20px; align-items:center; gap:9px; min-height:52px; padding:7px 12px; cursor:pointer; list-style:none; }
  .game-disclosure > summary::-webkit-details-marker { display:none; }
  .game-disclosure > summary:hover { background:#f8faf7; }
  .game-disclosure[open] > summary { border-bottom:1px solid #d9ded7; background:#f5f8f4; }
  .play { display:grid; place-items:center; width:27px; height:27px; border-radius:4px; color:#d89500; background:#20241f; }
  .game-name { display:grid; gap:3px; }
  .game-list strong { color:#2d332c; font-size:12px; }
  .game-list small,.game-list time { color:#747c72; font-size:10px; }
  .game-list b { color:#20241f; font-size:14px; text-align:right; }
  .game-include-toggle { display:grid; place-items:center; width:100%; min-height:40px; cursor:pointer; }
  .game-include-toggle.disabled { cursor:not-allowed; opacity:.5; }
  .game-include-toggle input { width:17px; height:17px; margin:0; accent-color:#087f9b; cursor:pointer; }
  .game-include-toggle input:disabled { cursor:not-allowed; }
  .game-disclosure.scope-excluded > summary .play,
  .game-disclosure.scope-excluded > summary .game-name,
  .game-disclosure.scope-excluded > summary time,
  .game-disclosure.scope-excluded > summary b { opacity:.5; }
  .disclosure-chevron { display:grid; place-items:center; color:#778075; transition:transform 120ms ease; }
  .game-disclosure[open] .disclosure-chevron,.event-disclosure[open] .disclosure-chevron { transform:rotate(180deg); }
  .game-breakdown { padding:12px; background:#f1f3ef; }
  .game-breakdown-actions { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px; }
  .game-breakdown-actions > span { color:#4f574d; font-size:11px; font-weight:760; text-transform:uppercase; letter-spacing:.05em; }
  .game-breakdown-actions > div { display:flex; align-items:center; justify-content:flex-end; gap:7px; }
  .game-breakdown-actions a { display:inline-flex; align-items:center; gap:5px; color:#087f9b; font-size:11px; font-weight:680; text-decoration:none; }
  .game-breakdown > .stats-section { margin-bottom:12px; }
  .game-breakdown > .stats-section:last-child { margin-bottom:0; }
  .game-coverage-note { margin:0 0 12px; }
  .game-stat-empty { margin:0; padding:18px; border:1px dashed #c9cec6; color:#747c72; background:#fff; font-size:11px; text-align:center; }
  .event-disclosure { margin-top:30px; overflow:hidden; border:1px solid #bfcac0; background:#fff; }
  .event-disclosure > summary { display:grid; grid-template-columns:30px minmax(0,1fr) auto 20px; align-items:center; gap:9px; min-height:58px; padding:8px 12px; cursor:pointer; list-style:none; }
  .event-disclosure > summary::-webkit-details-marker { display:none; }
  .event-disclosure > summary:hover { background:#f8faf7; }
  .event-disclosure[open] > summary { border-bottom:1px solid #cfd8cf; background:#f5f8f4; }
  .event-disclosure strong { color:#2d332c; font-size:13px; }
  .event-disclosure small { color:#747c72; font-size:10px; }
  .event-total-icon { color:#dff5f7; background:#087f9b; }
  .event-included-count { color:#596158; font-size:10px; font-weight:700; white-space:nowrap; }
  .event-breakdown { padding:12px; background:#f1f3ef; }
  .event-breakdown > .stats-section { margin-bottom:12px; }
  .event-breakdown > .stats-section:last-child { margin-bottom:0; }
  .event-coverage-note { margin:0 0 12px; }
  .event-stat-empty { margin:0; padding:24px 12px; border:1px dashed #c9cec6; color:#747c72; background:#fff; font-size:11px; text-align:center; }
  .matchup-summary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; padding:12px; }
  .matchup-summary > div { display:grid; grid-template-columns:auto minmax(0,1fr); gap:3px 10px; padding:11px; border:1px solid #dde2da; background:#f8faf7; }
  .matchup-summary strong { grid-row:1 / span 2; align-self:center; color:#596158; font-size:15px; }
  .matchup-summary .mmp strong { color:#287467; }
  .matchup-summary .fmp strong { color:#896817; }
  .matchup-summary span { color:#2d332c; font-size:11px; font-weight:680; }
  .matchup-summary small { color:#747c72; font-size:9px; }
  .team-summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); }
  .team-summary > div { display:grid; gap:3px; padding:12px; border-left:1px solid #e3e6e1; }
  .team-summary > div:first-child { border-left:0; }
  .team-summary span { color:#737b71; font-size:9px; font-weight:700; text-transform:uppercase; }
  .team-summary strong { color:#272d26; font-size:19px; }
  .team-summary small { color:#747c72; font-size:9px; }
  .empty-stat { margin:0; padding:18px 12px; color:#747c72; font-size:10px; }
  .table-scroll { max-width:100%; overflow:auto; }
  table { width:max-content; min-width:100%; border-collapse:collapse; font-size:11px; }
  th,td { height:36px; padding:5px 9px; border-bottom:1px solid #e3e6e1; text-align:right; white-space:nowrap; }
  thead th { color:#6d756b; background:#fbfcfa; font-size:9px; text-transform:uppercase; }
  .sort-column { display:flex; align-items:center; justify-content:flex-end; gap:4px; width:100%; padding:0; border:0; color:inherit; background:transparent; font:inherit; font-weight:700; text-transform:inherit; cursor:pointer; }
  .sort-column small { color:#a1a89e; font-size:7px; line-height:1; }
  .sort-column.active { color:#087f9b; }
  .sort-column.active small { color:#087f9b; }
  thead th:first-child .sort-column { justify-content:flex-start; }
  th:first-child { position:sticky; left:0; min-width:130px; color:#2d332c; background:#fff; text-align:left; }
  tbody tr:last-child > * { border-bottom:0; }
  tbody tr:hover > * { background:#f8faf7; }
  tbody th a { color:#087f9b; text-decoration:none; }
  tbody td a { color:#087f9b; text-decoration:none; }
  .empty-table-row td { height:48px; color:#858d82; background:#fff; font-size:10px; text-align:center; }
  @media(max-width:680px){.team-summary{grid-template-columns:repeat(2,1fr)}.team-summary > div:nth-child(odd){border-left:0}.team-summary > div:nth-child(n+3){border-top:1px solid #e3e6e1}}
  @media(max-width:560px){.stats-page{width:calc(100% - 18px)}.game-list-heading,.game-disclosure > summary{grid-template-columns:30px minmax(0,1fr) 42px 58px 18px}.game-list-heading span{grid-column:4}.game-list time{display:none}.game-include-toggle{min-height:44px}.event-disclosure > summary{grid-template-columns:30px minmax(0,1fr) 18px}.event-included-count{display:none}.event-breakdown{padding:8px}.matchup-summary{grid-template-columns:1fr}.game-breakdown{padding:8px}.game-breakdown-actions{align-items:flex-start;flex-direction:column}.game-breakdown-actions > div{align-items:flex-start;flex-direction:column}}
</style>
