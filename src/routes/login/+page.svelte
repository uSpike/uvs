<script lang="ts">
  import { KeyRound, LogIn } from '@lucide/svelte';

  let { data, form } = $props();
</script>

<svelte:head>
  <title>Sign in - Reco Games</title>
</svelte:head>

<section class="auth-page">
  <form class="auth-form" method="POST">
    <div class="section-heading">
      <KeyRound size={22} aria-hidden="true" />
      <div>
        <h1>Sign in</h1>
        <p>Choose your team or administrator access.</p>
      </div>
    </div>

    {#if form?.invalid}
      <p class="form-message error" role="alert">That password was not recognized.</p>
    {/if}

    <label class="field-label" for="team-slug">Access</label>
    <select id="team-slug" name="teamSlug">
      <option value="">Administrator</option>
      {#each data.teams as team}
        <option value={team.slug} selected={form?.teamSlug === team.slug}>{team.name}</option>
      {/each}
    </select>

    <label class="field-label" for="password">Password</label>
    <input
      id="password"
      name="password"
      type="password"
      autocomplete="current-password"
      required
    />
    <button class="primary-command" type="submit">
      <LogIn size={17} aria-hidden="true" />
      Sign in
    </button>
  </form>
</section>
