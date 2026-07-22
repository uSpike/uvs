<script lang="ts">
  import { ArrowLeft, Pencil, Play, Video } from '@lucide/svelte';
  import { resolve } from '$app/paths';

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.team.name} - Ultimate Video Stats</title>
</svelte:head>

<section class="games-page">
  <a class="back-link" href={resolve('/teams')}><ArrowLeft size={16} aria-hidden="true" />Teams</a>
  <header class="page-heading">
    <div>
      <h1>{data.team.name}</h1>
      <p>{data.team.games.length} {data.team.games.length === 1 ? 'game' : 'games'}</p>
    </div>
    {#if data.role === 'admin'}
      <a class="edit-command" href={resolve(`/admin/teams/${data.team.slug}`)}><Pencil size={14} aria-hidden="true" />Edit team</a>
    {/if}
  </header>

  {#if data.tournaments.length === 0}
    <div class="games-empty">
      <Video size={28} aria-hidden="true" />
      <span>No events have been added for this team.</span>
    </div>
  {:else}
    <div class="tournament-groups">
      {#each data.tournaments as tournament}
        {@const games = data.team.games.filter((game) => game.tournamentId === tournament.id)}
          <section class="tournament-group">
            <header>
              <div>
                <h2>{tournament.name}</h2>
                <p>{tournament.seasonRosterName} · {games.length} {games.length === 1 ? 'game' : 'games'}</p>
              </div>
              <div class="tournament-actions">
                <a href={resolve(`/teams/${data.team.slug}/tournaments/${tournament.id}`)}>Event stats</a>
                {#if data.role === 'admin'}
                  <a class="edit-command" href={resolve(`/admin/teams/${data.team.slug}?season=${tournament.seasonRosterId}&tournament=${tournament.id}`)}><Pencil size={13} aria-hidden="true" />Edit event</a>
                {/if}
              </div>
            </header>
            {#if games.length === 0}
              <p class="tournament-empty">No games have been added to this event.</p>
            {:else}
              <div class="game-grid">
                {#each games as game}
                  {@const score = data.scores[game.id]}
                  <div class="game-card-shell">
                    <a class="game-card" href={resolve(`/games/${game.token}`)}>
                      <div class="game-thumbnail">
                        <Play size={25} fill="currentColor" aria-hidden="true" />
                        {#if score}
                          <span class="card-score">{score.our}–{score.opponent}</span>
                        {/if}
                      </div>
                      <div class="game-details">
                        <strong>{game.title}</strong>
                        <span>{data.team.name} vs {game.opponentName}</span>
                        <time datetime={game.playedAt ?? game.createdAt}>{new Date(game.playedAt ?? game.createdAt).toLocaleDateString()}</time>
                      </div>
                    </a>
                    {#if data.role === 'admin'}
                      <a
                        class="game-edit-command"
                        href={resolve(`/admin/games/${game.token}`)}
                        aria-label={`Edit ${game.title}`}
                        title="Edit game"
                      ><Pencil size={14} aria-hidden="true" /></a>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </section>
      {/each}
    </div>
  {/if}
</section>

<style>
  .games-page {
    width: min(1120px, calc(100% - 32px));
    height: 100%;
    margin-inline: auto;
    padding: 20px 0 40px;
    overflow: auto;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    margin-bottom: 10px;
    color: #596158;
    font-size: 12px;
    font-weight: 650;
    text-decoration: none;
  }

  .games-page > .page-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
  }

  .page-heading h1,
  .page-heading p { margin: 0; }

  .page-heading p { margin-top: 3px; }

  .edit-command {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 30px;
    padding: 0 9px;
    border: 1px solid #bfc7bc;
    border-radius: 4px;
    color: #4f584d;
    background: #fff;
    font-size: 11px;
    font-weight: 680;
    text-decoration: none;
    white-space: nowrap;
  }

  .edit-command:hover { border-color: #8e998c; background: #f7f9f6; }

  .game-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }

  .tournament-groups {
    display: grid;
    gap: 28px;
  }

  .tournament-group > header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid #cfd5cc;
  }

  .tournament-group h2,
  .tournament-group p {
    margin: 0;
  }

  .tournament-group h2 {
    color: #272d26;
    font-size: 16px;
  }

  .tournament-group p {
    margin-top: 3px;
    color: #727a70;
    font-size: 11px;
  }

  .tournament-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .tournament-actions > a:not(.edit-command) {
    color: #087f9b;
    font-size: 12px;
    font-weight: 680;
    text-decoration: none;
  }

  .tournament-empty {
    margin: 0;
    padding: 18px;
    border: 1px dashed #cbd1c8;
    color: #727a70;
    background: #fafbf9;
    font-size: 12px;
    text-align: center;
  }

  .game-card {
    display: grid;
    grid-template-rows: 128px auto;
    min-width: 0;
    overflow: hidden;
    border: 1px solid #cbd1c8;
    border-radius: 6px;
    background: #ffffff;
    text-decoration: none;
  }

  .game-card-shell { position: relative; min-width: 0; }
  .game-card-shell .game-card { height: 100%; }

  .game-edit-command {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 29px;
    height: 29px;
    border: 1px solid #61695f;
    border-radius: 4px;
    color: #eff3ed;
    background: rgba(25, 29, 24, 0.9);
  }

  .game-edit-command:hover { border-color: #9ba598; background: #30362e; }

  .game-card:hover {
    border-color: #929c90;
  }

  .game-thumbnail {
    position: relative;
    display: grid;
    place-items: center;
    color: #ffcf62;
    background:
      linear-gradient(155deg, rgba(255, 255, 255, 0.08), transparent 45%),
      #171a16;
  }

  .card-score {
    position: absolute;
    right: 10px;
    bottom: 9px;
    padding: 3px 6px;
    border: 1px solid #4b5049;
    border-radius: 3px;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    font-size: 12px;
    font-weight: 760;
  }

  .game-details {
    display: grid;
    gap: 5px;
    padding: 12px;
  }

  .game-details strong {
    overflow: hidden;
    color: #272d26;
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .game-details time {
    color: #727a70;
    font-size: 11px;
  }

  .game-details span {
    overflow: hidden;
    color: #555d53;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .games-empty {
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
    .games-page {
      width: calc(100% - 18px);
    }

    .game-grid {
      grid-template-columns: 1fr;
    }

    .tournament-group > header { align-items: flex-start; }
    .tournament-actions { align-items: flex-end; flex-direction: column; }
  }
</style>
