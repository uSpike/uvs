<script lang="ts">
  import '../app.css';
  import { LogIn, LogOut, Shield, Users } from '@lucide/svelte';
  import { asset, resolve } from '$app/paths';

  let { data, children } = $props();
</script>

<svelte:head>
  <title>Ultimate Video Stats</title>
  <meta
    name="description"
    content="Team game library, statistics recorder, and interactive panorama viewer."
  />
</svelte:head>

<div class="application-shell" class:full-bleed={data.fullBleed} class:page-scroll={data.pageScroll}>
  {#if !data.fullBleed}
  <header class="application-header">
    <a
      class="application-brand"
      href={data.role === 'admin' ? resolve('/admin') : data.role === 'player' ? resolve(`/teams/${data.teamSlug}`) : resolve('/login')}
    >
      <img class="application-brand-mark" src={asset('/favicon.svg')} alt="" />
      <span>Ultimate Video Stats</span>
    </a>

    <nav aria-label="Application navigation">
      {#if data.role === 'admin'}
        <a href={resolve('/teams')}><Users size={16} aria-hidden="true" />Teams</a>
      {:else if data.role === 'player'}
        <a href={resolve(`/teams/${data.teamSlug}`)}><Users size={16} aria-hidden="true" />Team</a>
      {/if}
      {#if data.role === 'admin'}
        <a href={resolve('/admin')}><Shield size={16} aria-hidden="true" />Admin</a>
      {/if}
    </nav>

    <div class="session-actions">
      {#if data.role === 'guest'}
        <a class="quiet-command" href={resolve('/login')}>
          <LogIn size={16} aria-hidden="true" />
          Sign in
        </a>
      {:else}
        <span class="role-label">{data.role === 'player' ? 'team player' : data.role}</span>
        <form method="POST" action={resolve('/logout')}>
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
