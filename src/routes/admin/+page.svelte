<script lang="ts">
  import { ChevronRight, FolderPlus, Plus, Settings, Shield } from '@lucide/svelte';
  import { resolve } from '$app/paths';

  let { data, form } = $props();
</script>

<svelte:head>
  <title>Admin - Ultimate Video Stats</title>
</svelte:head>

<div class="admin-page">
  <header class="page-heading">
    <div>
      <h1>Administration</h1>
      <p>{data.teams.length} {data.teams.length === 1 ? 'team' : 'teams'}</p>
    </div>
    <Shield size={22} color="#087f9b" aria-hidden="true" />
  </header>

  <div class="admin-workspace">
    <section class="admin-section" aria-labelledby="new-team-heading">
      <div class="section-heading">
        <FolderPlus size={19} aria-hidden="true" />
        <div>
          <h2 id="new-team-heading">New team</h2>
        </div>
      </div>

      {#if form?.action === 'createTeam' && form?.error}
        <p class="form-message error" role="alert">{form.error}</p>
      {:else if form?.action === 'createTeam' && form?.success}
        <p class="form-message success" role="status">Team created.</p>
      {/if}

      <form class="stacked-form" method="POST" action="?/createTeam">
        <label class="field-label" for="team-name">Team name</label>
        <input
          id="team-name"
          name="name"
          type="text"
          maxlength="120"
          value={form?.action === 'createTeam' ? form?.name ?? '' : ''}
          required
        />
        <label class="field-label" for="team-password">Team password</label>
        <input
          id="team-password"
          name="password"
          type="text"
          autocomplete="off"
          required
        />
        <p class="field-help">Players use this shared password to access the team.</p>
        <button class="secondary-command" type="submit">
          <Plus size={16} aria-hidden="true" />
          Add team
        </button>
      </form>
    </section>

  </div>

  <section class="catalog-section team-catalog" aria-labelledby="team-catalog-heading">
    <div class="catalog-header">
      <div class="page-heading">
        <div>
          <h2 id="team-catalog-heading">Teams</h2>
          <p>Manage season rosters, events, attendance, and lines</p>
        </div>
      </div>
    </div>

    {#if data.teams.length === 0}
      <div class="empty-list">No teams have been added.</div>
    {:else}
      <div class="team-card-grid">
        {#each data.teams as team}
          <a class="team-card" href={resolve(`/admin/teams/${team.slug}`)}>
            <span class="team-card-icon"><Settings size={18} aria-hidden="true" /></span>
            <span class="team-card-copy">
              <strong>{team.name}</strong>
              <small>{team.gameCount} {team.gameCount === 1 ? 'game' : 'games'} · Rosters, events & lines</small>
            </span>
            <ChevronRight size={17} aria-hidden="true" />
          </a>
        {/each}
      </div>
    {/if}
  </section>

</div>

<style>
  .admin-page {
    height: 100%;
    overflow: auto;
    background: #f2f4f0;
  }

  .admin-page > .page-heading,
  .admin-workspace,
  .catalog-section {
    width: min(1180px, calc(100% - 32px));
    margin-inline: auto;
  }

  .admin-page > .page-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24px 0 18px;
  }

  .admin-workspace {
    border-block: 1px solid #cfd5cc;
    background: #ffffff;
  }

  .admin-section {
    display: grid;
    align-content: start;
    gap: 16px;
    padding: 20px;
  }

  .stacked-form {
    display: grid;
    gap: 11px;
    min-width: 0;
  }

  .catalog-section {
    padding: 26px 0 40px;
  }

  .team-catalog { padding-bottom: 0; }

  .catalog-header .page-heading p {
    margin: 4px 0 0;
    color: #687066;
    font-size: 12px;
  }

  .catalog-header {
    margin-bottom: 12px;
  }

  .team-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 9px;
  }

  .team-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 11px;
    min-height: 68px;
    padding: 11px 13px;
    color: #293029;
    background: #fff;
    border: 1px solid #cfd5cc;
    text-decoration: none;
  }

  .team-card:hover {
    background: #f4faf9;
    border-color: #80bdc8;
  }

  .team-card-icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    color: #087f9b;
    background: #e8f5f7;
    border-radius: 50%;
  }

  .team-card-copy { display: grid; gap: 4px; min-width: 0; }
  .team-card-copy strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
  .team-card-copy small { color: #687066; font-size: 10px; }
  .team-card > :global(svg) { color: #788078; }

  .empty-list {
    display: grid;
    place-items: center;
    min-height: 120px;
    border: 1px solid #cfd5cc;
    color: #737b71;
    background: #ffffff;
    font-size: 13px;
  }

  @media (max-width: 500px) {
    .admin-page > .page-heading,
    .admin-workspace,
    .catalog-section {
      width: calc(100% - 18px);
    }
  }
</style>
