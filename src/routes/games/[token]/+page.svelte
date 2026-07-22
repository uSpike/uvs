<script lang="ts">
  import { ArrowLeft, BarChart3, Copy, Edit3, ExternalLink, Link2, Plus, Trash2, Unlock } from '@lucide/svelte';
  import type { MetadataTimeline } from '$lib/metadata';
  import {
    UVSVideoViewer,
    type GameViewerSettings,
    type UVSViewerPlaybackMarker,
    type UVSViewerSpatialMarker,
    type UVSViewerSpatialPoint,
    type UVSVideoViewerSource,
  } from '$lib';
  import GameStatsRecorder from '$lib/GameStatsRecorder.svelte';
  import { gameEventLabel } from '$lib/game-events';
  import { autoCameraEndzoneAtTime, gamePlaybackAnnotations, type GameEventType, type GameTrackingSnapshot, type SpatialAnnotationRole } from '$lib/game-stats';
  import type { UVSViewerPlaybackState } from '$lib';

  let { data, form } = $props();
  let source = $state.raw<UVSVideoViewerSource | null>(null);
  let metadataError = $state('');
  let currentSettings = $state<GameViewerSettings | null>(null);
  let settingsJson = $derived(currentSettings ? JSON.stringify(currentSettings) : '');
  let settingsSaveForm = $state<HTMLFormElement | null>(null);
  let viewer = $state<{
    play: () => Promise<void>;
    pause: () => void;
    seekTo: (seconds: number) => void;
    stepFrames: (frameDelta: number) => void;
    setAutoCameraEnabled: (enabled: boolean) => void;
    getPlaybackState: () => UVSViewerPlaybackState;
  } | null>(null);
  let copiedShareId = $state<number | null>(null);
  let statsEditing = $state(false);
  let statsRecorder = $state<{
    toggleEditing: () => void;
    placeSpatialPoint: (point: UVSViewerSpatialPoint) => void;
    adjustSpatialPoint: (index: number, point: UVSViewerSpatialPoint) => void;
  } | null>(null);
  let spatialPlacementActive = $state(false);
  let spatialMarkers = $state<UVSViewerSpatialMarker[]>([]);
  let highlightOverlay = $state<{
    description: string;
    position: number;
    total: number;
    countdownSeconds: number | null;
  } | null>(null);
  let trackingSnapshot = $state.raw<GameTrackingSnapshot>((() => data.tracking)());
  let viewerPlayback = $state<UVSViewerPlaybackState>({
    currentTime: 0,
    duration: 0,
    playing: false,
    frameIndex: 0,
  });
  const autoCameraEndzone = $derived(
    autoCameraEndzoneAtTime(trackingSnapshot.data, Math.round(viewerPlayback.currentTime * 1000)),
  );
  const trustedDetectionBaselineTimesMs = $derived(
    trackingSnapshot.data.points.map((point) => point.startTimeMs),
  );
  const actionPlaybackMarkers = $derived(buildActionPlaybackMarkers(trackingSnapshot));

  const emptyPlayback: UVSViewerPlaybackState = {
    currentTime: 0,
    duration: 0,
    playing: false,
    frameIndex: 0,
  };

  $effect(() => {
    const metadataUrl = data.game.metadataUrl;
    const videoUrl = data.game.videoUrl;
    const controller = new AbortController();
    source = null;
    metadataError = '';

    if (!metadataUrl || !videoUrl) return () => controller.abort();

    void fetch(metadataUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Metadata request failed with status ${response.status}.`);
        }
        return response.json() as Promise<MetadataTimeline>;
      })
      .then((metadata) => {
        source = {
          videoUrl,
          metadata,
          videoName: data.game.title,
          metadataName: `${data.game.title} metadata`,
        };
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          metadataError = error instanceof Error ? error.message : 'Metadata could not be loaded.';
        }
      });

    return () => controller.abort();
  });

  $effect(() => {
    currentSettings = data.game.settings;
  });

  function captureSettings(settings: GameViewerSettings): void {
    currentSettings = settings;
  }

  function saveViewerSettings(): void {
    settingsSaveForm?.requestSubmit();
  }

  function buildActionPlaybackMarkers(snapshot: GameTrackingSnapshot): UVSViewerPlaybackMarker[] {
    const playerNames = new Map(snapshot.data.players.map((player) => [player.id, player.name]));
    return gamePlaybackAnnotations(snapshot.data).map((annotation) => ({
      id: `${annotation.eventId}-${annotation.id}`,
      label: gameEventLabel(annotation.eventType),
      detail: `${annotation.playerId === null ? 'Unknown player' : playerNames.get(annotation.playerId) ?? 'Unknown player'} · ${playbackRoleLabel(annotation.role)}`,
      tone: playbackMarkerTone(annotation.eventType),
      timeMs: annotation.timeMs,
      frameIndex: annotation.frameIndex,
      panoramaYaw: annotation.panoramaYaw,
      panoramaPitch: annotation.panoramaPitch,
    }));
  }

  function playbackRoleLabel(role: SpatialAnnotationRole): string {
    switch (role) {
      case 'handler': return 'possession';
      case 'thrower': return 'thrower';
      case 'receiver': return 'receiver';
      case 'intended_receiver': return 'intended receiver';
      case 'defender': return 'defender';
      case 'scorer': return 'scorer';
      case 'outgoing_player': return 'player out';
      case 'incoming_player': return 'player in';
    }
  }

  function playbackMarkerTone(type: GameEventType): UVSViewerPlaybackMarker['tone'] {
    switch (type) {
      case 'possession_start': return 'possession';
      case 'completion': return 'completion';
      case 'turnover': return 'turnover';
      case 'goal': return 'goal';
      case 'defended': return 'defense';
      default: return 'neutral';
    }
  }

  async function copyShareLink(id: number, token: string): Promise<void> {
    const shareUrl = new URL(`/share/${token}`, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      window.prompt('Copy this share link:', shareUrl);
    }
    copiedShareId = id;
    window.setTimeout(() => {
      if (copiedShareId === id) copiedShareId = null;
    }, 1500);
  }
</script>

<svelte:head>
  <title>{data.game.title} - Ultimate Video Stats</title>
</svelte:head>

<section class="game-page">
  <div class="game-workspace" class:no-video={!data.game.hasVideo}>
    {#if data.game.hasVideo}
    <div class="game-viewer-pane">
      {#if source}
        <UVSVideoViewer
          bind:this={viewer}
          {source}
          settings={data.game.settings}
          title="Game video"
          {autoCameraEndzone}
          {trustedDetectionBaselineTimesMs}
          {spatialPlacementActive}
          {spatialMarkers}
          playbackMarkers={actionPlaybackMarkers}
          onSpatialPointPlace={(point) => statsRecorder?.placeSpatialPoint(point)}
          onSpatialPointAdjust={(index, point) => statsRecorder?.adjustSpatialPoint(index, point)}
          onPlaybackChange={(state) => viewerPlayback = state}
          onSettingsChange={data.role === 'admin' ? captureSettings : undefined}
          onSaveSettings={data.role === 'admin' ? saveViewerSettings : undefined}
        />
        {#if highlightOverlay}
          <div class:playing={highlightOverlay.countdownSeconds === null} class="highlight-playback-overlay" aria-live="polite">
            <small>Highlight {highlightOverlay.position} of {highlightOverlay.total}</small>
            <strong>{highlightOverlay.description}</strong>
            <span>{highlightOverlay.countdownSeconds === null ? 'Playing' : `Playing in ${highlightOverlay.countdownSeconds}…`}</span>
          </div>
        {/if}
      {:else if metadataError}
        <div class="viewer-state error" role="alert">{metadataError}</div>
      {:else}
        <div class="viewer-state">Loading game…</div>
      {/if}
    </div>
    {/if}
    <div class="game-stats-pane">
      <header class="game-header">
        <div class="game-identity">
          {#if data.role === 'player' || data.role === 'admin'}
            <a
              class="icon-command"
              href={`/teams/${data.game.teamSlug}`}
              aria-label={`Back to ${data.game.teamName}`}
              title={`Back to ${data.game.teamName}`}
            >
              <ArrowLeft size={17} aria-hidden="true" />
            </a>
          {/if}
          <div>
            <h1>{data.game.title}</h1>
            <span>{data.game.teamName}</span>
          </div>
        </div>

        <div class="header-actions">
          {#if data.role === 'player' || data.role === 'admin'}
            <a
              class="secondary-command compact stats-page-command"
              href={`/teams/${trackingSnapshot.data.game.teamSlug}/tournaments/${trackingSnapshot.data.game.tournamentId}?game=${trackingSnapshot.data.game.token}#game-${trackingSnapshot.data.game.token}`}
              title="View game and event statistics"
            ><BarChart3 size={14} aria-hidden="true" />Stats</a>
          {/if}
          {#if data.role === 'player' || data.role === 'admin'}
            <button
              class:active={statsEditing}
              class="secondary-command compact stats-edit-command"
              type="button"
              title={statsEditing ? 'Leave statistics editing' : 'Edit statistics'}
              onclick={() => statsRecorder?.toggleEditing()}
            >
              {#if statsEditing}<Unlock size={14} aria-hidden="true" />Editing{:else}<Edit3 size={14} aria-hidden="true" />Edit stats{/if}
            </button>
          {/if}
          {#if data.game.hasVideo}
            <details
              class="share-control"
              open={form?.action === 'createShareLink' || form?.action === 'deleteShareLink'}
            >
              <summary class="secondary-command compact">
                <Link2 size={15} aria-hidden="true" />
                Share
              </summary>
              <div class="share-popover">
                <div class="share-heading">
                  <div>
                    <strong>Public video links</strong>
                    <small>Anyone with a link can watch video, without stats.</small>
                  </div>
                  <form method="POST" action="?/createShareLink">
                    <button class="primary-command compact" type="submit"><Plus size={14} />New link</button>
                  </form>
                </div>
                {#if form?.action === 'deleteShareLink' && form?.error}
                  <p class="share-error" role="alert">{form.error}</p>
                {/if}
                {#if data.shareLinks.length === 0}
                  <p class="empty-share-links">No active share links.</p>
                {:else}
                  <ul>
                    {#each data.shareLinks as link}
                      <li>
                        <div>
                          <code>/share/{link.token.slice(0, 10)}…</code>
                          <small>Created {new Date(link.createdAt).toLocaleString()}</small>
                        </div>
                        <button
                          class="icon-command"
                          type="button"
                          aria-label="Copy share link"
                          title={copiedShareId === link.id ? 'Copied' : 'Copy link'}
                          onclick={() => copyShareLink(link.id, link.token)}
                        ><Copy size={14} /></button>
                        <a
                          class="icon-command"
                          href={`/share/${link.token}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Open share link"
                          title="Open link"
                        ><ExternalLink size={14} /></a>
                        <form method="POST" action="?/deleteShareLink">
                          <input type="hidden" name="shareLinkId" value={link.id} />
                          <button class="icon-command revoke-link" type="submit" aria-label="Revoke share link" title="Revoke link">
                            <Trash2 size={14} />
                          </button>
                        </form>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            </details>
          {/if}

          {#if data.role === 'admin' && data.game.hasVideo}
            <div class="settings-actions">
              {#if form?.settingsError}
                <span class="settings-message error" role="alert">{form.settingsError}</span>
              {:else if form?.saved}
                <span class="settings-message success" role="status">Saved</span>
              {/if}
            </div>
            <form class="viewer-settings-save-form" method="POST" action="?/saveSettings" bind:this={settingsSaveForm}>
              <input type="hidden" name="settings" value={settingsJson} />
            </form>
          {/if}
        </div>
      </header>
      <GameStatsRecorder
        bind:this={statsRecorder}
        token={data.game.token}
        initialSnapshot={data.tracking}
        playback={viewerPlayback}
        manageTournamentUrl={data.role === 'admin' ? `/admin/teams/${data.game.teamSlug}` : null}
        getPlayback={() => viewer?.getPlaybackState() ?? emptyPlayback}
        pausePlayback={() => viewer?.pause()}
        playPlayback={() => viewer?.play() ?? Promise.resolve()}
        seekPlayback={(seconds) => viewer?.seekTo(seconds)}
        stepPlaybackFrames={(frameDelta) => viewer?.stepFrames(frameDelta)}
        recordingMode={currentSettings?.recordingMode ?? data.game.settings.recordingMode}
        onSpatialStateChange={(state) => {
          if (state.placementActive) viewer?.setAutoCameraEnabled(false);
          spatialPlacementActive = state.placementActive;
          spatialMarkers = state.markers;
        }}
        onHighlightOverlayChange={(overlay) => highlightOverlay = overlay}
        onEditingChange={(value) => statsEditing = value}
        onSnapshotChange={(value) => trackingSnapshot = value}
      />
    </div>
  </div>
</section>

<style>
  .game-page {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: #111210;
  }

  .game-header {
    z-index: 8;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    min-width: 0;
    padding: 7px 12px;
    border-bottom: 1px solid #353934;
    border-left: 1px solid #353934;
    color: #edf1eb;
    background: #1b1d1a;
  }

  .game-identity,
  .header-actions,
  .settings-actions {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }

  .game-identity { flex: 1 1 auto; }
  .game-identity > div { min-width: 0; }
  .header-actions { flex: 0 0 auto; }

  .viewer-settings-save-form { display: none; }

  .header-actions { position: relative; }
  .stats-page-command { border-color:#4b5148; color:#e0e5dd; background:#292d27; text-decoration:none; }
  .stats-page-command:hover { border-color:#626a60; color:#fff; background:#343932; }
  .stats-edit-command { border-color:#4b5148; color:#e0e5dd; background:#292d27; }
  .stats-edit-command.active { border-color:#278a54; color:#8de2aa; background:#203328; }
  .share-control { position: relative; }
  .share-control > summary { list-style: none; cursor: pointer; }
  .share-control > summary::-webkit-details-marker { display: none; }
  .share-control > summary { border-color: #4b5148; color: #e0e5dd; background: #292d27; }

  .share-popover {
    position: absolute;
    z-index: 30;
    top: calc(100% + 9px);
    right: 0;
    width: min(480px, calc(100vw - 24px));
    padding: 14px;
    border: 1px solid #555b52;
    border-radius: 6px;
    color: #252b25;
    background: #fff;
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34);
  }

  .share-heading { display: flex; align-items: start; justify-content: space-between; gap: 14px; }
  .share-heading > div { display: grid; gap: 3px; }
  .share-heading strong { font-size: 13px; }
  .share-heading small, .share-popover li small { color: #687066; font-size: 10px; }
  .share-popover ul { display: grid; gap: 7px; margin: 12px 0 0; padding: 0; list-style: none; }
  .share-popover li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; align-items: center; gap: 5px; }
  .share-popover li > div { display: grid; gap: 3px; min-width: 0; }
  .share-popover code { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .share-popover form { margin: 0; }
  .share-popover .icon-command { width: 29px; height: 29px; }
  .share-popover .revoke-link { color: #a62a31; }
  .empty-share-links, .share-error { margin: 12px 0 0; font-size: 12px; }
  .empty-share-links { color: #687066; }
  .share-error { color: #b3252d; }

  .game-identity h1 {
    max-width: 100%;
    margin: 0;
    overflow: hidden;
    color: #ffffff;
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .game-identity span {
    display: block;
    margin-top: 2px;
    color: #9fa69c;
    font-size: 11px;
  }

  .game-header :global(.icon-command) {
    border-color: #464b44;
    color: #dfe4dc;
    background: #242722;
  }

  .compact {
    min-height: 32px;
    padding-inline: 9px;
    font-size: 12px;
  }

  .settings-message {
    font-size: 11px;
    font-weight: 680;
  }

  .settings-message.error {
    color: #ff9fa5;
  }

  .settings-message.success {
    color: #7ee198;
  }

  .game-viewer-pane {
    position: relative;
    min-width: 0;
    min-height: 0;
  }

  .highlight-playback-overlay {
    position: absolute;
    z-index: 12;
    left: 50%;
    bottom: 76px;
    display: grid;
    gap: 6px;
    width: min(620px, calc(100% - 48px));
    padding: 15px 18px;
    border: 1px solid rgba(255, 255, 255, .28);
    border-radius: 8px;
    color: #fff;
    background: rgba(12, 14, 12, .82);
    box-shadow: 0 8px 28px rgba(0, 0, 0, .38);
    text-align: center;
    transform: translateX(-50%);
    pointer-events: none;
    backdrop-filter: blur(5px);
  }

  .highlight-playback-overlay.playing {
    border-color: rgba(227, 174, 39, .48);
    background: rgba(12, 14, 12, .68);
  }

  .highlight-playback-overlay small {
    color: #e3ae27;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .07em;
    text-transform: uppercase;
  }

  .highlight-playback-overlay strong {
    font-size: clamp(18px, 2.2vw, 30px);
    line-height: 1.2;
  }

  .highlight-playback-overlay span {
    color: #c7cdc4;
    font-size: 11px;
  }

  .game-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 430px;
    min-width: 0;
    min-height: 0;
  }

  .game-workspace.no-video { grid-template-columns: minmax(0, 1fr); }

  .game-stats-pane {
    display: grid;
    grid-template-rows: 54px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }

  .viewer-state {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #aab0a7;
    background: #0c0d0c;
    font-size: 13px;
  }

  .viewer-state.error {
    color: #ffb4b8;
  }

  @media (max-width: 680px) {
    .settings-message {
      display: none;
    }
  }

  @media (max-width: 900px) {
    .game-workspace {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(260px, 58%) minmax(220px, 42%);
    }

    .game-header { border-left: 0; }
  }
</style>
