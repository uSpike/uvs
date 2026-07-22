<script lang="ts">
  import { ArrowLeft, UserRound } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import { STAT_DESCRIPTIONS as statHelp } from '$lib/stat-descriptions';

  let { data } = $props();
  const duration = (milliseconds: number): string => {
    const seconds = Math.round(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const pct = (won: number, played: number): string => played ? `${Math.round(won / played * 100)}%` : '—';
</script>

<svelte:head><title>{data.player.name} stats - Ultimate Video Stats</title></svelte:head>

<div class="player-page">
  <a class="back-link" href={resolve(`/teams/${data.team.slug}`)}><ArrowLeft size={15} />{data.team.name}</a>
  <header class="player-heading"><span><UserRound size={23} /></span><div><h1>{data.player.name}</h1><p>{data.roster.name} · {data.player.matchupRole?.toUpperCase() ?? 'matchup role not set'}</p></div></header>

  {#if data.coverage.paperPlayerGames > 0 || data.coverage.paperPointGames > 0}
    <p class="coverage-note">Paper records contribute to these totals. Playing time, O/D splits, and play-by-play fields are partial for games without complete video statistics.</p>
  {/if}

  <section class="totals-grid" aria-label="Season totals">
    <div title={statHelp.timePlayed}><span>Playing time</span><strong>{duration(data.total.timePlayedMs)}</strong></div>
    <div title={statHelp.pointsPlayed}><span>Points</span><strong>{data.total.pointsPlayed}</strong></div>
    <div title={statHelp.goals}><span>Goals</span><strong>{data.total.goals}</strong></div>
    <div title={statHelp.assists}><span>Assists</span><strong>{data.total.assists}</strong></div>
    <div title={statHelp.hockeyAssists}><span>Hockey assists</span><strong>{data.total.hockeyAssists}</strong></div>
    <div title={statHelp.blocks}><span>Blocks</span><strong>{data.total.blocks}</strong></div>
    <div title={statHelp.turnovers}><span>Turnovers</span><strong>{data.total.turnovers}</strong></div>
    <div title={statHelp.plusMinus}><span>Plus/minus</span><strong>{data.total.plusMinus > 0 ? '+' : ''}{data.total.plusMinus}</strong></div>
    <div title={statHelp.discTime}><span>Disc time</span><strong>{duration(data.total.timeWithDiscMs)}</strong></div>
  </section>

  <section class="data-section">
    <header><h2>Events</h2></header>
    <div class="table-scroll"><table><thead><tr><th>Event</th><th title={statHelp.timePlayed}>Time</th><th title={statHelp.pointsPlayed}>Pts</th><th title={statHelp.offensePointsPlayed}>O</th><th title={statHelp.offenseWinPercentage}>O%</th><th title={statHelp.defensePointsPlayed}>D</th><th title={statHelp.defenseWinPercentage}>D%</th><th title={statHelp.completions}>C</th><th title={statHelp.receptions}>R</th><th title={statHelp.turnovers}>T</th><th title={statHelp.goals}>G</th><th title={statHelp.assists}>A</th><th title={statHelp.hockeyAssists}>2A</th><th title={statHelp.blocks}>Blocks</th><th title={statHelp.plusMinus}>+/-</th><th title={statHelp.discTime}>Disc</th></tr></thead><tbody>
      {#each data.tournaments as tournament}<tr><th><a href={resolve(`/teams/${data.team.slug}/tournaments/${tournament.id}`)}>{tournament.name}</a></th><td>{duration(tournament.statistics.timePlayedMs)}</td><td>{tournament.statistics.pointsPlayed}</td><td>{tournament.statistics.oPointsPlayed}</td><td>{pct(tournament.statistics.oPointsWon,tournament.statistics.oPointsPlayed)}</td><td>{tournament.statistics.dPointsPlayed}</td><td>{pct(tournament.statistics.dPointsWon,tournament.statistics.dPointsPlayed)}</td><td>{tournament.statistics.completions}</td><td>{tournament.statistics.receptions}</td><td>{tournament.statistics.turnovers}</td><td>{tournament.statistics.goals}</td><td>{tournament.statistics.assists}</td><td>{tournament.statistics.hockeyAssists}</td><td>{tournament.statistics.blocks}</td><td>{tournament.statistics.plusMinus > 0 ? '+' : ''}{tournament.statistics.plusMinus}</td><td>{duration(tournament.statistics.timeWithDiscMs)}</td></tr>{/each}
    </tbody></table></div>
  </section>

  <section class="data-section">
    <header><h2>Games</h2></header>
    <div class="table-scroll"><table><thead><tr><th>Game</th><th title={statHelp.score}>Score</th><th title={statHelp.timePlayed}>Time</th><th title={statHelp.pointsPlayed}>Pts</th><th title={statHelp.completions}>C</th><th title={statHelp.receptions}>R</th><th title={statHelp.turnovers}>T</th><th title={statHelp.goals}>G</th><th title={statHelp.assists}>A</th><th title={statHelp.hockeyAssists}>2A</th><th title={statHelp.blocks}>Blocks</th><th title={statHelp.plusMinus}>+/-</th><th title={statHelp.discTime}>Disc</th></tr></thead><tbody>
      {#each data.games as game}<tr><th><a href={resolve(`/games/${game.token}`)}>{game.title}</a><small>vs {game.opponentName}</small></th><td>{game.ourScore}–{game.opponentScore}</td><td>{duration(game.statistics.timePlayedMs)}</td><td>{game.statistics.pointsPlayed}</td><td>{game.statistics.completions}</td><td>{game.statistics.receptions}</td><td>{game.statistics.turnovers}</td><td>{game.statistics.goals}</td><td>{game.statistics.assists}</td><td>{game.statistics.hockeyAssists}</td><td>{game.statistics.blocks}</td><td>{game.statistics.plusMinus > 0 ? '+' : ''}{game.statistics.plusMinus}</td><td>{duration(game.statistics.timeWithDiscMs)}</td></tr>{/each}
    </tbody></table></div>
  </section>
</div>

<style>
  .player-page { width:min(1120px,calc(100% - 32px)); height:100%; margin:auto; padding:20px 0 48px; overflow:auto; }
  .back-link { display:inline-flex; align-items:center; gap:5px; margin-bottom:10px; color:#596158; font-size:12px; font-weight:650; text-decoration:none; }
  .player-heading { display:flex; align-items:center; gap:11px; margin-bottom:18px; }
  .player-heading > span { display:grid; place-items:center; width:42px; height:42px; border:1px solid #bdd3d6; border-radius:6px; color:#087f9b; background:#edf7f8; }
  .player-heading h1,.player-heading p,.data-section h2 { margin:0; }
  .player-heading h1 { font-size:22px; }
  .player-heading p { margin-top:3px; color:#687066; font-size:11px; }
  .coverage-note { margin:0 0 14px; padding:9px 11px; border:1px solid #d9c98e; color:#655719; background:#fff8dc; font-size:10px; }
  .totals-grid { display:grid; grid-template-columns:repeat(9,minmax(90px,1fr)); margin-bottom:22px; border:1px solid #cfd5cc; background:#fff; }
  .totals-grid div { display:grid; gap:5px; padding:11px; border-left:1px solid #e0e4de; }
  .totals-grid div:first-child { border-left:0; }
  .totals-grid span { color:#737b71; font-size:9px; font-weight:700; text-transform:uppercase; }
  .totals-grid strong { color:#272d26; font-size:17px; }
  .data-section { margin-bottom:20px; border:1px solid #cfd5cc; background:#fff; }
  .data-section > header { padding:10px 12px; border-bottom:1px solid #dce1d9; background:#f7f9f6; }
  .data-section h2 { font-size:14px; }
  .table-scroll { max-width:100%; overflow:auto; }
  table { width:max-content; min-width:100%; border-collapse:collapse; font-size:10px; }
  th,td { height:36px; padding:5px 9px; border-bottom:1px solid #e3e6e1; text-align:right; white-space:nowrap; }
  thead th { color:#6d756b; background:#fbfcfa; font-size:8px; text-transform:uppercase; }
  th:first-child { position:sticky; left:0; min-width:150px; color:#2d332c; background:#fff; text-align:left; }
  tbody tr:last-child > * { border-bottom:0; }
  tbody tr:hover > * { background:#f8faf7; }
  tbody th a { display:block; color:#087f9b; text-decoration:none; }
  tbody th small { display:block; margin-top:2px; color:#777f75; font-weight:400; }
  @media(max-width:900px){.totals-grid{grid-template-columns:repeat(3,1fr)}.totals-grid div:nth-child(3n+1){border-left:0}.totals-grid div{border-top:1px solid #e0e4de}}
  @media(max-width:520px){.player-page{width:calc(100% - 18px)}}
</style>
