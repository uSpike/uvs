<script lang="ts">
  import { base, resolve } from '$app/paths';
  import { Download, FileJson, FileText, Upload } from '@lucide/svelte';
  import { MAX_GAME_STATISTICS_EXPORT_BYTES } from './game-stat-transfer';

  let {
    token,
    onImported = () => {},
  }: {
    token: string;
    onImported?: () => void;
  } = $props();

  let importing = $state(false);
  let message = $state<{ error: boolean; text: string } | null>(null);
  let ownerId = '';
  let lockToken = '';

  async function acquireLock(takeover: boolean): Promise<'acquired' | 'conflict' | 'failed'> {
    if (!ownerId) ownerId = crypto.randomUUID();
    const response = await fetch(resolve(`/api/games/${token}/edit-lock`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerId, takeover }),
    });
    const result = await response.json() as {
      acquired?: boolean;
      token?: string | null;
      error?: string;
    };
    if (response.status === 409) return 'conflict';
    if (!response.ok || !result.acquired || !result.token) {
      message = {
        error: true,
        text: result.error ?? 'The statistics editing lock could not be acquired.',
      };
      return 'failed';
    }
    lockToken = result.token;
    return 'acquired';
  }

  async function releaseLock(): Promise<void> {
    const releasedToken = lockToken;
    lockToken = '';
    if (!releasedToken) return;
    await fetch(resolve(`/api/games/${token}/edit-lock`), {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: releasedToken }),
      keepalive: true,
    }).catch(() => {});
  }

  async function importStatisticsFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    if (file.size > MAX_GAME_STATISTICS_EXPORT_BYTES) {
      message = { error: true, text: 'Statistics file is larger than 25 MB.' };
      return;
    }
    if (!window.confirm(
      `Import statistics from "${file.name}"?\n\nThis replaces every existing point, action, highlight, matchup override, and paper statistic for this game.`,
    )) return;

    importing = true;
    message = null;
    try {
      let acquired = await acquireLock(false);
      if (
        acquired === 'conflict' &&
        window.confirm('Another player is editing this game. Take over editing and continue the import?')
      ) {
        acquired = await acquireLock(true);
      }
      if (acquired === 'conflict') {
        message = { error: true, text: 'Another player is editing this game.' };
        return;
      }
      if (acquired !== 'acquired' || !lockToken) return;

      const response = await fetch(resolve(`/api/games/${token}/stats-transfer`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-uvs-edit-token': lockToken,
        },
        body: file,
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        message = {
          error: true,
          text: result.error ?? 'Statistics could not be imported.',
        };
        return;
      }
      message = { error: false, text: 'Statistics imported.' };
      onImported();
    } catch (caught) {
      message = {
        error: true,
        text: caught instanceof Error ? caught.message : 'Statistics could not be imported.',
      };
    } finally {
      await releaseLock();
      importing = false;
    }
  }
</script>

<details class="stats-transfer-control">
  <summary>
    <FileJson size={14} aria-hidden="true" />
    Data
  </summary>
  <div class="stats-transfer-popover">
    <div>
      <strong>Game data</strong>
      <small>Back up editable data or download a read-only analysis file.</small>
    </div>
    <a
      class="stats-transfer-action analysis"
      href={`${base}/api/games/${token}/analysis-export?format=markdown`}
      download
    >
      <FileText size={15} aria-hidden="true" />
      <span>
        <b>AI brief (.md)</b>
        <small>Compact Markdown to paste directly into chat. Includes player names.</small>
      </span>
    </a>
    <a
      class="stats-transfer-action"
      href={`${base}/api/games/${token}/analysis-export`}
      download
    >
      <FileJson size={15} aria-hidden="true" />
      <span>
        <b>Full analysis JSON</b>
        <small>Complete event-level analysis data. Includes player names.</small>
      </span>
    </a>
    <a
      class="stats-transfer-action"
      href={resolve(`/api/games/${token}/stats-transfer`)}
      download
    >
      <Download size={15} aria-hidden="true" />
      <span><b>Download backup</b><small>Portable UVS JSON for restoring this game.</small></span>
    </a>
    <label class:disabled={importing} class="stats-transfer-action">
      <Upload size={15} aria-hidden="true" />
      <span>
        <b>{importing ? 'Restoring…' : 'Restore backup'}</b>
        <small>Replace this game’s data from a UVS backup file.</small>
      </span>
      <input
        type="file"
        accept=".json,application/json"
        disabled={importing}
        onchange={importStatisticsFile}
      />
    </label>
    {#if message}
      <p class:error={message.error} class="stats-transfer-message" role={message.error ? 'alert' : 'status'}>
        {message.text}
      </p>
    {/if}
  </div>
</details>

<style>
  .stats-transfer-control { position:relative; }
  .stats-transfer-control > summary {
    display:inline-flex;
    align-items:center;
    gap:5px;
    min-height:29px;
    padding:0 8px;
    border:1px solid #b9c6ca;
    border-radius:4px;
    color:#375c65;
    background:#f2f8f9;
    font-size:10px;
    font-weight:700;
    list-style:none;
    cursor:pointer;
  }
  .stats-transfer-control > summary::-webkit-details-marker { display:none; }
  .stats-transfer-control > summary:hover { border-color:#829ca2; background:#e8f2f4; }
  .stats-transfer-popover {
    position:absolute;
    z-index:40;
    top:calc(100% + 7px);
    right:0;
    display:grid;
    gap:9px;
    width:min(330px,calc(100vw - 24px));
    padding:13px;
    border:1px solid #c8cec5;
    border-radius:6px;
    color:#252b25;
    background:#fff;
    box-shadow:0 14px 34px rgba(25,31,24,.22);
  }
  .stats-transfer-popover > div:first-child { display:grid; gap:3px; padding:0 2px 3px; }
  .stats-transfer-popover strong { font-size:13px; }
  .stats-transfer-popover small { color:#687066; font-size:10px; font-weight:500; }
  .stats-transfer-action {
    display:grid;
    grid-template-columns:auto minmax(0,1fr);
    align-items:center;
    gap:9px;
    min-height:46px;
    padding:7px 9px;
    border:1px solid #d6dbd3;
    border-radius:5px;
    color:#263026;
    background:#f7f9f6;
    text-decoration:none;
    cursor:pointer;
  }
  .stats-transfer-action:hover { border-color:#9eaa9b; background:#eef2ec; }
  .stats-transfer-action.analysis { border-color:#b9d7dc; color:#174f5b; background:#eef8fa; }
  .stats-transfer-action.analysis:hover { border-color:#75aeb9; background:#e2f2f5; }
  .stats-transfer-action > span { display:grid; gap:2px; }
  .stats-transfer-action b { font-size:11px; }
  .stats-transfer-action input {
    position:absolute;
    width:1px;
    height:1px;
    overflow:hidden;
    opacity:0;
    pointer-events:none;
  }
  .stats-transfer-action.disabled { cursor:wait; opacity:.55; }
  .stats-transfer-message {
    margin:0;
    padding:6px 8px;
    border-radius:4px;
    color:#266239;
    background:#e8f5eb;
    font-size:10px;
  }
  .stats-transfer-message.error { color:#9d2730; background:#fbeaec; }
</style>
