<script lang="ts">
  import '../app.css';
  import { Crosshair, LogIn, LogOut, Shield, Users } from '@lucide/svelte';

  let { data, children } = $props();
</script>

<svelte:head>
  <title>Reco Games</title>
  <meta
    name="description"
    content="Team game library and interactive panorama viewer for Reco exports."
  />
</svelte:head>

<div class="application-shell" class:full-bleed={data.fullBleed} class:page-scroll={data.pageScroll}>
  {#if !data.fullBleed}
  <header class="application-header">
    <a
      class="application-brand"
      href={data.role === 'admin' ? '/admin' : data.role === 'player' ? `/teams/${data.teamSlug}` : '/login'}
    >
      <Crosshair size={20} strokeWidth={2.2} aria-hidden="true" />
      <span>Reco Games</span>
    </a>

    <nav aria-label="Application navigation">
      {#if data.role === 'admin'}
        <a href="/teams"><Users size={16} aria-hidden="true" />Teams</a>
      {:else if data.role === 'player'}
        <a href={`/teams/${data.teamSlug}`}><Users size={16} aria-hidden="true" />Team</a>
      {/if}
      {#if data.role === 'admin'}
        <a href="/admin"><Shield size={16} aria-hidden="true" />Admin</a>
      {/if}
    </nav>

    <div class="session-actions">
      {#if data.role === 'guest'}
        <a class="quiet-command" href="/login">
          <LogIn size={16} aria-hidden="true" />
          Sign in
        </a>
      {:else}
        <span class="role-label">{data.role === 'player' ? 'team player' : data.role}</span>
        <form method="POST" action="/logout">
          <button class="icon-command" type="submit" aria-label="Sign out" title="Sign out">
            <LogOut size={17} aria-hidden="true" />
          </button>
        </form>
      {/if}
    </div>
  </header>
  {/if}

  <main class="application-content">
    {@render children()}
  </main>
</div>
