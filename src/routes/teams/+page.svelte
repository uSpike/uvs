<script lang="ts">
  import { ChevronRight, Users } from '@lucide/svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Teams - Reco Games</title>
</svelte:head>

<section class="library-page">
  <header class="page-heading">
    <h1>Teams</h1>
    <p>{data.teams.length} team {data.teams.length === 1 ? 'library' : 'libraries'}</p>
  </header>

  {#if data.teams.length === 0}
    <div class="library-empty">
      <Users size={28} aria-hidden="true" />
      <span>No teams are available.</span>
    </div>
  {:else}
    <div class="team-list">
      {#each data.teams as team}
        <a class="team-row" href={`/teams/${team.slug}`}>
          <span class="team-icon"><Users size={18} aria-hidden="true" /></span>
          <span class="team-name">{team.name}</span>
          <span class="game-count">{team.gameCount} {team.gameCount === 1 ? 'game' : 'games'}</span>
          <ChevronRight size={18} aria-hidden="true" />
        </a>
      {/each}
    </div>
  {/if}
</section>

<style>
  .library-page {
    width: min(980px, calc(100% - 32px));
    height: 100%;
    margin-inline: auto;
    padding: 26px 0 40px;
    overflow: auto;
  }

  .library-page > .page-heading {
    margin-bottom: 18px;
  }

  .team-list {
    border: 1px solid #cfd5cc;
    background: #ffffff;
  }

  .team-row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto 22px;
    align-items: center;
    gap: 12px;
    min-height: 62px;
    padding: 8px 14px;
    border-top: 1px solid #e0e4de;
    text-decoration: none;
  }

  .team-row:first-child {
    border-top: 0;
  }

  .team-row:hover {
    background: #f7f9f6;
  }

  .team-icon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid #c4d7da;
    border-radius: 5px;
    color: #087f9b;
    background: #edf7f8;
  }

  .team-name {
    overflow: hidden;
    color: #262c25;
    font-size: 14px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .game-count {
    color: #70786e;
    font-size: 12px;
  }

  .library-empty {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 9px;
    min-height: 180px;
    border: 1px solid #cfd5cc;
    color: #71796f;
    background: #ffffff;
    font-size: 13px;
  }

  @media (max-width: 520px) {
    .library-page {
      width: calc(100% - 18px);
    }

    .team-row {
      grid-template-columns: 36px minmax(0, 1fr) 22px;
    }

    .game-count {
      display: none;
    }
  }
</style>
