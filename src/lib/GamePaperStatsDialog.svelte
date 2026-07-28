<script lang="ts">
  import { tick } from 'svelte';
  import { resolve } from '$app/paths';
  import { FilePenLine, LoaderCircle, X } from '@lucide/svelte';
  import GameStatsRecorder from './GameStatsRecorder.svelte';
  import type { GameTrackingSnapshot } from './game-stats';

  let {
    token,
    title,
    hasPaperStatistics,
    onSaved = () => {},
  }: {
    token: string;
    title: string;
    hasPaperStatistics: boolean;
    onSaved?: () => void;
  } = $props();

  const playback = { currentTime: 0, playing: false, frameIndex: 0 };
  let open = $state(false);
  let loading = $state(false);
  let error = $state('');
  let snapshot = $state.raw<GameTrackingSnapshot | null>(null);

  async function openEditor(): Promise<void> {
    open = true;
    loading = true;
    error = '';
    snapshot = null;
    try {
      const response = await fetch(resolve(`/api/games/${token}/stats`), {
        cache: 'no-store',
      });
      const result = await response.json() as GameTrackingSnapshot | { error?: string };
      if (!response.ok || !('data' in result)) {
        throw new Error(
          'error' in result ? result.error ?? 'Paper statistics could not be loaded.' : 'Paper statistics could not be loaded.',
        );
      }
      snapshot = result;
      await tick();
    } catch (caught) {
      error = caught instanceof Error
        ? caught.message
        : 'Paper statistics could not be loaded.';
    } finally {
      loading = false;
    }
  }

  function closeEditor(): void {
    open = false;
    snapshot = null;
    error = '';
  }

  function handleSnapshotChange(value: GameTrackingSnapshot): void {
    snapshot = value;
  }

  function handleManualSummarySaved(): void {
    closeEditor();
    onSaved();
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') closeEditor();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<button class="paper-trigger" type="button" onclick={() => void openEditor()}>
  <FilePenLine size={14} aria-hidden="true" />
  {hasPaperStatistics ? 'Edit paper stats' : 'Add paper stats'}
</button>

{#if open}
  <div
    class="paper-dialog-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeEditor();
    }}
  >
    <dialog
      class="paper-dialog"
      open
      aria-label={`Paper statistics for ${title}`}
    >
      <header>
        <div>
          <span>Game paper statistics</span>
          <h2>{title}</h2>
        </div>
        <button type="button" aria-label="Close paper statistics" title="Close" onclick={closeEditor}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div class="paper-dialog-body">
        {#if loading}
          <p class="dialog-state"><span class="spinner"><LoaderCircle size={20} aria-hidden="true" /></span>Loading paper statistics…</p>
        {:else if error}
          <div class="dialog-error" role="alert">
            <p>{error}</p>
            <button type="button" onclick={() => void openEditor()}>Try again</button>
          </div>
        {:else if snapshot}
          <GameStatsRecorder
            {token}
            initialSnapshot={snapshot}
            {playback}
            manageTournamentUrl={null}
            getPlayback={() => playback}
            pausePlayback={() => {}}
            playPlayback={() => Promise.resolve()}
            seekPlayback={() => {}}
            stepPlaybackFrames={() => {}}
            recordingMode="forms"
            onSpatialStateChange={() => {}}
            onHighlightOverlayChange={() => {}}
            onEditingChange={() => {}}
            onSnapshotChange={handleSnapshotChange}
            onManualSummarySaved={handleManualSummarySaved}
            paperOnlyMode
            autoStartEditing
          />
        {/if}
      </div>
    </dialog>
  </div>
{/if}

<style>
  .paper-trigger {
    display:inline-flex;
    align-items:center;
    gap:5px;
    min-height:29px;
    padding:0 8px;
    border:1px solid #b9c7b8;
    border-radius:4px;
    color:#365f3e;
    background:#f4faf3;
    font-size:10px;
    font-weight:700;
    cursor:pointer;
  }
  .paper-trigger:hover { border-color:#7e9d7c; background:#eaf5e8; }
  .paper-dialog-backdrop {
    position:fixed;
    z-index:100;
    inset:0;
    display:grid;
    place-items:center;
    padding:24px;
    background:rgba(16,18,15,.72);
  }
  .paper-dialog {
    position:relative;
    display:grid;
    grid-template-rows:auto minmax(0,1fr);
    width:min(1080px,100%);
    height:min(840px,calc(100vh - 48px));
    margin:0;
    padding:0;
    overflow:hidden;
    border:1px solid #555d53;
    border-radius:8px;
    background:#181b17;
    box-shadow:0 24px 70px rgba(0,0,0,.52);
  }
  .paper-dialog > header {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:14px;
    min-height:58px;
    padding:9px 12px 9px 16px;
    border-bottom:1px solid #3a3f38;
    color:#edf1eb;
    background:#22251f;
  }
  .paper-dialog > header div { display:grid; gap:2px; }
  .paper-dialog > header span {
    color:#929a8f;
    font-size:8px;
    font-weight:750;
    text-transform:uppercase;
    letter-spacing:.08em;
  }
  .paper-dialog > header h2 { margin:0; font-size:15px; }
  .paper-dialog > header button {
    display:grid;
    place-items:center;
    width:32px;
    height:32px;
    padding:0;
    border:1px solid #484e46;
    border-radius:4px;
    color:#dce2d9;
    background:#2b2f29;
    cursor:pointer;
  }
  .paper-dialog-body { min-height:0; overflow:hidden; }
  .dialog-state {
    display:flex;
    align-items:center;
    justify-content:center;
    gap:8px;
    height:100%;
    margin:0;
    color:#aeb6ab;
    font-size:11px;
  }
  .spinner { animation:spin 800ms linear infinite; }
  .dialog-error {
    display:grid;
    place-items:center;
    align-content:center;
    gap:10px;
    height:100%;
    padding:20px;
    color:#e6a3a8;
    text-align:center;
  }
  .dialog-error p { margin:0; font-size:11px; }
  .dialog-error button {
    min-height:30px;
    padding:0 10px;
    border:1px solid #6e7770;
    border-radius:4px;
    color:#edf1eb;
    background:#30352e;
  }
  @keyframes spin { to { transform:rotate(360deg); } }
  @media(max-width:680px) {
    .paper-dialog-backdrop { padding:8px; }
    .paper-dialog { height:calc(100vh - 16px); }
  }
</style>
