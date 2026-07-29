<script lang="ts">
  import { ArrowLeft, ChevronDown, Play, UserRound } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import { mergeSelectedPlayerStatistics } from '$lib/player-stat-selection';
  import { STAT_DESCRIPTIONS as statHelp } from '$lib/stat-descriptions';
  import {
    compareTableSortValues,
    initialTableSortDirection,
    type TableSortDirection,
    type TableSortValue,
  } from '$lib/table-sort';

  let { data } = $props();
  type TournamentRow = typeof data.tournaments[number];
  type GameRow = typeof data.games[number];
  type TournamentSortKey =
    | 'name' | 'timePlayedMs' | 'pointsPlayed'
    | 'oPointsPlayed' | 'oWinPercentage' | 'dPointsPlayed' | 'dWinPercentage'
    | 'completions' | 'throwingPercentage' | 'receptions' | 'receivingPercentage'
    | 'drops' | 'touches' | 'turnovers' | 'turnoversPerTouch' | 'goals' | 'assists'
    | 'hockeyAssists' | 'blocks' | 'plusMinus' | 'timeWithDiscMs';
  type GameSortKey =
    | 'title' | 'scoreDifferential' | 'timePlayedMs' | 'pointsPlayed'
    | 'completions' | 'throwingPercentage' | 'receptions' | 'receivingPercentage'
    | 'drops' | 'touches' | 'turnovers' | 'turnoversPerTouch' | 'goals' | 'assists'
    | 'hockeyAssists' | 'blocks' | 'plusMinus' | 'timeWithDiscMs';
  let tournamentSortKey = $state<TournamentSortKey | null>(null);
  let tournamentSortDirection = $state<TableSortDirection>('ascending');
  let gameSortKey = $state<GameSortKey | null>(null);
  let gameSortDirection = $state<TableSortDirection>('ascending');
  let expandedGameTokens = $state<string[]>([]);
  let excludedGameIds = $state<number[]>([]);
  let selectionPlayerId = $state((() => data.player.id)());

  const selectedGameIds = $derived(
    data.games
      .filter((game) => !excludedGameIds.includes(game.id))
      .map((game) => game.id),
  );
  const selectedGameIdSet = $derived(new Set(selectedGameIds));
  const selectedStatistics = $derived(mergeSelectedPlayerStatistics(
    data.total,
    data.games
      .filter((game) => selectedGameIdSet.has(game.id))
      .map((game) => ({ statistics: game.statistics, coverage: game.coverage })),
  ));
  const selectedTotal = $derived(selectedStatistics.total);
  const selectedCoverage = $derived(selectedStatistics.coverage);

  $effect(() => {
    if (selectionPlayerId === data.player.id) return;
    selectionPlayerId = data.player.id;
    excludedGameIds = [];
  });

  const duration = (milliseconds: number): string => {
    const seconds = Math.round(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const pct = (won: number, played: number): string => played ? `${Math.round(won / played * 100)}%` : '—';
  const actionTime = (milliseconds: number): string => {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
  };

  function toggleTournamentSort(key: TournamentSortKey, kind: 'text' | 'number'): void {
    if (tournamentSortKey === key) {
      tournamentSortDirection = tournamentSortDirection === 'ascending'
        ? 'descending'
        : 'ascending';
    } else {
      tournamentSortKey = key;
      tournamentSortDirection = initialTableSortDirection(kind);
    }
  }

  function toggleGameSort(key: GameSortKey, kind: 'text' | 'number'): void {
    if (gameSortKey === key) {
      gameSortDirection = gameSortDirection === 'ascending' ? 'descending' : 'ascending';
    } else {
      gameSortKey = key;
      gameSortDirection = initialTableSortDirection(kind);
    }
  }

  function sortedTournaments(): TournamentRow[] {
    if (tournamentSortKey === null) return data.tournaments;
    const key = tournamentSortKey;
    return [...data.tournaments].sort((left, right) =>
      compareTableSortValues(
        tournamentSortValue(left, key),
        tournamentSortValue(right, key),
        tournamentSortDirection,
      ) || left.name.localeCompare(right.name)
    );
  }

  function sortedGames(): GameRow[] {
    if (gameSortKey === null) return data.games;
    const key = gameSortKey;
    return [...data.games].sort((left, right) =>
      compareTableSortValues(
        gameSortValue(left, key),
        gameSortValue(right, key),
        gameSortDirection,
      ) || left.title.localeCompare(right.title)
    );
  }

  function tournamentSortValue(row: TournamentRow, key: TournamentSortKey): TableSortValue {
    if (key === 'name') return row.name;
    if (key === 'oWinPercentage') {
      return row.statistics.oPointsPlayed === 0
        ? null
        : row.statistics.oPointsWon / row.statistics.oPointsPlayed;
    }
    if (key === 'dWinPercentage') {
      return row.statistics.dPointsPlayed === 0
        ? null
        : row.statistics.dPointsWon / row.statistics.dPointsPlayed;
    }
    if (key === 'throwingPercentage') {
      return row.statistics.throwingAttempts === 0
        ? null
        : (row.statistics.throwingAttempts - row.statistics.passerTurnovers) /
          row.statistics.throwingAttempts;
    }
    if (key === 'receivingPercentage') {
      return row.statistics.receivingTargets === 0
        ? null
        : row.statistics.receptions / row.statistics.receivingTargets;
    }
    if (key === 'turnoversPerTouch') {
      return row.statistics.touches === 0
        ? null
        : row.statistics.turnovers / row.statistics.touches;
    }
    return row.statistics[key];
  }

  function gameSortValue(row: GameRow, key: GameSortKey): TableSortValue {
    if (key === 'title') return row.title;
    if (key === 'scoreDifferential') return row.ourScore - row.opponentScore;
    if (key === 'throwingPercentage') {
      return row.statistics.throwingAttempts === 0
        ? null
        : (row.statistics.throwingAttempts - row.statistics.passerTurnovers) /
          row.statistics.throwingAttempts;
    }
    if (key === 'receivingPercentage') {
      return row.statistics.receivingTargets === 0
        ? null
        : row.statistics.receptions / row.statistics.receivingTargets;
    }
    if (key === 'turnoversPerTouch') {
      return row.statistics.touches === 0
        ? null
        : row.statistics.turnovers / row.statistics.touches;
    }
    return row.statistics[key];
  }

  function toggleGameActions(token: string): void {
    expandedGameTokens = expandedGameTokens.includes(token)
      ? expandedGameTokens.filter((candidate) => candidate !== token)
      : [...expandedGameTokens, token];
  }

  function setSelectedGames(gameIds: Set<number>): void {
    excludedGameIds = data.games
      .filter((game) => !gameIds.has(game.id))
      .map((game) => game.id);
  }

  function setGameIncluded(gameId: number, included: boolean): void {
    const next = new Set(selectedGameIds);
    if (included) next.add(gameId);
    else next.delete(gameId);
    setSelectedGames(next);
  }

  function tournamentGameIds(tournamentId: number): number[] {
    return data.games
      .filter((game) => game.tournamentId === tournamentId)
      .map((game) => game.id);
  }

  function tournamentSelection(tournamentId: number): {
    checked: boolean;
    indeterminate: boolean;
    selected: number;
    total: number;
  } {
    const gameIds = tournamentGameIds(tournamentId);
    const selected = gameIds.filter((gameId) => selectedGameIdSet.has(gameId)).length;
    return {
      checked: gameIds.length > 0 && selected === gameIds.length,
      indeterminate: selected > 0 && selected < gameIds.length,
      selected,
      total: gameIds.length,
    };
  }

  function setTournamentIncluded(tournamentId: number, included: boolean): void {
    const next = new Set(selectedGameIds);
    for (const gameId of tournamentGameIds(tournamentId)) {
      if (included) next.add(gameId);
      else next.delete(gameId);
    }
    setSelectedGames(next);
  }

  function includeAllGames(): void {
    excludedGameIds = [];
  }

  function excludeAllGames(): void {
    excludedGameIds = data.games.map((game) => game.id);
  }

  function actionHref(
    game: GameRow,
    action: GameRow['actions'][number],
  ): string {
    const gameUrl = resolve(`/games/${game.token}`);
    return action.eventId === null
      ? `${gameUrl}?at=${action.timeMs}`
      : `${gameUrl}?event=${action.eventId}`;
  }
</script>

{#snippet tournamentHeader(key: TournamentSortKey, label: string, title: string, kind: 'text' | 'number')}
  <th {title} aria-sort={tournamentSortKey === key ? tournamentSortDirection : 'none'}>
    <button
      class="sort-column"
      class:active={tournamentSortKey === key}
      type="button"
      aria-label={`Sort events by ${label}`}
      onclick={() => toggleTournamentSort(key, kind)}
    ><span>{label}</span><small aria-hidden="true">{tournamentSortKey === key ? (tournamentSortDirection === 'ascending' ? '▲' : '▼') : '↕'}</small></button>
  </th>
{/snippet}

{#snippet gameHeader(key: GameSortKey, label: string, title: string, kind: 'text' | 'number')}
  <th {title} aria-sort={gameSortKey === key ? gameSortDirection : 'none'}>
    <button
      class="sort-column"
      class:active={gameSortKey === key}
      type="button"
      aria-label={`Sort games by ${label}`}
      onclick={() => toggleGameSort(key, kind)}
    ><span>{label}</span><small aria-hidden="true">{gameSortKey === key ? (gameSortDirection === 'ascending' ? '▲' : '▼') : '↕'}</small></button>
  </th>
{/snippet}

<svelte:head><title>{data.player.name} stats - Ultimate Video Stats</title></svelte:head>

<div class="player-page">
  <a class="back-link" href={resolve(`/teams/${data.team.slug}`)}><ArrowLeft size={15} />{data.team.name}</a>
  <header class="player-heading"><span><UserRound size={23} /></span><div><h1>{data.player.name}</h1><p>{data.roster.name} · {data.player.matchupRole?.toUpperCase() ?? 'matchup role not set'}</p></div></header>

  <section class="overall-totals" aria-labelledby="overall-totals-heading">
    <header>
      <div>
        <h2 id="overall-totals-heading">Overall totals</h2>
        <p aria-live="polite">
          {selectedGameIds.length} of {data.games.length}
          {data.games.length === 1 ? 'game' : 'games'} included
        </p>
      </div>
      <div class="selection-actions">
        <button
          type="button"
          disabled={selectedGameIds.length === data.games.length}
          onclick={includeAllGames}
        >Include all</button>
        <button
          type="button"
          disabled={selectedGameIds.length === 0}
          onclick={excludeAllGames}
        >Exclude all</button>
      </div>
    </header>
    {#if selectedCoverage.paperPlayerGames > 0 || selectedCoverage.paperPointGames > 0}
      <p class="coverage-note">Paper records contribute to the selected totals. Playing time, O/D splits, and play-by-play fields are partial for selected games without complete video statistics.</p>
    {/if}
    <div class="totals-grid" aria-label="Selected season totals">
      <div title={statHelp.timePlayed}><span>Playing time</span><strong>{duration(selectedTotal.timePlayedMs)}</strong></div>
      <div title={statHelp.pointsPlayed}><span>Points</span><strong>{selectedTotal.pointsPlayed}</strong></div>
      <div title={statHelp.goals}><span>Goals</span><strong>{selectedTotal.goals}</strong></div>
      <div title={statHelp.assists}><span>Assists</span><strong>{selectedTotal.assists}</strong></div>
      <div title={statHelp.hockeyAssists}><span>Hockey assists</span><strong>{selectedTotal.hockeyAssists}</strong></div>
      <div title={statHelp.blocks}><span>Blocks</span><strong>{selectedTotal.blocks}</strong></div>
      <div title={statHelp.turnovers}><span>Turnovers</span><strong>{selectedTotal.turnovers}</strong></div>
      <div title={statHelp.passingPercentage}><span>Passing</span><strong>{pct(selectedTotal.throwingAttempts - selectedTotal.passerTurnovers, selectedTotal.throwingAttempts)}</strong></div>
      <div title={statHelp.receivingPercentage}><span>Receiving</span><strong>{pct(selectedTotal.receptions, selectedTotal.receivingTargets)}</strong></div>
      <div title={statHelp.drops}><span>Drops</span><strong>{selectedTotal.drops}</strong></div>
      <div title={statHelp.touches}><span>Touches</span><strong>{selectedTotal.touches}</strong></div>
      <div title={statHelp.turnoversPerTouch}><span>Turnovers/touch</span><strong>{pct(selectedTotal.turnovers, selectedTotal.touches)}</strong></div>
      <div title={statHelp.plusMinus}><span>Plus/minus</span><strong>{selectedTotal.plusMinus > 0 ? '+' : ''}{selectedTotal.plusMinus}</strong></div>
      <div title={statHelp.discTime}><span>Disc time</span><strong>{duration(selectedTotal.timeWithDiscMs)}</strong></div>
    </div>
  </section>

  <section class="data-section">
    <header><h2>Events</h2></header>
    <div class="table-scroll"><table><thead><tr>
      {@render tournamentHeader('name', 'Event', 'Event name', 'text')}
      {@render tournamentHeader('timePlayedMs', 'Time', statHelp.timePlayed, 'number')}
      {@render tournamentHeader('pointsPlayed', 'Pts', statHelp.pointsPlayed, 'number')}
      {@render tournamentHeader('oPointsPlayed', 'O', statHelp.offensePointsPlayed, 'number')}
      {@render tournamentHeader('oWinPercentage', 'O%', statHelp.offenseWinPercentage, 'number')}
      {@render tournamentHeader('dPointsPlayed', 'D', statHelp.defensePointsPlayed, 'number')}
      {@render tournamentHeader('dWinPercentage', 'D%', statHelp.defenseWinPercentage, 'number')}
      {@render tournamentHeader('completions', 'C', statHelp.completions, 'number')}
      {@render tournamentHeader('throwingPercentage', 'Pass%', statHelp.passingPercentage, 'number')}
      {@render tournamentHeader('receptions', 'R', statHelp.receptions, 'number')}
      {@render tournamentHeader('receivingPercentage', 'R%', statHelp.receivingPercentage, 'number')}
      {@render tournamentHeader('drops', 'Drp', statHelp.drops, 'number')}
      {@render tournamentHeader('touches', 'Touch', statHelp.touches, 'number')}
      {@render tournamentHeader('turnovers', 'T', statHelp.turnovers, 'number')}
      {@render tournamentHeader('turnoversPerTouch', 'T/Touch', statHelp.turnoversPerTouch, 'number')}
      {@render tournamentHeader('goals', 'G', statHelp.goals, 'number')}
      {@render tournamentHeader('assists', 'A', statHelp.assists, 'number')}
      {@render tournamentHeader('hockeyAssists', '2A', statHelp.hockeyAssists, 'number')}
      {@render tournamentHeader('blocks', 'Blocks', statHelp.blocks, 'number')}
      {@render tournamentHeader('plusMinus', '+/-', statHelp.plusMinus, 'number')}
      {@render tournamentHeader('timeWithDiscMs', 'Disc', statHelp.discTime, 'number')}
    </tr></thead><tbody>
      {#each sortedTournaments() as tournament}
        {@const selection = tournamentSelection(tournament.id)}
        <tr class:scope-excluded={selection.selected === 0}>
          <th>
            <div class="scope-cell">
              <label
                class="scope-toggle"
                class:disabled={selection.total === 0}
                title={selection.total === 0 ? 'This event has no games to include' : `Include ${tournament.name} games in overall totals`}
              >
                <input
                  type="checkbox"
                  checked={selection.checked}
                  indeterminate={selection.indeterminate}
                  disabled={selection.total === 0}
                  aria-label={`Include games from ${tournament.name} in overall totals`}
                  onchange={(event) => setTournamentIncluded(tournament.id, event.currentTarget.checked)}
                />
              </label>
              <span class="scope-copy">
                <a href={resolve(`/teams/${data.team.slug}/tournaments/${tournament.id}`)}>{tournament.name}</a>
                <small>{selection.selected} of {selection.total} games included</small>
              </span>
            </div>
          </th>
          <td>{duration(tournament.statistics.timePlayedMs)}</td><td>{tournament.statistics.pointsPlayed}</td><td>{tournament.statistics.oPointsPlayed}</td><td>{pct(tournament.statistics.oPointsWon,tournament.statistics.oPointsPlayed)}</td><td>{tournament.statistics.dPointsPlayed}</td><td>{pct(tournament.statistics.dPointsWon,tournament.statistics.dPointsPlayed)}</td><td>{tournament.statistics.completions}</td><td>{pct(tournament.statistics.throwingAttempts - tournament.statistics.passerTurnovers,tournament.statistics.throwingAttempts)}</td><td>{tournament.statistics.receptions}</td><td>{pct(tournament.statistics.receptions,tournament.statistics.receivingTargets)}</td><td>{tournament.statistics.drops}</td><td>{tournament.statistics.touches}</td><td>{tournament.statistics.turnovers}</td><td>{pct(tournament.statistics.turnovers,tournament.statistics.touches)}</td><td>{tournament.statistics.goals}</td><td>{tournament.statistics.assists}</td><td>{tournament.statistics.hockeyAssists}</td><td>{tournament.statistics.blocks}</td><td>{tournament.statistics.plusMinus > 0 ? '+' : ''}{tournament.statistics.plusMinus}</td><td>{duration(tournament.statistics.timeWithDiscMs)}</td>
        </tr>
      {/each}
    </tbody></table></div>
  </section>

  <section class="data-section">
    <header><h2>Games</h2></header>
    <div class="table-scroll"><table><thead><tr>
      {@render gameHeader('title', 'Game', 'Game title', 'text')}
      <th title="Include this game in overall totals">Include</th>
      {@render gameHeader('scoreDifferential', 'Score', statHelp.score, 'number')}
      {@render gameHeader('timePlayedMs', 'Time', statHelp.timePlayed, 'number')}
      {@render gameHeader('pointsPlayed', 'Pts', statHelp.pointsPlayed, 'number')}
      {@render gameHeader('completions', 'C', statHelp.completions, 'number')}
      {@render gameHeader('throwingPercentage', 'Pass%', statHelp.passingPercentage, 'number')}
      {@render gameHeader('receptions', 'R', statHelp.receptions, 'number')}
      {@render gameHeader('receivingPercentage', 'R%', statHelp.receivingPercentage, 'number')}
      {@render gameHeader('drops', 'Drp', statHelp.drops, 'number')}
      {@render gameHeader('touches', 'Touch', statHelp.touches, 'number')}
      {@render gameHeader('turnovers', 'T', statHelp.turnovers, 'number')}
      {@render gameHeader('turnoversPerTouch', 'T/Touch', statHelp.turnoversPerTouch, 'number')}
      {@render gameHeader('goals', 'G', statHelp.goals, 'number')}
      {@render gameHeader('assists', 'A', statHelp.assists, 'number')}
      {@render gameHeader('hockeyAssists', '2A', statHelp.hockeyAssists, 'number')}
      {@render gameHeader('blocks', 'Blocks', statHelp.blocks, 'number')}
      {@render gameHeader('plusMinus', '+/-', statHelp.plusMinus, 'number')}
      {@render gameHeader('timeWithDiscMs', 'Disc', statHelp.discTime, 'number')}
      <th title="Video links for this player’s attributed actions">Clips</th>
    </tr></thead><tbody>
      {#each sortedGames() as game}
        <tr
          class:actions-open={expandedGameTokens.includes(game.token)}
          class:scope-excluded={!selectedGameIdSet.has(game.id)}
        >
          <th>
            <span class="scope-copy">
              <a href={resolve(`/games/${game.token}`)}>{game.title}</a>
              <small>vs {game.opponentName}</small>
            </span>
          </th>
          <td class="game-include-cell">
            <label title={`Include ${game.title} in overall totals`}>
              <input
                type="checkbox"
                checked={selectedGameIdSet.has(game.id)}
                aria-label={`Include ${game.title} versus ${game.opponentName} in overall totals`}
                onchange={(event) => setGameIncluded(game.id, event.currentTarget.checked)}
              />
            </label>
          </td>
          <td>{game.ourScore}–{game.opponentScore}</td>
          <td>{duration(game.statistics.timePlayedMs)}</td>
          <td>{game.statistics.pointsPlayed}</td>
          <td>{game.statistics.completions}</td>
          <td>{pct(game.statistics.throwingAttempts - game.statistics.passerTurnovers,game.statistics.throwingAttempts)}</td>
          <td>{game.statistics.receptions}</td>
          <td>{pct(game.statistics.receptions,game.statistics.receivingTargets)}</td>
          <td>{game.statistics.drops}</td>
          <td>{game.statistics.touches}</td>
          <td>{game.statistics.turnovers}</td>
          <td>{pct(game.statistics.turnovers,game.statistics.touches)}</td>
          <td>{game.statistics.goals}</td>
          <td>{game.statistics.assists}</td>
          <td>{game.statistics.hockeyAssists}</td>
          <td>{game.statistics.blocks}</td>
          <td>{game.statistics.plusMinus > 0 ? '+' : ''}{game.statistics.plusMinus}</td>
          <td>{duration(game.statistics.timeWithDiscMs)}</td>
          <td>
            <button
              class:open={expandedGameTokens.includes(game.token)}
              class="clip-toggle"
              type="button"
              disabled={game.actions.length === 0}
              aria-expanded={expandedGameTokens.includes(game.token)}
              onclick={() => toggleGameActions(game.token)}
            >
              {game.actions.length === 0 ? 'None' : game.actions.length}
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          </td>
        </tr>
        {#if expandedGameTokens.includes(game.token)}
          <tr class="action-reel-row">
            <td colspan="20">
              <div class="action-reel">
                <section class="highlight-clips">
                  <header>
                    <h3>Highlights</h3>
                    <span>{game.actions.filter((action) => action.tone === 'highlight').length}</span>
                  </header>
                  {#if game.actions.some((action) => action.tone === 'highlight')}
                    <div class="clip-list">
                      {#each game.actions.filter((action) => action.tone === 'highlight') as action}
                        <a href={actionHref(game, action)} title={`Open video near ${actionTime(action.timeMs)}`}>
                          <span class="clip-play"><Play size={11} fill="currentColor" aria-hidden="true" /></span>
                          <span><strong>{action.label}</strong><small>{action.detail}</small></span>
                          <time>{actionTime(action.timeMs)}</time>
                        </a>
                      {/each}
                    </div>
                  {:else}
                    <p>No attributed highlights recorded.</p>
                  {/if}
                </section>
                <section class="lowlight-clips">
                  <header>
                    <h3>Lowlights</h3>
                    <span>{game.actions.filter((action) => action.tone === 'lowlight').length}</span>
                  </header>
                  {#if game.actions.some((action) => action.tone === 'lowlight')}
                    <div class="clip-list">
                      {#each game.actions.filter((action) => action.tone === 'lowlight') as action}
                        <a href={actionHref(game, action)} title={`Open video near ${actionTime(action.timeMs)}`}>
                          <span class="clip-play"><Play size={11} fill="currentColor" aria-hidden="true" /></span>
                          <span><strong>{action.label}</strong><small>{action.detail}</small></span>
                          <time>{actionTime(action.timeMs)}</time>
                        </a>
                      {/each}
                    </div>
                  {:else}
                    <p>No attributed lowlights recorded.</p>
                  {/if}
                </section>
              </div>
            </td>
          </tr>
        {/if}
      {/each}
    </tbody></table></div>
  </section>
</div>

<style>
  .player-page { width:min(1120px,calc(100% - 32px)); height:100%; margin:auto; padding:20px 0 48px; overflow:auto; }
  .back-link { display:inline-flex; align-items:center; gap:5px; margin-bottom:10px; color:#596158; font-size:12px; font-weight:650; text-decoration:none; }
  .player-heading { display:flex; align-items:center; gap:11px; margin-bottom:18px; }
  .player-heading > span { display:grid; place-items:center; width:42px; height:42px; border:1px solid #bdd3d6; border-radius:6px; color:#087f9b; background:#edf7f8; }
  .player-heading h1,.player-heading p,.data-section h2,.overall-totals h2,.overall-totals header p { margin:0; }
  .player-heading h1 { font-size:22px; }
  .player-heading p { margin-top:3px; color:#687066; font-size:11px; }
  .overall-totals { margin-bottom:22px; overflow:hidden; border:1px solid #cfd5cc; background:#fff; }
  .overall-totals > header { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:55px; padding:9px 12px; border-bottom:1px solid #dce1d9; background:#f7f9f6; }
  .overall-totals h2 { color:#293028; font-size:14px; }
  .overall-totals header p { margin-top:3px; color:#70786e; font-size:10px; }
  .selection-actions { display:flex; align-items:center; justify-content:flex-end; gap:7px; }
  .selection-actions button { min-height:34px; padding:0 10px; border:1px solid #bfc8bc; border-radius:4px; color:#4d574b; background:#fff; font-size:10px; font-weight:700; cursor:pointer; }
  .selection-actions button:hover:not(:disabled) { border-color:#8f9b8d; background:#f5f8f4; }
  .selection-actions button:disabled { color:#9da49a; background:#f3f5f2; cursor:not-allowed; }
  .coverage-note { margin:0; padding:9px 11px; border-bottom:1px solid #d9c98e; color:#655719; background:#fff8dc; font-size:10px; }
  .totals-grid { display:grid; grid-template-columns:repeat(7,minmax(90px,1fr)); background:#fff; }
  .totals-grid div { display:grid; gap:5px; padding:11px; border-left:1px solid #e0e4de; }
  .totals-grid div:first-child { border-left:0; }
  .totals-grid div:nth-child(n+8) { border-top:1px solid #e0e4de; }
  .totals-grid div:nth-child(8) { border-left:0; }
  .totals-grid span { color:#737b71; font-size:9px; font-weight:700; text-transform:uppercase; }
  .totals-grid strong { color:#272d26; font-size:17px; }
  .data-section { margin-bottom:20px; border:1px solid #cfd5cc; background:#fff; }
  .data-section > header { padding:10px 12px; border-bottom:1px solid #dce1d9; background:#f7f9f6; }
  .data-section h2 { font-size:14px; }
  .table-scroll { max-width:100%; overflow:auto; }
  table { width:max-content; min-width:100%; border-collapse:collapse; font-size:10px; }
  th,td { height:36px; padding:5px 9px; border-bottom:1px solid #e3e6e1; text-align:right; white-space:nowrap; }
  thead th { color:#6d756b; background:#fbfcfa; font-size:8px; text-transform:uppercase; }
  .sort-column { display:flex; align-items:center; justify-content:flex-end; gap:4px; width:100%; padding:0; border:0; color:inherit; background:transparent; font:inherit; font-weight:700; text-transform:inherit; cursor:pointer; }
  .sort-column small { display:inline; margin:0; color:#a1a89e; font-size:7px; font-weight:700; line-height:1; }
  .sort-column.active,.sort-column.active small { color:#087f9b; }
  thead th:first-child .sort-column { justify-content:flex-start; }
  th:first-child { position:sticky; left:0; min-width:150px; color:#2d332c; background:#fff; text-align:left; }
  tbody tr:last-child > * { border-bottom:0; }
  tbody tr:hover > * { background:#f8faf7; }
  tbody th a { display:block; color:#087f9b; text-decoration:none; }
  tbody th small { display:block; margin-top:2px; color:#777f75; font-weight:400; }
  .scope-cell { display:flex; align-items:center; gap:4px; min-width:0; }
  .scope-toggle { display:grid; flex:0 0 34px; place-items:center; width:34px; height:34px; margin:-4px 0 -4px -6px; cursor:pointer; }
  .scope-toggle.disabled { cursor:not-allowed; }
  .scope-toggle input { width:17px; height:17px; margin:0; accent-color:#087f9b; cursor:pointer; }
  .scope-toggle input:disabled { cursor:not-allowed; }
  .scope-copy { display:block; min-width:0; }
  .game-include-cell { padding:0; text-align:center; }
  .game-include-cell label { display:grid; place-items:center; min-width:36px; min-height:36px; cursor:pointer; }
  .game-include-cell input { width:17px; height:17px; margin:0; accent-color:#087f9b; cursor:pointer; }
  tr.scope-excluded > td { color:#9aa198; }
  tr.scope-excluded .scope-copy { opacity:.55; }
  .clip-toggle { display:inline-flex; align-items:center; justify-content:center; gap:3px; min-width:45px; min-height:25px; padding:0 6px; border:1px solid #cad1c7; border-radius:4px; color:#4f5a4d; background:#f8faf7; font-size:9px; font-weight:750; cursor:pointer; }
  .clip-toggle :global(svg) { transition:transform 120ms ease; }
  .clip-toggle.open :global(svg) { transform:rotate(180deg); }
  .clip-toggle:disabled { border-color:#e0e3de; color:#a4aba1; background:#fafbfa; cursor:default; }
  tr.actions-open > * { border-bottom-color:#c7d1c4; background:#f6f9f5; }
  .action-reel-row > td { height:auto; padding:0; border-bottom:1px solid #c7d1c4; background:#f0f4ee; text-align:left; white-space:normal; }
  .action-reel-row:hover > td { background:#f0f4ee; }
  .action-reel { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; padding:10px; }
  .action-reel section { min-width:0; overflow:hidden; border:1px solid #d4dad1; border-radius:5px; background:#fff; }
  .action-reel section > header { display:flex; align-items:center; justify-content:space-between; min-height:35px; padding:6px 9px; border-bottom:1px solid #e0e4de; }
  .action-reel h3 { margin:0; font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
  .action-reel header span { display:grid; place-items:center; min-width:20px; height:18px; border-radius:9px; font-size:8px; font-weight:800; }
  .highlight-clips h3 { color:#2e6846; }
  .highlight-clips header span { color:#2d6a44; background:#e5f3e8; }
  .lowlight-clips h3 { color:#914247; }
  .lowlight-clips header span { color:#914247; background:#f8e8e9; }
  .action-reel section > p { margin:0; padding:14px 10px; color:#858d82; font-size:9px; }
  .clip-list { display:grid; }
  .clip-list a { display:grid; grid-template-columns:24px minmax(0,1fr) auto; align-items:center; gap:7px; min-height:43px; padding:5px 8px; border-bottom:1px solid #ecefeb; color:#30372f; text-decoration:none; }
  .clip-list a:last-child { border-bottom:0; }
  .clip-list a:hover { background:#f6f9f5; }
  .clip-play { display:grid; place-items:center; width:23px; height:23px; border-radius:50%; color:#fff; background:#568068; }
  .lowlight-clips .clip-play { background:#a85b60; }
  .clip-list a > span:nth-child(2) { display:grid; gap:2px; min-width:0; }
  .clip-list strong,.clip-list small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .clip-list strong { font-size:10px; }
  .clip-list small { color:#7b8379; font-size:8px; }
  .clip-list time { color:#687268; font:9px ui-monospace,monospace; }
  @media(max-width:900px){.totals-grid{grid-template-columns:repeat(3,1fr)}.totals-grid div{border-top:1px solid #e0e4de;border-left:1px solid #e0e4de}.totals-grid div:nth-child(3n+1){border-left:0}.totals-grid div:nth-child(-n+3){border-top:0}}
  @media(max-width:680px){.action-reel{grid-template-columns:1fr}}
  @media(max-width:520px){.player-page{width:calc(100% - 18px)}.overall-totals > header{align-items:flex-start;flex-direction:column}.selection-actions{width:100%;justify-content:stretch}.selection-actions button{flex:1;min-height:44px}.scope-toggle{flex-basis:44px;width:44px;height:44px;margin:-8px 0 -8px -7px}.game-include-cell label{min-width:44px;min-height:44px}}
</style>
