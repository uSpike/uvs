<script lang="ts">
  import { ArrowLeft, BarChart3, ChevronDown, ClipboardList, ExternalLink, Play } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import { STAT_DESCRIPTIONS as statHelp } from '$lib/stat-descriptions';

  let { data } = $props();

  const duration = (milliseconds: number): string => {
    const seconds = Math.round(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const pct = (won: number, played: number): string =>
    played === 0 ? '—' : `${Math.round((won / played) * 100)}%`;
</script>

{#snippet statisticsSections(statistics: typeof data.statistics)}
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

  <section class="stats-section">
    <header><h2>Players</h2><span>Scoring pass counts as a completion and reception</span></header>
    <div class="table-scroll"><table><thead><tr><th>Player</th><th title={statHelp.timePlayed}>Time</th><th title={statHelp.pointsPlayed}>Pts</th><th title={statHelp.offensePointsPlayed}>O</th><th title={statHelp.offenseWinPercentage}>O%</th><th title={statHelp.defensePointsPlayed}>D</th><th title={statHelp.defenseWinPercentage}>D%</th><th title={statHelp.completions}>C</th><th title={statHelp.receptions}>R</th><th title={statHelp.turnovers}>T</th><th title={statHelp.goals}>G</th><th title={statHelp.assists}>A</th><th title={statHelp.hockeyAssists}>2A</th><th title={statHelp.blocks}>Blocks</th><th title={statHelp.pulls}>Pulls</th><th title={statHelp.plusMinus}>+/-</th><th title={statHelp.discTime}>Disc</th></tr></thead><tbody>
      {#each statistics.playerStatistics as stats}
        <tr><th><a href={resolve(`/teams/${data.tournament.teamSlug}/players/${stats.playerId}`)}>{stats.playerName}</a></th><td>{duration(stats.timePlayedMs)}</td><td>{stats.pointsPlayed}</td><td>{stats.oPointsPlayed}</td><td>{pct(stats.oPointsWon, stats.oPointsPlayed)}</td><td>{stats.dPointsPlayed}</td><td>{pct(stats.dPointsWon, stats.dPointsPlayed)}</td><td>{stats.completions}</td><td>{stats.receptions}</td><td>{stats.turnovers}</td><td>{stats.goals}</td><td>{stats.assists}</td><td>{stats.hockeyAssists}</td><td>{stats.blocks}</td><td>{stats.pulls}</td><td>{stats.plusMinus > 0 ? '+' : ''}{stats.plusMinus}</td><td>{duration(stats.timeWithDiscMs)}</td></tr>
      {/each}
    </tbody></table></div>
  </section>

  <section class="stats-section">
    <header><h2>Lines</h2><span>Independent point and event totals</span></header>
    <div class="table-scroll"><table><thead><tr><th>Line</th><th title={statHelp.timePlayed}>Time</th><th title={statHelp.pointsPlayed}>Pts</th><th title={statHelp.offensePointsPlayed}>O</th><th title={statHelp.offenseWinPercentage}>O%</th><th title={statHelp.defensePointsPlayed}>D</th><th title={statHelp.defenseWinPercentage}>D%</th><th title={statHelp.completions}>C</th><th title={statHelp.turnovers}>T</th><th title={statHelp.blocks}>Blocks</th><th title={statHelp.goalsFor}>GF</th><th title={statHelp.goalsAgainst}>GA</th><th title={statHelp.plusMinus}>+/-</th></tr></thead><tbody>
      {#each statistics.lineStatistics as stats}
        <tr><th>{stats.lineName}</th><td>{duration(stats.timePlayedMs)}</td><td>{stats.pointsPlayed}</td><td>{stats.oPointsPlayed}</td><td>{pct(stats.oPointsWon, stats.oPointsPlayed)}</td><td>{stats.dPointsPlayed}</td><td>{pct(stats.dPointsWon, stats.dPointsPlayed)}</td><td>{stats.completions}</td><td>{stats.turnovers}</td><td>{stats.blocks}</td><td>{stats.goalsFor}</td><td>{stats.goalsAgainst}</td><td>{stats.plusMinus > 0 ? '+' : ''}{stats.plusMinus}</td></tr>
      {/each}
    </tbody></table></div>
  </section>
{/snippet}

<svelte:head><title>{data.tournament.name} stats - Ultimate Video Stats</title></svelte:head>

<div class="stats-page">
  <a class="back-link" href={resolve(`/teams/${data.tournament.teamSlug}`)}><ArrowLeft size={15} />{data.tournament.teamName}</a>
  <header class="stats-heading">
    <div><h1>{data.tournament.name}</h1><p>{data.tournament.seasonRosterName} · {data.games.length} {data.games.length === 1 ? 'game' : 'games'}</p></div>
    <BarChart3 size={24} aria-hidden="true" />
  </header>

  {#if data.statistics.coverage.paperPlayerGames > 0 || data.statistics.coverage.paperPointGames > 0}
    <p class="coverage-note">Paper records contribute to these totals. Playing time, player O/D splits, and play-by-play fields are partial where complete video statistics were unavailable.</p>
  {/if}

  <section class="stats-section">
    <header><h2>Games</h2></header>
    <div class="game-list">
      {#each data.games as game}
        <details id={`game-${game.token}`} class="game-disclosure" open={data.focusedGameToken === game.token}>
          <summary>
            <span class="play">{#if game.hasVideo}<Play size={14} fill="currentColor" />{:else}<ClipboardList size={14} />{/if}</span>
            <span class="game-name"><strong>{game.title}</strong><small>vs {game.opponentName}</small></span>
            <time datetime={game.playedAt ?? game.createdAt}>{new Date(game.playedAt ?? game.createdAt).toLocaleDateString()}</time>
            <b title={statHelp.score}>{game.ourScore}–{game.opponentScore}</b>
            <span class="disclosure-chevron"><ChevronDown size={16} aria-hidden="true" /></span>
          </summary>
          <div class="game-breakdown">
            <div class="game-breakdown-actions">
              <span>Game statistics</span>
              <a href={resolve(`/games/${game.token}`)}>{game.hasVideo ? 'Open video and editor' : 'Open game editor'}<ExternalLink size={13} aria-hidden="true" /></a>
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

  <div class="totals-heading">
    <h2>Event totals</h2>
    <span>All {data.games.length} {data.games.length === 1 ? 'game' : 'games'}</span>
  </div>
  {@render statisticsSections(data.statistics)}
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
  .stats-section { margin-bottom:22px; border:1px solid #cfd5cc; background:#fff; }
  .stats-section > header { display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:45px; padding:9px 12px; border-bottom:1px solid #dce1d9; background:#f7f9f6; }
  .stats-section h2 { font-size:14px; }
  .stats-section header span { color:#747c72; font-size:10px; }
  .game-list { display:grid; }
  .game-disclosure { border-top:1px solid #e3e6e1; }
  .game-disclosure:first-child { border-top:0; }
  .game-disclosure > summary { display:grid; grid-template-columns:30px minmax(0,1fr) 100px 48px 20px; align-items:center; gap:9px; min-height:52px; padding:7px 12px; cursor:pointer; list-style:none; }
  .game-disclosure > summary::-webkit-details-marker { display:none; }
  .game-disclosure > summary:hover { background:#f8faf7; }
  .game-disclosure[open] > summary { border-bottom:1px solid #d9ded7; background:#f5f8f4; }
  .play { display:grid; place-items:center; width:27px; height:27px; border-radius:4px; color:#d89500; background:#20241f; }
  .game-name { display:grid; gap:3px; }
  .game-list strong { color:#2d332c; font-size:12px; }
  .game-list small,.game-list time { color:#747c72; font-size:10px; }
  .game-list b { color:#20241f; font-size:14px; text-align:right; }
  .disclosure-chevron { display:grid; place-items:center; color:#778075; transition:transform 120ms ease; }
  .game-disclosure[open] .disclosure-chevron { transform:rotate(180deg); }
  .game-breakdown { padding:12px; background:#f1f3ef; }
  .game-breakdown-actions { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px; }
  .game-breakdown-actions > span { color:#4f574d; font-size:11px; font-weight:760; text-transform:uppercase; letter-spacing:.05em; }
  .game-breakdown-actions a { display:inline-flex; align-items:center; gap:5px; color:#087f9b; font-size:11px; font-weight:680; text-decoration:none; }
  .game-breakdown > .stats-section { margin-bottom:12px; }
  .game-breakdown > .stats-section:last-child { margin-bottom:0; }
  .game-coverage-note { margin:0 0 12px; }
  .game-stat-empty { margin:0; padding:18px; border:1px dashed #c9cec6; color:#747c72; background:#fff; font-size:11px; text-align:center; }
  .totals-heading { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin:30px 0 10px; padding-bottom:8px; border-bottom:2px solid #087f9b; }
  .totals-heading h2 { margin:0; color:#252b24; font-size:18px; }
  .totals-heading span { color:#747c72; font-size:10px; }
  .matchup-summary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; padding:12px; }
  .matchup-summary > div { display:grid; grid-template-columns:auto minmax(0,1fr); gap:3px 10px; padding:11px; border:1px solid #dde2da; background:#f8faf7; }
  .matchup-summary strong { grid-row:1 / span 2; align-self:center; color:#596158; font-size:15px; }
  .matchup-summary .mmp strong { color:#287467; }
  .matchup-summary .fmp strong { color:#896817; }
  .matchup-summary span { color:#2d332c; font-size:11px; font-weight:680; }
  .matchup-summary small { color:#747c72; font-size:9px; }
  .table-scroll { max-width:100%; overflow:auto; }
  table { width:max-content; min-width:100%; border-collapse:collapse; font-size:11px; }
  th,td { height:36px; padding:5px 9px; border-bottom:1px solid #e3e6e1; text-align:right; white-space:nowrap; }
  thead th { color:#6d756b; background:#fbfcfa; font-size:9px; text-transform:uppercase; }
  th:first-child { position:sticky; left:0; min-width:130px; color:#2d332c; background:#fff; text-align:left; }
  tbody tr:last-child > * { border-bottom:0; }
  tbody tr:hover > * { background:#f8faf7; }
  tbody th a { color:#087f9b; text-decoration:none; }
  @media(max-width:560px){.stats-page{width:calc(100% - 18px)}.game-disclosure > summary{grid-template-columns:30px minmax(0,1fr) 42px 18px}.game-list time{display:none}.matchup-summary{grid-template-columns:1fr}.game-breakdown{padding:8px}.game-breakdown-actions{align-items:flex-start;flex-direction:column}}
</style>
