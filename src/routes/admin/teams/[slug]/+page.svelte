<script lang="ts">
  import { enhance } from '$app/forms';
  import { ArrowLeft, CalendarDays, ExternalLink, FileJson, KeyRound, Pencil, Plus, Save, Trash2, Users, X } from '@lucide/svelte';
  import { tick } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';

  let { data, form } = $props();
  let expandedPlayerRosterIds = $state<Set<number>>(new Set());
  let expandedTournamentRosterIds = $state<Set<number>>(new Set());
  let expandedGameCreateTournamentIds = $state<Set<number>>(new Set());
  let paperOnlyGameTournamentIds = $state<Set<number>>(new Set());
  let editingNameKey = $state<string | null>(null);

  async function beginNameEdit(key: string, inputId: string): Promise<void> {
    editingNameKey = key;
    await tick();
    const input = document.getElementById(inputId);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }

  function finishNameEdit(key: string): SubmitFunction {
    return () => async ({ result, update }) => {
      await update({ reset: false });
      if (result.type === 'success' && editingNameKey === key) editingNameKey = null;
    };
  }

  function setPlayerManagerExpanded(rosterId: number, expanded: boolean): void {
    const next = new Set(expandedPlayerRosterIds);
    if (expanded) next.add(rosterId);
    else next.delete(rosterId);
    expandedPlayerRosterIds = next;
  }

  function setTournamentRosterExpanded(tournamentId: number, expanded: boolean): void {
    const next = new Set(expandedTournamentRosterIds);
    if (expanded) next.add(tournamentId);
    else next.delete(tournamentId);
    expandedTournamentRosterIds = next;
  }

  function setGameCreateExpanded(tournamentId: number, expanded: boolean): void {
    const next = new Set(expandedGameCreateTournamentIds);
    if (expanded) next.add(tournamentId);
    else next.delete(tournamentId);
    expandedGameCreateTournamentIds = next;
  }

  function setGameHasVideo(tournamentId: number, hasVideo: boolean): void {
    const next = new Set(paperOnlyGameTournamentIds);
    if (hasVideo) next.delete(tournamentId);
    else next.add(tournamentId);
    paperOnlyGameTournamentIds = next;
  }

  function keepPlayerEntryFocused(rosterId: number): SubmitFunction {
    return () => async ({ result, update }) => {
      await update({ reset: result.type === 'success' });
      await tick();
      document.getElementById(`player-name-${rosterId}`)?.focus();
    };
  }

  function saveAttendanceInPlace(): SubmitFunction {
    return () => async ({ update }) => {
      await update({ reset: false });
    };
  }

  function confirmDeletion(message: string): SubmitFunction {
    return ({ cancel }) => {
      if (!window.confirm(message)) {
        cancel();
      }
    };
  }

  function enhanceLine(lineName: string, editKey: string): SubmitFunction {
    return ({ action, cancel }) => {
      if (action.search === '?/deleteLine' && !window.confirm(`Delete ${lineName}?`)) {
        cancel();
      }
      return async ({ result, update }) => {
        await update({ reset: false });
        if (result.type === 'success' && editingNameKey === editKey) editingNameKey = null;
      };
    };
  }
</script>

<svelte:head>
  <title>{data.setup.name} seasons - Ultimate Video Stats</title>
</svelte:head>

<div class="setup-page">
  <header class="setup-header">
    <a class="icon-command" href="/admin" aria-label="Back to administration">
      <ArrowLeft size={17} aria-hidden="true" />
    </a>
    <div>
      <h1>{data.setup.name}</h1>
      <p>Team administration</p>
    </div>
  </header>

  <nav class="admin-tabs" aria-label="Team administration">
    <a class:active={data.activeTab === 'setup'} href={`/admin/teams/${data.setup.slug}`} aria-current={data.activeTab === 'setup' ? 'page' : undefined}>Seasons</a>
    <a class:active={data.activeTab === 'access'} href={`/admin/teams/${data.setup.slug}?tab=access`} aria-current={data.activeTab === 'access' ? 'page' : undefined}>Access</a>
  </nav>

  {#if form?.error}
    <p class="form-message error page-message" role="alert">{form.error}</p>
  {:else if form?.success}
    <p class="form-message success page-message" role="status">Saved.</p>
  {/if}

  {#if data.activeTab === 'access'}
    <section class="setup-card team-access-card">
      <div class="section-heading">
        <KeyRound size={19} aria-hidden="true" />
        <div>
          <h2>Player access</h2>
          <p>Anyone with this shared password can view team videos and edit stats.</p>
        </div>
      </div>
      <form class="access-form" method="POST" action="?/updateTeamPassword&tab=access">
        <label>
          <span class="field-label">Shared password</span>
          <input
            name="password"
            type="text"
            value={data.teamPassword ?? ''}
            autocomplete="off"
            placeholder={data.teamPassword === null ? 'Set a new password' : ''}
            required
          />
          {#if data.teamPassword === null}
            <small>The existing password was stored as a one-way hash. Set it once here to make it visible.</small>
          {/if}
        </label>
        <button class="secondary-command" type="submit"><Save size={14} />Save password</button>
      </form>
    </section>
  {:else}
    <nav class="season-tabs" aria-label="Season rosters">
      {#each data.setup.rosters as roster}
        <a
          class:active={data.setupView !== 'new-season' && data.selectedSeasonId === roster.id}
          href={`/admin/teams/${data.setup.slug}?season=${roster.id}`}
          aria-current={data.setupView !== 'new-season' && data.selectedSeasonId === roster.id ? 'page' : undefined}
        >{roster.name}</a>
      {/each}
      <a class="new-season-tab" class:active={data.setupView === 'new-season'} href={`/admin/teams/${data.setup.slug}?view=new-season`}><Plus size={13} />New season</a>
    </nav>

    {#if data.setupView === 'new-season'}
      <section class="setup-card create-roster">
        <div class="section-heading">
          <Users size={19} aria-hidden="true" />
          <div>
            <h2>New season roster</h2>
            <p>Players and tactics are season-specific.</p>
          </div>
        </div>
        <form class="inline-form" method="POST" action="?/createRoster&view=new-season">
          <input type="hidden" name="teamId" value={data.setup.id} />
          <label>
            <input name="name" type="text" maxlength="120" placeholder="2026 season" required />
          </label>
          <button class="secondary-command" type="submit"><Plus size={15} />Add roster</button>
        </form>
      </section>
    {:else}
  {#each data.setup.rosters.filter((candidate) => candidate.id === data.selectedSeasonId) as roster}
    {@const rosterTournamentCount = data.setup.tournaments.filter((tournament) => tournament.seasonRosterId === roster.id).length}
    {@const rosterEditKey = `roster:${roster.id}`}
    <div class="season-admin-layout">
      <aside class="season-navigation">
        <nav aria-label={`${roster.name} administration`}>
          <a class:active={data.seasonSection === 'players'} href={`/admin/teams/${data.setup.slug}?season=${roster.id}`}>
            <span>Players</span>
            <small>{roster.players.length} {roster.players.length === 1 ? 'player' : 'players'}</small>
          </a>
          <a class:active={data.seasonSection === 'strategies'} href={`/admin/teams/${data.setup.slug}?season=${roster.id}&section=strategies`}>
            <span>Strategies</span>
            <small>{roster.strategies.length}</small>
          </a>
          <a class:active={data.seasonSection === 'events'} href={`/admin/teams/${data.setup.slug}?season=${roster.id}&section=events`}>
            <span>Events</span>
            <small>{rosterTournamentCount}</small>
          </a>
        </nav>
      </aside>
      <main class="season-detail">
      {#if data.seasonSection === 'players'}
    <section class="season-panel roster-card">
      <header class="card-header">
        <div class="entity-heading">
          <small class="entity-kind roster-kind">Season roster</small>
          {#if editingNameKey === rosterEditKey}
            <form
              class="name-edit-form heading-name-edit"
              method="POST"
              action="?/renameRoster"
              use:enhance={finishNameEdit(rosterEditKey)}
            >
              <input type="hidden" name="seasonRosterId" value={roster.id} />
              <input
                id={`roster-name-${roster.id}`}
                name="name"
                value={roster.name}
                maxlength="120"
                aria-label="Roster name"
                required
              />
              <button class="name-icon-button save-name-button" type="submit" aria-label="Save roster name" title="Save name"><Save size={13} /></button>
              <button class="name-icon-button" type="button" aria-label="Cancel editing roster name" title="Cancel" onclick={() => editingNameKey = null}><X size={13} /></button>
            </form>
          {:else}
            <div class="name-display">
              <h2>{roster.name}</h2>
              <button
                class="name-icon-button"
                type="button"
                aria-label={`Edit ${roster.name} name`}
                title="Edit name"
                onclick={() => beginNameEdit(rosterEditKey, `roster-name-${roster.id}`)}
              ><Pencil size={12} /></button>
            </div>
          {/if}
          <p>
            {roster.players.length} {roster.players.length === 1 ? 'player' : 'players'} ·
            {rosterTournamentCount} {rosterTournamentCount === 1 ? 'event' : 'events'}
          </p>
        </div>
        <div class="card-header-actions">
          <form
            method="POST"
            action="?/deleteRoster"
            use:enhance={confirmDeletion(`Delete ${roster.name} and all of its players, events, and lines?`)}
          >
            <input type="hidden" name="seasonRosterId" value={roster.id} />
            <button
              class="icon-command delete-roster"
              type="submit"
              aria-label={`Delete ${roster.name}`}
              title="Delete roster"
            ><Trash2 size={15} /></button>
          </form>
        </div>
      </header>

        <div class="roster-workspace">
          <div class="player-manager">
          <h3>Players</h3>
          <form
            class="inline-form compact-form player-add-form"
            method="POST"
            action="?/addPlayer"
            use:enhance={keepPlayerEntryFocused(roster.id)}
          >
            <input type="hidden" name="seasonRosterId" value={roster.id} />
            <label>
              <span class="field-label">Player name</span>
              <input
                id={`player-name-${roster.id}`}
                name="name"
                type="text"
                maxlength="120"
                autocomplete="off"
                required
              />
            </label>
            <label>
              <span class="field-label">Role</span>
              <select name="matchupRole" required>
                <option value="" disabled selected>Choose</option>
                <option value="mmp">MMP</option>
                <option value="fmp">FMP</option>
              </select>
            </label>
            <button class="secondary-command" type="submit"><Plus size={14} />Add</button>
          </form>
          <details
            class="player-list-disclosure"
            open={expandedPlayerRosterIds.has(roster.id)}
            ontoggle={(event) => setPlayerManagerExpanded(roster.id, event.currentTarget.open)}
          >
          <summary class="roster-list-summary">
            <strong>Rostered players</strong>
            <span>{roster.players.length} {roster.players.length === 1 ? 'player' : 'players'}</span>
          </summary>
          <div class="player-manager-content">
          {#if roster.players.length === 0}
            <p class="empty-copy">No players yet.</p>
          {:else}
            <ul class="plain-list">
              {#each roster.players as player}
                {@const playerEditKey = `player:${player.id}`}
					<li class:editing-player={editingNameKey === playerEditKey}>
						<div class="player-name-area">
							{#if editingNameKey === playerEditKey}
								<form
									id={`player-edit-form-${player.id}`}
									class="name-edit-form player-name-edit"
									method="POST"
									action="?/renamePlayer"
                        use:enhance={finishNameEdit(playerEditKey)}
                      >
                        <input type="hidden" name="playerId" value={player.id} />
                        <input
                          id={`player-edit-name-${player.id}`}
                          name="name"
                          value={player.name}
                          maxlength="120"
                          aria-label={`Name for ${player.name}`}
                          required
                        />
									<select name="matchupRole" aria-label={`Preferred matchup role for ${player.name}`} required>
										<option value="mmp" selected={player.matchupRole === 'mmp'}>MMP</option>
										<option value="fmp" selected={player.matchupRole === 'fmp'}>FMP</option>
									</select>
								</form>
							{:else}
								<span class="player-display-name">{player.name}</span>
                      <span
                        class:missing={player.matchupRole === null}
                        class:mmp={player.matchupRole === 'mmp'}
                        class:fmp={player.matchupRole === 'fmp'}
                        class="matchup-role-badge"
								>
									{player.matchupRole?.toUpperCase() ?? 'Set role'}
								</span>
							{/if}
						</div>
						<div class="player-row-actions">
							{#if editingNameKey === playerEditKey}
								<button
									class="player-row-icon save-name-button"
									type="submit"
									form={`player-edit-form-${player.id}`}
									aria-label={`Save ${player.name} name`}
									title="Save name"
								><Save size={11} /></button>
							{:else}
								<button
									class="player-row-icon"
									type="button"
									aria-label={`Edit ${player.name} name`}
									title="Edit name"
									onclick={() => beginNameEdit(playerEditKey, `player-edit-name-${player.id}`)}
								><Pencil size={10} /></button>
							{/if}
							<form
								method="POST"
								action="?/deletePlayer"
								use:enhance={confirmDeletion(`Delete ${player.name} from the season roster and every unused lineup?`)}
							>
								<input type="hidden" name="playerId" value={player.id} />
								<button
									class="player-row-icon delete-player"
									type="submit"
									aria-label={`Delete ${player.name}`}
									title="Delete player"
								><Trash2 size={11} /></button>
							</form>
						</div>
					</li>
              {/each}
            </ul>
          {/if}
          </div>
          </details>
          </div>

        </div>
    </section>
      {:else if data.seasonSection === 'strategies'}
        <section class="season-panel strategy-card">
          <div class="section-heading">
            <div>
              <h2>Strategies</h2>
              <p>Offenses and defenses available to live and paper stats for this season.</p>
            </div>
          </div>
          <div class="strategy-manager">
            <div class="strategy-summary">
              <div>
                <h3>Offenses & defenses</h3>
                <p>These choices are shared by live and paper stats. The default starts each point.</p>
              </div>
              <span>{roster.strategies.filter((strategy) => strategy.kind === 'offense').length} O · {roster.strategies.filter((strategy) => strategy.kind === 'defense').length} D</span>
            </div>
            <div class="strategy-columns">
              {#each ['offense', 'defense'] as kind}
                <div class="strategy-kind-group">
                  <h4>{kind === 'offense' ? 'Offenses' : 'Defenses'}</h4>
                  <ul class="strategy-list">
                    {#each roster.strategies.filter((strategy) => strategy.kind === kind) as strategy}
                      {@const strategyEditKey = `strategy:${strategy.id}`}
                      <li>
                        {#if editingNameKey === strategyEditKey}
                          <form
                            id={`strategy-edit-form-${strategy.id}`}
                            class="strategy-edit-form"
                            method="POST"
                            action="?/updateStrategy"
                            use:enhance={finishNameEdit(strategyEditKey)}
                          >
                            <input type="hidden" name="strategyId" value={strategy.id} />
                            <input
                              id={`strategy-name-${strategy.id}`}
                              name="name"
                              value={strategy.name}
                              maxlength="80"
                              aria-label={`${kind} name`}
                              required
                            />
                            {#if strategy.isDefault}
                              <input type="hidden" name="makeDefault" value="on" />
                              <span class="default-badge">Default</span>
                            {:else}
                              <label class="default-check">
                                <input name="makeDefault" type="checkbox" />
                                Make default
                              </label>
                            {/if}
                          </form>
                          <button
                            class="player-row-icon save-name-button"
                            type="submit"
                            form={`strategy-edit-form-${strategy.id}`}
                            aria-label={`Save ${strategy.name}`}
                            title="Save"
                          ><Save size={11} /></button>
                        {:else}
                          <span class="strategy-name">{strategy.name}</span>
                          {#if strategy.isDefault}
                            <span class="default-badge">Default</span>
                          {:else}
                            <form method="POST" action="?/updateStrategy" use:enhance={saveAttendanceInPlace()}>
                              <input type="hidden" name="strategyId" value={strategy.id} />
                              <input type="hidden" name="name" value={strategy.name} />
                              <input type="hidden" name="makeDefault" value="on" />
                              <button class="default-command" type="submit">Make default</button>
                            </form>
                          {/if}
                          <button
                            class="player-row-icon"
                            type="button"
                            aria-label={`Edit ${strategy.name}`}
                            title="Edit"
                            onclick={() => beginNameEdit(strategyEditKey, `strategy-name-${strategy.id}`)}
                          ><Pencil size={10} /></button>
                          <form
                            method="POST"
                            action="?/deleteStrategy"
                            use:enhance={confirmDeletion(`Delete ${strategy.name}?`)}
                          >
                            <input type="hidden" name="strategyId" value={strategy.id} />
                            <button class="player-row-icon delete-player" type="submit" aria-label={`Delete ${strategy.name}`} title="Delete">
                              <Trash2 size={11} />
                            </button>
                          </form>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                  <form class="strategy-add-form" method="POST" action="?/addStrategy" use:enhance={saveAttendanceInPlace()}>
                    <input type="hidden" name="seasonRosterId" value={roster.id} />
                    <input type="hidden" name="kind" value={kind} />
                    <input name="name" maxlength="80" placeholder={`New ${kind}`} aria-label={`New ${kind} name`} required />
                    <button class="secondary-command" type="submit"><Plus size={13} />Add</button>
                  </form>
                </div>
              {/each}
            </div>
          </div>
        </section>
      {:else}
        <nav class="event-tabs" aria-label={`${roster.name} events`}>
          {#each data.setup.tournaments.filter((tournament) => tournament.seasonRosterId === roster.id) as tournament}
            <a class:active={data.setupView === 'tournament' && data.selectedTournamentId === tournament.id} href={`/admin/teams/${data.setup.slug}?season=${roster.id}&section=events&tournament=${tournament.id}`}>
              <span>{tournament.name}</span>
              <small>{tournament.gameCount} {tournament.gameCount === 1 ? 'game' : 'games'}</small>
            </a>
          {/each}
          <a class="new-event-tab" class:active={data.setupView === 'new-tournament'} href={`/admin/teams/${data.setup.slug}?season=${roster.id}&section=events&view=new-tournament`}><Plus size={13} />New event</a>
        </nav>
      {#if data.setupView === 'new-tournament'}
        <section class="season-panel focused-create-card">
          <form class="tournament-create" method="POST" action={`?/createTournament&season=${roster.id}&view=new-tournament`}>
            <input type="hidden" name="seasonRosterId" value={roster.id} />
            <div class="section-heading">
              <CalendarDays size={19} aria-hidden="true" />
              <div>
                <h2>New event</h2>
                <p>Everyone on the season roster is selected initially.</p>
              </div>
            </div>
            <div class="tournament-fields">
              <label>
                <span class="field-label">Name</span>
                <input name="name" type="text" maxlength="160" required />
              </label>
              <label>
                <span class="field-label">Starts</span>
                <input name="startsOn" type="date" />
              </label>
              <label>
                <span class="field-label">Ends</span>
                <input name="endsOn" type="date" />
              </label>
            </div>
            <button class="primary-command" type="submit" disabled={roster.players.length === 0}>
              <CalendarDays size={15} />Create event
            </button>
            {#if roster.players.length === 0}<p class="empty-copy">Add players to this season roster before creating an event.</p>{/if}
          </form>
        </section>
      {:else}
    {#each data.setup.tournaments.filter((tournament) => tournament.id === data.selectedTournamentId) as tournament}
      {@const gameFormValues = form?.action === 'createGame' && Number(form?.values?.tournamentId) === tournament.id ? form.values : null}
      {@const gameHasVideo = gameFormValues ? gameFormValues.hasVideo !== false : !paperOnlyGameTournamentIds.has(tournament.id)}
      {@const tournamentEditKey = `tournament:${tournament.id}`}
        <section id={`tournament-${tournament.id}`} class="season-panel tournament-card">
          <header class="card-header tournament-header">
            <div class="entity-heading">
              <small class="entity-kind tournament-kind">Event</small>
              {#if editingNameKey === tournamentEditKey}
                <form
                  class="name-edit-form heading-name-edit"
                  method="POST"
                  action="?/renameTournament"
                  use:enhance={finishNameEdit(tournamentEditKey)}
                >
                  <input type="hidden" name="tournamentId" value={tournament.id} />
                  <input
                    id={`tournament-name-${tournament.id}`}
                    name="name"
                    value={tournament.name}
                    maxlength="160"
                    aria-label="Event name"
                    required
                  />
                  <button class="name-icon-button save-name-button" type="submit" aria-label="Save event name" title="Save name"><Save size={13} /></button>
                  <button
                    class="name-icon-button"
                    type="button"
                    aria-label="Cancel editing event name"
                    title="Cancel"
                    onclick={() => editingNameKey = null}
                  ><X size={13} /></button>
                </form>
              {:else}
                <div class="name-display">
                  <h2>{tournament.name}</h2>
                  <button
                    class="name-icon-button"
                    type="button"
                    aria-label={`Edit ${tournament.name} name`}
                    title="Edit name"
                    onclick={() => beginNameEdit(tournamentEditKey, `tournament-name-${tournament.id}`)}
                  ><Pencil size={12} /></button>
                </div>
              {/if}
              <p>
                {tournament.seasonRosterName}
                {#if tournament.startsOn} · {new Date(`${tournament.startsOn}T00:00:00`).toLocaleDateString()}{/if}
                · {tournament.gameCount} {tournament.gameCount === 1 ? 'game' : 'games'}
              </p>
            </div>
            <div class="tournament-header-actions">
              <a class="secondary-command" href={`/teams/${data.setup.slug}/tournaments/${tournament.id}`}>View stats</a>
              <form
                method="POST"
                action="?/deleteTournament"
                use:enhance={confirmDeletion(`Delete ${tournament.name} and all of its lines and attendance selections?`)}
              >
                <input type="hidden" name="tournamentId" value={tournament.id} />
                <button
                  class="icon-command delete-tournament"
                  type="submit"
                  aria-label={`Delete ${tournament.name}`}
                  title="Delete event"
                ><Trash2 size={15} /></button>
              </form>
            </div>
          </header>

          <div class="tournament-content">
          <section class="tournament-games" aria-labelledby={`tournament-${tournament.id}-games`}>
            <h3 id={`tournament-${tournament.id}-games`}>Games</h3>
            {#if tournament.games.length === 0}
              <p class="empty-copy">No games in this event.</p>
            {:else}
              <ul class="game-link-list">
                {#each tournament.games as game}
                  <li>
                    <a class="game-admin-link" href={`/admin/games/${game.token}`}>
                      <span>{game.title}</span>
                      <small>
                        {#if game.playedAt}{new Date(game.playedAt).toLocaleString()} · {/if}vs. {game.opponentName}
                      </small>
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                    <form
                      class="game-delete-form"
                      method="POST"
                      action="?/deleteGame"
                      use:enhance={confirmDeletion(`Delete ${game.title} and all of its statistics, highlights, and share links?`)}
                    >
                      <input type="hidden" name="gameToken" value={game.token} />
                      <button
                        class="game-delete-command"
                        type="submit"
                        aria-label={`Delete ${game.title}`}
                        title="Delete game"
                      ><Trash2 size={14} /></button>
                    </form>
                  </li>
                {/each}
              </ul>
            {/if}

            <details
              class="game-create-panel"
              open={gameFormValues !== null || expandedGameCreateTournamentIds.has(tournament.id)}
              ontoggle={(event) => setGameCreateExpanded(tournament.id, event.currentTarget.open)}
            >
              <summary class="secondary-command"><FileJson size={14} />Add game</summary>
              <form
                class="game-create-form"
                method="POST"
                enctype="multipart/form-data"
                action={`?/createGame&season=${roster.id}&tournament=${tournament.id}`}
              >
                <input type="hidden" name="tournamentId" value={tournament.id} />
                <label class="game-create-wide game-video-toggle">
                  <input
                    name="hasVideo"
                    type="checkbox"
                    checked={gameHasVideo}
                    onchange={(event) => setGameHasVideo(tournament.id, event.currentTarget.checked)}
                  />
                  <span>
                    <strong>Video available</strong>
                    <small>Turn off for a paper-statistics-only game.</small>
                  </span>
                </label>
                <label>
                  <span class="field-label">Game title</span>
                  <input name="title" maxlength="160" value={gameFormValues?.title ?? ''} required />
                </label>
                <label>
                  <span class="field-label">Opponent</span>
                  <input name="opponentName" maxlength="160" value={gameFormValues?.opponentName ?? ''} required />
                </label>
                <label>
                  <span class="field-label">Game date and time</span>
                  <input name="playedAt" type="datetime-local" value={gameFormValues?.playedAt ?? ''} />
                </label>
                <label>
                  <span class="field-label">Expected players</span>
                  <input name="playerCount" type="number" min="1" max="20" value={gameFormValues?.playerCount ?? 7} required />
                </label>
                <label>
                  <span class="field-label">Starting score — us</span>
                  <input name="initialOurScore" type="number" min="0" max="999" value={gameFormValues?.initialOurScore ?? 0} required />
                </label>
                <label>
                  <span class="field-label">Starting score — opponent</span>
                  <input name="initialOpponentScore" type="number" min="0" max="999" value={gameFormValues?.initialOpponentScore ?? 0} required />
                </label>
                {#if gameHasVideo}
                <label class="game-create-wide">
                  <span class="field-label">Video URL</span>
                  <input
                    name="videoSource"
                    inputmode="url"
                    placeholder="file:///srv/uvs/game.mp4"
                    value={gameFormValues?.videoSource ?? ''}
                    required
                  />
                </label>
                <label class="game-create-wide game-metadata-file">
                  <span class="field-label">Metadata JSONL</span>
                  <input
                    name="metadata"
                    type="file"
                    accept=".metadata.jsonl,.jsonl,.ndjson,application/x-ndjson"
                    required
                  />
                </label>
                {/if}
                <button class="primary-command game-create-wide" type="submit">
                  <Plus size={15} />Create game
                </button>
              </form>
            </details>
          </section>

          <div class="tournament-workspace">
            <form
              class="attendance-form"
              method="POST"
              action="?/saveTournamentRoster"
              use:enhance={saveAttendanceInPlace()}
            >
              <input type="hidden" name="tournamentId" value={tournament.id} />
              <details
                class="tournament-roster-disclosure"
                open={expandedTournamentRosterIds.has(tournament.id)}
                ontoggle={(event) => setTournamentRosterExpanded(tournament.id, event.currentTarget.open)}
              >
              <summary class="roster-list-summary">
                <strong>Event roster</strong>
                <span>{tournament.playerIds.length} of {roster.players.length} selected</span>
              </summary>
              <div class="attendance-content">
              <div class="check-grid">
                {#each roster.players as player}
                  <label>
                    <input
                      type="checkbox"
                      name="playerId"
                      value={player.id}
                      checked={tournament.playerIds.includes(player.id)}
                    />
                    {player.name}
                    <small class:mmp={player.matchupRole === 'mmp'} class:fmp={player.matchupRole === 'fmp'}>{player.matchupRole?.toUpperCase() ?? '?'}</small>
                  </label>
                {/each}
              </div>
              <button class="secondary-command" type="submit"><Save size={14} />Save attendance</button>
              </div>
              </details>
            </form>

            <div class="line-manager">
              <h3>Lines</h3>
              {#each tournament.lines as line}
                {@const lineEditKey = `line:${line.id}`}
                <form
                  class="line-form"
                  method="POST"
                  action="?/updateLine"
                  use:enhance={enhanceLine(line.name, lineEditKey)}
                >
                  <input type="hidden" name="lineId" value={line.id} />
                  <div class="line-name-area">
                    {#if editingNameKey === lineEditKey}
                      <input
                        id={`line-name-${line.id}`}
                        name="name"
                        type="text"
                        maxlength="80"
                        value={line.name}
                        aria-label={`Name for ${line.name}`}
                        required
                      />
                      <button class="name-icon-button save-name-button" type="submit" aria-label="Save line name" title="Save name"><Save size={13} /></button>
                      <button class="name-icon-button" type="button" aria-label="Cancel editing line name" title="Cancel" onclick={() => editingNameKey = null}><X size={13} /></button>
                    {:else}
                      <input type="hidden" name="name" value={line.name} />
                      <strong>{line.name}</strong>
                      <button
                        class="name-icon-button"
                        type="button"
                        aria-label={`Edit ${line.name} name`}
                        title="Edit name"
                        onclick={() => beginNameEdit(lineEditKey, `line-name-${line.id}`)}
                      ><Pencil size={11} /></button>
                    {/if}
                  </div>
                  <details class="line-player-editor">
                    <summary>
                      {line.playerIds.length} {line.playerIds.length === 1 ? 'player' : 'players'} selected
                    </summary>
                    <div class="check-grid line-players">
                      {#each roster.players.filter((player) => tournament.playerIds.includes(player.id)) as player}
                        <label>
                          <input
                            type="checkbox"
                            name="playerId"
                            value={player.id}
                            checked={line.playerIds.includes(player.id)}
                          />
                          {player.name}
                          <small class:mmp={player.matchupRole === 'mmp'} class:fmp={player.matchupRole === 'fmp'}>{player.matchupRole?.toUpperCase() ?? '?'}</small>
                        </label>
                      {/each}
                    </div>
                  </details>
                  <div class="line-actions">
                    {#if editingNameKey !== lineEditKey}
                      <button class="secondary-command" type="submit">Save players</button>
                    {/if}
                    <button
                      class="icon-command delete-line"
                      type="submit"
                      formaction="?/deleteLine"
                      aria-label={`Delete ${line.name}`}
                      title="Delete line"
                    ><Trash2 size={15} /></button>
                  </div>
                </form>
              {/each}

              <details class="new-line-panel">
                <summary class="secondary-command"><Plus size={14} />Add line</summary>
                <form class="line-form new-line" method="POST" action="?/createLine" use:enhance={saveAttendanceInPlace()}>
                  <input type="hidden" name="tournamentId" value={tournament.id} />
                  <label class="line-name">
                    <span class="field-label">New line name</span>
                    <input name="name" type="text" maxlength="80" placeholder="O line" required />
                  </label>
                  <div class="check-grid line-players">
                    {#each roster.players.filter((player) => tournament.playerIds.includes(player.id)) as player}
                      <label><input type="checkbox" name="playerId" value={player.id} />{player.name}<small class:mmp={player.matchupRole === 'mmp'} class:fmp={player.matchupRole === 'fmp'}>{player.matchupRole?.toUpperCase() ?? '?'}</small></label>
                    {/each}
                  </div>
                  <button class="secondary-command" type="submit"><Plus size={14} />Save new line</button>
                </form>
              </details>
            </div>
          </div>
          </div>
        </section>
    {/each}
        {#if data.selectedTournamentId === null}
          <section class="season-panel empty-event-card">
            <CalendarDays size={22} aria-hidden="true" />
            <div>
              <h2>No events yet</h2>
              <p>Create the first event for {roster.name}.</p>
            </div>
            <a class="primary-command" href={`/admin/teams/${data.setup.slug}?season=${roster.id}&section=events&view=new-tournament`}><Plus size={14} />New event</a>
          </section>
        {/if}
      {/if}
      {/if}
      </main>
    </div>
  {/each}
    {/if}
  {/if}
</div>

<style>
  .setup-page {
    height: 100%;
    padding: 0 0 48px;
    overflow: auto;
    background: #f2f4f0;
  }

  .setup-header,
  .admin-tabs,
  .season-tabs,
  .season-admin-layout,
  .page-message,
  .setup-page > .setup-card {
    width: min(1120px, calc(100% - 32px));
    margin-inline: auto;
  }

  .setup-header {
    display: flex;
    align-items: center;
    gap: 11px;
    min-height: 78px;
  }

  .setup-header h1,
  .card-header h2,
  h3 {
    margin: 0;
  }

  .setup-header h1 { font-size: 21px; }
  .setup-header p,
  .card-header p { margin: 4px 0 0; color: #687066; font-size: 12px; }
  .page-message { margin-bottom: 12px; }

  .admin-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 16px;
    border-bottom: 1px solid #cfd5cc;
  }

  .admin-tabs a {
    min-width: 82px;
    padding: 10px 14px 9px;
    border-bottom: 3px solid transparent;
    color: #657064;
    font-size: 12px;
    font-weight: 700;
    text-align: center;
    text-decoration: none;
  }

  .admin-tabs a:hover { color: #273027; background: #e9ede7; }
  .admin-tabs a.active { border-bottom-color: #087f9b; color: #075f72; }

  .season-tabs {
    display: flex;
    align-items: end;
    gap: 5px;
    margin-bottom: 16px;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .season-tabs a {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 5px;
    min-height: 37px;
    padding: 0 13px;
    border: 1px solid #c9d0c6;
    border-radius: 5px 5px 0 0;
    color: #5e685c;
    background: #e9ede7;
    font-size: 12px;
    font-weight: 700;
    text-decoration: none;
  }

  .season-tabs a:hover { color: #293128; background: #f5f7f4; }
  .season-tabs a.active { border-color: #799574; border-bottom-color: #f7faf5; color: #3e5d39; background: #f7faf5; }
  .season-tabs a.new-season-tab { border-style: dashed; color: #08738a; background: transparent; }
  .season-tabs a.new-season-tab.active { border-style: solid; border-color: #72aeb9; background: #f3fafb; }

  .season-admin-layout {
    display: grid;
    gap: 12px;
  }

  .season-navigation {
    overflow: hidden;
    border-bottom: 1px solid #cfd5cc;
  }
  .season-navigation nav {
    display: flex;
    gap: 4px;
    overflow-x: auto;
  }

  .season-navigation nav a {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    min-height: 39px;
    padding: 7px 14px;
    border-bottom: 3px solid transparent;
    color: #4f584d;
    font-size: 12px;
    font-weight: 700;
    text-decoration: none;
  }

  .season-navigation nav a:hover { background:#f1f4ef; }
  .season-navigation nav a.active { border-bottom-color:#087f9b; color:#075f72; background:#eaf5f6; }
  .season-navigation nav a > small { color:#858d83; font-size:9px; font-weight:650; }

  .season-detail { min-width: 0; }
  .season-detail > .season-panel { width:100%; margin:0; }

  .event-tabs {
    display: flex;
    gap: 5px;
    margin-bottom: 10px;
    padding: 5px;
    overflow-x: auto;
    border: 1px solid #d6d8cf;
    border-radius: 5px;
    background: #e9ebe5;
  }

  .event-tabs a {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 0 0 auto;
    min-height: 34px;
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: 4px;
    color: #5d6258;
    font-size: 11px;
    font-weight: 700;
    text-decoration: none;
  }

  .event-tabs a:hover { background: #f5f6f2; }
  .event-tabs a.active { border-color: #c5a55d; color: #654d18; background: #fffaf0; }
  .event-tabs a small { color: #8a8d83; font-size: 8px; }
  .event-tabs a.new-event-tab { border-left-color: #c6cbc2; color: #08738a; }

  .setup-card {
    margin-bottom: 16px;
    padding: 20px;
    border: 1px solid #cfd5cc;
    background: #fff;
  }

  .strategy-card > .section-heading { margin-bottom: 14px; }

  .empty-event-card {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #6f5b2b;
  }

  .empty-event-card > div { flex: 1; }
  .empty-event-card h2 { margin: 0; font-size: 16px; }
  .empty-event-card p { margin: 3px 0 0; color: #72766e; font-size: 11px; }

  .create-roster {
    display: grid;
    grid-template-columns: minmax(240px, 1fr) minmax(300px, 1fr);
    align-items: end;
    gap: 24px;
  }

  .team-access-card {
    display: grid;
    grid-template-columns: minmax(240px, .8fr) minmax(320px, 1.2fr);
    align-items: start;
    gap: 24px;
  }

  .access-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 8px;
  }

  .access-form label { display: grid; gap: 6px; }
  .access-form small { color: #7a6250; font-size: 10px; line-height: 1.4; }

  .focused-create-card .tournament-create { padding:0; border:0; }
  .focused-create-card .tournament-create > .section-heading { margin-bottom:6px; }

  .inline-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 8px;
  }

  .inline-form label,
  .tournament-fields label,
  .line-name { display: grid; gap: 6px; }

  .player-add-form { grid-template-columns: minmax(0, 1fr) 92px auto; }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 14px;
    border-bottom: 1px solid #e0e4de;
  }

  .card-header h2 { font-size: 17px; }
  h3 { color: #343b33; font-size: 13px; }
  .roster-workspace h3 { color: #526d4d; }
  .tournament-games > h3 { color: #3f6f79; }

  .card-header-actions { display: flex; align-items: center; gap: 6px; }
  .entity-heading { min-width: 0; }

  .entity-kind {
    display: block;
    margin-bottom: 4px;
    font-size: 8px;
    font-weight: 800;
    letter-spacing: .09em;
    text-transform: uppercase;
  }

  .roster-kind { color: #587453; }
  .tournament-kind { color: #8a661f; }

  .name-display,
  .name-edit-form,
  .player-name-area,
  .line-name-area {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .name-display h2 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .heading-name-edit {
    max-width: min(540px, 100%);
  }

  .heading-name-edit input {
    width: min(360px, 100%);
    padding: 4px 6px;
    min-height: 32px;
    font-size: 14px;
    font-weight: 680;
  }

  .name-icon-button {
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    width: 25px;
    height: 25px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 4px;
    color: #087f9b;
    background: transparent;
  }

  .name-icon-button:hover {
    border-color: #b8d7dc;
    color: #05657a;
    background: #e8f5f7;
  }

  .name-icon-button.save-name-button {
    border-color: #087f9b;
    color: #fff;
    background: #087f9b;
  }

  .name-icon-button.save-name-button:hover { background: #056c84; }

  .player-name-area {
    flex: 1;
  }

  .player-row-actions {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 3px;
  }

  .player-row-actions form { margin: 0; }

  .player-row-icon {
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid #d2d7cf;
    border-radius: 4px;
    color: #596159;
    background: #fff;
  }

  .player-row-icon:hover {
    border-color: #aab2a7;
    color: #20241f;
    background: #edf0eb;
  }

  .player-row-icon.save-name-button {
    border-color: #087f9b;
    color: #fff;
    background: #087f9b;
  }

  .player-row-icon.save-name-button:hover { background: #056c84; }
  .player-row-icon.delete-player { color: #9a333a; }

  .player-display-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .matchup-role-badge {
    flex: 0 0 auto;
    padding: 2px 5px;
    border: 1px solid #b7c9b5;
    border-radius: 8px;
    color: #526550;
    background: #edf4eb;
    font-size: 8px;
    font-weight: 800;
  }

  .matchup-role-badge.missing {
    border-color: #d78f95;
    color: #9b252e;
    background: #fff0f1;
  }

  .matchup-role-badge.mmp {
    border-color: #88bfb4;
    color: #276b60;
    background: #e8f5f2;
  }

  .matchup-role-badge.fmp {
    border-color: #d2b56f;
    color: #775b16;
    background: #fff6dc;
  }

  .player-name-edit {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    flex: 1;
    gap: 4px;
    width: 100%;
  }

  .roster-workspace,
  .tournament-workspace {
    display: grid;
    gap: 18px;
    padding-top: 18px;
  }

  .tournament-create,
  .attendance-form,
  .line-manager { display: grid; align-content: start; gap: 12px; }

  .player-manager {
    display: grid;
    align-content: start;
    gap: 12px;
    min-width: 0;
  }

  .strategy-manager {
    display: grid;
    padding: 13px;
    border: 1px solid #d6dbd3;
    border-radius: 4px;
    background: #fff;
  }

  .strategy-summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
  }

  .strategy-summary > span {
    color: #5f727a;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }

  .strategy-summary h3 { margin: 0; }

  .strategy-summary p {
    margin: 4px 0 0;
    color: #647078;
    font-size: 11px;
  }

  .strategy-columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #d5e0e4;
  }

  .strategy-kind-group {
    display: grid;
    align-content: start;
    gap: 8px;
    min-width: 0;
  }

  .strategy-kind-group h4 {
    margin: 0;
    color: #3d5864;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .05em;
  }

  .strategy-list {
    display: grid;
    gap: 5px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .strategy-list li {
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 32px;
    padding: 4px 6px;
    border: 1px solid #d5e0e4;
    border-radius: 4px;
    background: #fff;
  }

  .strategy-list form { margin: 0; }
  .strategy-name { flex: 1; min-width: 0; font-size: 12px; font-weight: 650; }

  .default-badge {
    padding: 2px 5px;
    border-radius: 8px;
    color: #426441;
    background: #e8f2e5;
    font-size: 8px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .default-command {
    padding: 2px 4px;
    border: 0;
    color: #247287;
    background: transparent;
    font-size: 9px;
  }

  .strategy-edit-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 5px;
    flex: 1;
    min-width: 0;
  }

  .strategy-edit-form > input { min-width: 0; }

  .default-check {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 9px;
  }

  .strategy-add-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
  }

  .player-list-disclosure { min-width: 0; }

  .roster-list-summary {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    border: 1px solid #d9ded7;
    border-radius: 3px;
    color: #414840;
    background: #f7f9f6;
    cursor: pointer;
    list-style: none;
  }

  .roster-list-summary::-webkit-details-marker { display: none; }

  .roster-list-summary span {
    color: #6a7368;
    font-size: 11px;
  }

  .roster-list-summary strong { font-size: 12px; }

  .roster-list-summary::after {
    content: '›';
    color: #687066;
    font-size: 18px;
    line-height: 1;
    transition: transform 120ms ease;
  }

  .player-list-disclosure[open] > .roster-list-summary::after,
  .tournament-roster-disclosure[open] > .roster-list-summary::after { transform: rotate(90deg); }

  .player-manager-content {
    display: grid;
    gap: 12px;
    padding-top: 12px;
  }

  .tournament-roster-disclosure { min-width: 0; }

  .tournament-roster-disclosure > .roster-list-summary {
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .attendance-content {
    display: grid;
    gap: 12px;
    padding-top: 12px;
  }

  .tournament-create,
  .line-manager {
    padding-top: 18px;
    border-top: 1px solid #e0e4de;
  }

  .tournament-workspace > .attendance-form {
    padding: 12px;
    border: 1px solid #cbd6c5;
    border-radius: 4px;
    background: #f5f8f2;
  }

  .tournament-workspace > .line-manager {
    padding: 12px;
    border: 1px solid #d2c7da;
    border-radius: 4px;
    background: #f7f3fa;
  }

  .tournament-workspace > .line-manager > h3 { color: #654e73; }

  .tournament-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 145px 145px;
    gap: 9px;
  }

  .plain-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 5px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .plain-list li,
  .empty-copy {
    margin: 0;
    padding: 6px 8px;
    color: #50584f;
    background: #f7f9f6;
    font-size: 12px;
  }

  .plain-list li {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .plain-list li.editing-player { align-items: flex-start; }

  .player-name-edit input[name='name'] {
    min-width: 0;
    width: 100%;
    min-height: 30px;
    padding: 5px 7px;
    font-size: 12px;
  }

  .player-name-edit select {
    width: 72px;
    min-height: 30px;
    padding: 4px;
    font-size: 10px;
  }

  .check-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(115px, 1fr));
    gap: 5px;
  }

  .check-grid label {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 6px;
    overflow: hidden;
    color: #414840;
    background: #f7f9f6;
    border: 1px solid #e1e5df;
    border-radius: 3px;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .check-grid label:has(input:checked) {
    color: #075e70;
    background: #e8f5f7;
    border-color: #80bdc8;
    font-weight: 650;
  }

  .check-grid input { flex: 0 0 auto; accent-color: #087f9b; }
  .check-grid label small { margin-left: auto; color: #728071; font-size: 8px; font-weight: 800; }
  .check-grid label small.mmp { color: #287467; }
  .check-grid label small.fmp { color: #896817; }

  .tournament-card .card-header h2 { font-size: 15px; }
  .tournament-header .secondary-command { flex: 0 0 auto; }
  .tournament-header-actions { display: flex; align-items: center; gap: 6px; }

  .tournament-games {
    display: grid;
    gap: 8px;
    margin-top: 14px;
    padding: 12px;
    border: 1px solid #bfd3d8;
    border-radius: 4px;
    background: #f1f8fa;
  }

  .game-link-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .game-link-list li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 5px;
    min-width: 0;
  }

  .game-link-list .game-admin-link {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px 8px;
    padding: 9px 10px;
    color: #263027;
    background: #fff;
    border: 1px solid #cfdee1;
    border-radius: 3px;
    text-decoration: none;
  }

  .game-link-list .game-admin-link:hover { border-color: #80bdc8; background: #eef7f8; }
  .game-link-list span { overflow: hidden; font-size: 12px; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
  .game-link-list small { grid-column: 1; color: #687066; font-size: 10px; }
  .game-link-list .game-admin-link :global(svg) {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
    color: #087f9b;
  }

  .game-delete-form { display: flex; margin: 0; }
  .game-delete-command {
    display: grid;
    place-items: center;
    width: 34px;
    padding: 0;
    border: 1px solid #dfb5b8;
    border-radius: 3px;
    color: #a7323a;
    background: #fff6f6;
  }
  .game-delete-command:hover { border-color: #c8797f; background: #feecec; }

  .game-create-panel { margin-top: 2px; }

  .game-create-panel > summary {
    width: fit-content;
    list-style: none;
    cursor: pointer;
  }

  .game-create-panel > summary::-webkit-details-marker { display: none; }
  .game-create-panel[open] > summary { margin-bottom: 10px; }

  .game-create-form {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 9px;
    padding: 12px;
    border: 1px dashed #9fbcc2;
    background: #f8fcfd;
  }

  .game-create-form label { display: grid; align-content: start; gap: 6px; min-width: 0; }
  .game-create-wide { grid-column: 1 / -1; }
  .game-create-form .primary-command { justify-self: start; }

  .game-create-form .game-video-toggle {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px;
    border: 1px solid #d9ded7;
    background: #fff;
  }

  .game-video-toggle input { margin: 0; accent-color: #087f9b; }
  .game-video-toggle span { display: grid; gap: 2px; }
  .game-video-toggle strong { color: #343b33; font-size: 11px; }
  .game-video-toggle small { color: #687066; font-size: 9px; }

  .game-metadata-file {
    padding: 9px;
    border: 1px dashed #c5ccc2;
    background: #fff;
  }

  .line-form {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) auto;
    align-items: end;
    gap: 9px;
    padding: 10px;
    border: 1px solid #d8d0df;
    background: #fff;
  }

  .line-name-area strong {
    min-width: 0;
    overflow: hidden;
    color: #343b33;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line-name-area input[type='text'] { min-width: 0; flex: 1; }

  .line-actions { display: flex; grid-column: 2; grid-row: 1; gap: 5px; }
  .line-form .secondary-command { min-height: 38px; }
  .line-player-editor {
    grid-column: 1 / -1;
    min-width: 0;
  }

  .new-line > .line-players { grid-column: 1 / -1; }
  .new-line > .secondary-command { grid-column: 2; grid-row: 1; }

  .line-player-editor > summary {
    padding: 9px 10px;
    color: #4e584e;
    background: #f2f5f1;
    border: 1px solid #d9ded7;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 650;
  }

  .line-player-editor[open] > summary { margin-bottom: 7px; }
  .delete-line { color: #9a333a; }
  .delete-roster,
  .delete-player,
  .delete-tournament { color: #9a333a; }
  .new-line { border-style: dashed; }

  .new-line-panel > summary {
    width: fit-content;
    list-style: none;
    cursor: pointer;
  }

  .new-line-panel > summary::-webkit-details-marker { display: none; }
  .new-line-panel[open] > summary { margin-bottom: 9px; }

  @media (max-width: 820px) {
    .team-access-card,
    .create-roster,
    .roster-workspace,
    .tournament-workspace { grid-template-columns: 1fr; }
    .tournament-create,
    .line-manager { padding-top: 18px; border-top: 1px solid #e0e4de; }
    .line-form { grid-template-columns: 1fr; }
    .line-actions,
    .new-line > .secondary-command { grid-column: 1; grid-row: auto; justify-self: start; }
    .game-create-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .season-admin-layout { grid-template-columns: 1fr; }
    .season-navigation { position:static; }
    .season-navigation nav { display:flex; gap:4px; overflow-x:auto; }
    .season-navigation nav a { flex:0 0 auto; border-left:0; border-bottom:3px solid transparent; }
    .season-navigation nav a.active { border-left:0; border-bottom-color:#087f9b; }
  }

  @media (max-width: 580px) {
    .setup-header,
    .admin-tabs,
    .season-tabs,
    .season-admin-layout,
    .page-message,
    .setup-page > .setup-card { width: calc(100% - 18px); }
    .tournament-fields { grid-template-columns: 1fr; }
    .inline-form { grid-template-columns: 1fr; }
    .access-form { grid-template-columns: 1fr; }
    .player-add-form { grid-template-columns: minmax(0, 1fr) 92px; }
    .player-add-form .secondary-command { grid-column: 1 / -1; }
    .game-create-form { grid-template-columns: 1fr; }
    .game-create-wide { grid-column: 1; }
    .setup-card { padding: 14px; }
  }
</style>
