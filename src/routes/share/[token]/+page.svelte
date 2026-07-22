<script lang="ts">
  import type { MetadataTimeline } from '$lib/metadata';
  import { UVSVideoViewer, type UVSVideoViewerSource } from '$lib';

  let { data } = $props();
  let source = $state.raw<UVSVideoViewerSource | null>(null);
  let metadataError = $state('');

  $effect(() => {
    const controller = new AbortController();
    source = null;
    metadataError = '';
    void fetch(data.game.metadataUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('This share link is no longer available.');
        return response.json() as Promise<MetadataTimeline>;
      })
      .then((metadata) => {
        source = {
          videoUrl: data.game.videoUrl,
          metadata,
          videoName: data.game.title,
          metadataName: `${data.game.title} metadata`,
        };
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          metadataError = caught instanceof Error ? caught.message : 'Video metadata could not be loaded.';
        }
      });
    return () => controller.abort();
  });
</script>

<svelte:head>
  <title>{data.game.title} - Ultimate Video Stats</title>
</svelte:head>

<section class="shared-game-page">
  <header>
    <div>
      <h1>{data.game.title}</h1>
      <span>{data.game.teamName} · Shared video</span>
    </div>
  </header>
  <div class="shared-viewer">
    {#if source}
      <UVSVideoViewer {source} settings={data.game.settings} title="Shared game video" />
    {:else if metadataError}
      <div class="viewer-state error" role="alert">{metadataError}</div>
    {:else}
      <div class="viewer-state">Loading game…</div>
    {/if}
  </div>
</section>

<style>
  .shared-game-page {
    display: grid;
    grid-template-rows: 54px minmax(0, 1fr);
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: #111210;
  }

  header {
    display: flex;
    align-items: center;
    padding: 7px 14px;
    border-bottom: 1px solid #353934;
    color: #edf1eb;
    background: #1b1d1a;
  }

  h1 { margin: 0; color: #fff; font-size: 14px; }
  header span { display: block; margin-top: 2px; color: #9fa69c; font-size: 11px; }
  .shared-viewer { position: relative; min-width: 0; min-height: 0; }

  .viewer-state {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #aab0a7;
    background: #0c0d0c;
    font-size: 13px;
  }

  .viewer-state.error { color: #ffb4b8; }
</style>
