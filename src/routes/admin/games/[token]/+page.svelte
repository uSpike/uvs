<script lang="ts">
  import { resolve } from '$app/paths';
  import {
    ArrowLeft,
    Download,
    ExternalLink,
    Eye,
    FileJson,
    Gauge,
    RotateCcw,
    Save,
    Trash2,
    Video,
  } from '@lucide/svelte';

  let { data, form } = $props();
  let submittedValues = $derived(form?.action === 'saveGame' ? form.values : undefined);

  const degrees = (radians: number): string => ((radians * 180) / Math.PI).toFixed(2);

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
</script>

<svelte:head>
  <title>Edit {data.game.title} - Ultimate Video Stats</title>
</svelte:head>

<div class="game-editor-page">
  <header class="editor-header">
    <div class="editor-identity">
      <a class="icon-command" href={resolve(`/admin/teams/${data.game.teamSlug}`)} aria-label={`Back to ${data.game.teamName} administration`} title="Back">
        <ArrowLeft size={17} aria-hidden="true" />
      </a>
      <div>
        <h1>{data.game.title}</h1>
        <p>{data.game.teamName} · Updated {new Date(data.game.updatedAt).toLocaleString()}</p>
      </div>
    </div>

    <div class="header-actions">
      <form
        method="POST"
        action="?/deleteGame"
        onsubmit={(event) => {
          if (!window.confirm(`Delete ${data.game.title} and all of its statistics, highlights, and share links?`)) event.preventDefault();
        }}
      >
        <button class="secondary-command danger-command" type="submit">
          <Trash2 size={15} aria-hidden="true" />
          Delete game
        </button>
      </form>
      <form method="POST" action="?/resetSettings">
        <button class="secondary-command" type="submit">
          <RotateCcw size={15} aria-hidden="true" />
          Reset viewer defaults
        </button>
      </form>
      <a class="secondary-command" href={resolve(`/games/${data.game.token}`)}>
        <ExternalLink size={15} aria-hidden="true" />
        View game
      </a>
    </div>
  </header>

  {#if form?.action === 'saveGame' && form?.error}
    <p class="form-message error editor-message" role="alert">{form.error}</p>
  {:else if form?.action === 'saveGame' && form?.saved}
    <p class="form-message success editor-message" role="status">Game saved.</p>
  {:else if form?.action === 'resetSettings' && form?.reset}
    <p class="form-message success editor-message" role="status">Viewer defaults restored.</p>
  {/if}

  <form
    id="game-editor"
    class="editor-form"
    method="POST"
    enctype="multipart/form-data"
    action="?/saveGame"
  >
    <section class="editor-section" aria-labelledby="game-details-heading">
      <div class="section-heading">
        <Video size={19} aria-hidden="true" />
        <div>
          <h2 id="game-details-heading">Game details</h2>
          <p>Game identity and video source</p>
        </div>
      </div>

      <div class="details-grid">
        <label for="edit-tournament">
          <span class="field-label">Event</span>
          <select id="edit-tournament" name="tournamentId" required>
            {#each data.tournaments as tournament}
              <option
                value={tournament.id}
                selected={Number(submittedValues?.tournamentId ?? data.game.tournamentId) === tournament.id}
              >{tournament.teamName} · {tournament.name}</option>
            {/each}
          </select>
        </label>
        <label for="edit-title">
          <span class="field-label">Game title</span>
          <input
            id="edit-title"
            name="title"
            type="text"
            maxlength="160"
            value={submittedValues?.title ?? data.game.title}
            required
          />
        </label>
        <label for="edit-opponent">
          <span class="field-label">Opponent</span>
          <input
            id="edit-opponent"
            name="opponentName"
            type="text"
            maxlength="160"
            value={submittedValues?.opponentName ?? data.game.opponentName}
            required
          />
        </label>
        <label for="edit-played-at">
          <span class="field-label">Game date and time</span>
          <input
            id="edit-played-at"
            name="playedAt"
            type="datetime-local"
            value={submittedValues?.playedAt ?? data.game.playedAt ?? ''}
          />
        </label>
        <label for="edit-player-count">
          <span class="field-label">Expected players</span>
          <input
            id="edit-player-count"
            name="playerCount"
            type="number"
            min="1"
            max="20"
            value={submittedValues?.playerCount ?? data.game.playerCount}
            required
          />
        </label>
        <label for="edit-our-score">
          <span class="field-label">Starting score — us</span>
          <input
            id="edit-our-score"
            name="initialOurScore"
            type="number"
            min="0"
            max="999"
            value={submittedValues?.initialOurScore ?? data.game.initialOurScore}
            required
          />
        </label>
        <label for="edit-opponent-score">
          <span class="field-label">Starting score — opponent</span>
          <input
            id="edit-opponent-score"
            name="initialOpponentScore"
            type="number"
            min="0"
            max="999"
            value={submittedValues?.initialOpponentScore ?? data.game.initialOpponentScore}
            required
          />
        </label>
        <label class="full-field" for="edit-video-source">
          <span class="field-label">Video URL</span>
          <input
            id="edit-video-source"
            name="videoSource"
            type="text"
            inputmode="url"
            maxlength="2048"
            value={submittedValues?.videoSource ?? data.game.videoSource ?? ''}
          />
        </label>
      </div>
    </section>

    <section class="editor-section" aria-labelledby="metadata-heading">
      <div class="section-heading metadata-heading">
        <FileJson size={19} aria-hidden="true" />
        <div>
          <h2 id="metadata-heading">Metadata</h2>
          <p>{data.game.metadata ? `${formatBytes(data.game.metadata.originalBytes)} stored JSONL` : 'No video metadata'}</p>
        </div>
        {#if data.game.metadata}
        <div class="section-actions">
          <a
            class="icon-command"
            href={resolve(`/api/games/${data.game.token}/metadata`)}
            target="_blank"
            rel="noreferrer"
            aria-label="View parsed metadata"
            title="View parsed metadata"
          >
            <Eye size={16} aria-hidden="true" />
          </a>
          <a
            class="icon-command"
            href={resolve(`/admin/games/${data.game.token}/metadata`)}
            aria-label="Download original metadata JSONL"
            title="Download original JSONL"
          >
            <Download size={16} aria-hidden="true" />
          </a>
        </div>
        {/if}
      </div>

      {#if data.game.metadata}
      <dl class="metadata-facts">
        <div>
          <dt>Export</dt>
          <dd>Schema {data.game.metadata.schemaVersion}</dd>
        </div>
        <div>
          <dt>Video</dt>
          <dd>{data.game.metadata.videoWidth} × {data.game.metadata.videoHeight}</dd>
        </div>
        <div>
          <dt>Encoding</dt>
          <dd>{data.game.metadata.videoCodec} · {data.game.metadata.videoQuality}</dd>
        </div>
        <div>
          <dt>Detection samples</dt>
          <dd>{data.game.metadata.detectionSampleCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Track samples</dt>
          <dd>{data.game.metadata.trackSampleCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Last frame</dt>
          <dd>{data.game.metadata.lastFrameIndex.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Detection interval</dt>
          <dd>{data.game.metadata.detectionInterval} frames</dd>
        </div>
        <div>
          <dt>ROI points</dt>
          <dd>{data.game.metadata.roiPointCount}</dd>
        </div>
        <div class="source-fact">
          <dt>Export source</dt>
          <dd title={data.game.metadata.sourcePath}>{data.game.metadata.sourcePath}</dd>
        </div>
      </dl>
      {:else}
        <p class="metadata-empty">This game currently uses paper statistics only. Add a video URL and metadata file together to enable video playback.</p>
      {/if}

      <label class="metadata-upload" for="replacement-metadata">
        <span class="field-label">Replacement JSONL (optional)</span>
        <input
          id="replacement-metadata"
          name="metadata"
          type="file"
          accept=".metadata.jsonl,.jsonl,.ndjson,application/x-ndjson"
        />
      </label>
    </section>

    <section class="editor-section" aria-labelledby="viewer-settings-heading">
      <div class="section-heading">
        <Gauge size={19} aria-hidden="true" />
        <div>
          <h2 id="viewer-settings-heading">Viewer parameters</h2>
          <p>Orientation, framing, and automatic camera</p>
        </div>
      </div>

      <div class="parameter-groups">
        <fieldset>
          <legend>Statistics recording</legend>
          <div class="recording-mode-options">
            <label>
              <input
                type="radio"
                name="recordingMode"
                value="video_assisted"
                checked={(submittedValues?.recordingMode ?? data.game.settings.recordingMode) === 'video_assisted'}
              />
              <span><strong>Video-assisted</strong><small>Press S, then mark players directly on the video.</small></span>
            </label>
            <label>
              <input
                type="radio"
                name="recordingMode"
                value="forms"
                checked={(submittedValues?.recordingMode ?? data.game.settings.recordingMode) === 'forms'}
              />
              <span><strong>Forms</strong><small>Use the existing action forms without marking video positions.</small></span>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Framing</legend>
          <div class="parameter-grid framing-grid">
            <label for="rig-tilt">
              <span class="field-label">Tilt</span>
              <span class="number-field">
                <input
                  id="rig-tilt"
                  name="rigTiltDegrees"
                  type="number"
                  min="-30"
                  max="30"
                  step="0.01"
                  value={submittedValues?.rigTiltDegrees ?? degrees(data.game.settings.rigTiltRadians)}
                  required
                />
                <span>deg</span>
              </span>
            </label>
            <label for="rig-roll">
              <span class="field-label">Roll</span>
              <span class="number-field">
                <input
                  id="rig-roll"
                  name="rigRollDegrees"
                  type="number"
                  min="-15"
                  max="15"
                  step="0.01"
                  value={submittedValues?.rigRollDegrees ?? degrees(data.game.settings.rigRollRadians)}
                  required
                />
                <span>deg</span>
              </span>
            </label>
            <label for="initial-fov">
              <span class="field-label">Initial FOV</span>
              <span class="number-field">
                <input
                  id="initial-fov"
                  name="fovDegrees"
                  type="number"
                  min="15"
                  max="120"
                  step="1"
                  value={submittedValues?.fovDegrees ?? data.game.settings.fovDegrees}
                  required
                />
                <span>deg</span>
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Automatic camera</legend>
          <div class="parameter-grid auto-grid">
            <label for="new-area-delay">
              <span class="field-label">New area delay</span>
              <span class="number-field">
                <input
                  id="new-area-delay"
                  name="newAreaDelaySeconds"
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={submittedValues?.newAreaDelaySeconds ?? data.game.settings.autoCamera.newAreaDelaySeconds}
                  required
                />
                <span>sec</span>
              </span>
            </label>
            <label for="halo-size">
              <span class="field-label">Halo size</span>
              <span class="number-field">
                <input
                  id="halo-size"
                  name="trustHaloRadiusDegrees"
                  type="number"
                  min="4"
                  max="30"
                  step="1"
                  value={submittedValues?.trustHaloRadiusDegrees ?? data.game.settings.autoCamera.trustHaloRadiusDegrees}
                  required
                />
                <span>deg</span>
              </span>
            </label>
            <label for="halo-memory">
              <span class="field-label">Halo memory</span>
              <span class="number-field">
                <input
                  id="halo-memory"
                  name="trustHaloTimeoutSeconds"
                  type="number"
                  min="0.5"
                  max="5"
                  step="0.25"
                  value={submittedValues?.trustHaloTimeoutSeconds ?? data.game.settings.autoCamera.trustHaloTimeoutSeconds}
                  required
                />
                <span>sec</span>
              </span>
            </label>
            <label for="look-ahead">
              <span class="field-label">Look ahead</span>
              <span class="number-field">
                <input
                  id="look-ahead"
                  name="lookAheadSeconds"
                  type="number"
                  min="0"
                  max="3"
                  step="0.1"
                  value={submittedValues?.lookAheadSeconds ?? data.game.settings.autoCamera.lookAheadSeconds}
                  required
                />
                <span>sec</span>
              </span>
            </label>
            <label for="smooth-time">
              <span class="field-label">Smooth time</span>
              <span class="number-field">
                <input
                  id="smooth-time"
                  name="smoothingSeconds"
                  type="number"
                  min="0.1"
                  max="3"
                  step="0.1"
                  value={submittedValues?.smoothingSeconds ?? data.game.settings.autoCamera.smoothingSeconds}
                  required
                />
                <span>sec</span>
              </span>
            </label>
            <label for="max-pan-speed">
              <span class="field-label">Maximum pan speed</span>
              <span class="number-field">
                <input
                  id="max-pan-speed"
                  name="maxPanSpeedDegrees"
                  type="number"
                  min="10"
                  max="180"
                  step="1"
                  value={submittedValues?.maxPanSpeedDegrees ?? data.game.settings.autoCamera.maxPanSpeedDegrees}
                  required
                />
                <span>deg/s</span>
              </span>
            </label>
            <label for="pan-acceleration">
              <span class="field-label">Pan acceleration</span>
              <span class="number-field">
                <input
                  id="pan-acceleration"
                  name="maxPanAccelerationDegrees"
                  type="number"
                  min="5"
                  max="180"
                  step="1"
                  value={submittedValues?.maxPanAccelerationDegrees ?? data.game.settings.autoCamera.maxPanAccelerationDegrees}
                  required
                />
                <span>deg/s²</span>
              </span>
            </label>
            <label for="zoom-acceleration">
              <span class="field-label">Zoom acceleration</span>
              <span class="number-field">
                <input
                  id="zoom-acceleration"
                  name="maxZoomAccelerationDegrees"
                  type="number"
                  min="2"
                  max="120"
                  step="1"
                  value={submittedValues?.maxZoomAccelerationDegrees ?? data.game.settings.autoCamera.maxZoomAccelerationDegrees}
                  required
                />
                <span>deg/s²</span>
              </span>
            </label>
            <label for="minimum-fov">
              <span class="field-label">Minimum FOV</span>
              <span class="number-field">
                <input
                  id="minimum-fov"
                  name="minimumFovDegrees"
                  type="number"
                  min="20"
                  max="90"
                  step="1"
                  value={submittedValues?.minimumFovDegrees ?? data.game.settings.autoCamera.minimumFovDegrees}
                  required
                />
                <span>deg</span>
              </span>
            </label>
            <label for="frame-padding">
              <span class="field-label">Frame padding</span>
              <span class="number-field">
                <input
                  id="frame-padding"
                  name="framePaddingPercent"
                  type="number"
                  min="0"
                  max="25"
                  step="1"
                  value={submittedValues?.framePaddingPercent ?? data.game.settings.autoCamera.framePaddingPercent}
                  required
                />
                <span>%</span>
              </span>
            </label>
          </div>
        </fieldset>
      </div>
    </section>

    <footer class="save-bar">
      <span>Game token <code>{data.game.token}</code></span>
      <button class="primary-command" type="submit">
        <Save size={16} aria-hidden="true" />
        Save game
      </button>
    </footer>
  </form>
</div>

<style>
  .game-editor-page {
    height: 100%;
    overflow: auto;
    padding-bottom: 40px;
    background: #f2f4f0;
  }

  .editor-header,
  .editor-message,
  .editor-form {
    width: min(1120px, calc(100% - 32px));
    margin-inline: auto;
  }

  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    min-height: 76px;
    padding: 12px 0;
  }

  .editor-identity,
  .header-actions,
  .section-actions {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }

  .editor-identity h1 {
    max-width: min(48vw, 620px);
    margin: 0;
    overflow: hidden;
    color: #20241f;
    font-size: 21px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .editor-identity p {
    margin: 4px 0 0;
    color: #687066;
    font-size: 12px;
  }

  .header-actions form {
    margin: 0;
  }

  .danger-command { border-color: #dca9ad; color: #a52f37; background: #fff7f7; }
  .danger-command:hover { border-color: #c66f76; color: #84232a; background: #feecec; }

  .editor-message {
    margin-top: 0;
    margin-bottom: 12px;
  }

  .editor-form {
    border: 1px solid #cfd5cc;
    background: #ffffff;
  }

  .editor-section {
    display: grid;
    gap: 20px;
    padding: 22px;
  }

  .editor-section + .editor-section {
    border-top: 1px solid #d9ded6;
  }

  .recording-mode-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .recording-mode-options label {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 11px;
    border: 1px solid #cfd5cc;
    border-radius: 5px;
    background: #f8faf7;
  }

  .recording-mode-options input {
    margin-top: 2px;
  }

  .recording-mode-options span {
    display: grid;
    gap: 3px;
  }

  .recording-mode-options strong {
    color: #252b25;
    font-size: 12px;
  }

  .recording-mode-options small {
    color: #687066;
    font-size: 10px;
    line-height: 1.4;
  }

  .metadata-heading {
    align-items: center;
  }

  .metadata-heading .section-actions {
    margin-left: auto;
  }

  .details-grid,
  .parameter-grid {
    display: grid;
    gap: 14px;
  }

  .details-grid {
    grid-template-columns: repeat(3, minmax(160px, 1fr));
  }

  .details-grid label,
  .parameter-grid label {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .full-field {
    grid-column: 1 / -1;
  }

  .metadata-facts {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: 0;
    border-block: 1px solid #e0e4de;
  }

  .metadata-facts > div {
    min-width: 0;
    padding: 11px 12px;
    border-right: 1px solid #e0e4de;
    border-bottom: 1px solid #e0e4de;
  }

  .metadata-facts > div:nth-child(4n) {
    border-right: 0;
  }

  .metadata-facts > div:nth-last-child(-n + 4) {
    border-bottom: 0;
  }

  .metadata-facts .source-fact {
    grid-column: span 4;
    border-right: 0;
    border-bottom: 0;
  }

  .metadata-facts dt {
    margin-bottom: 4px;
    color: #737b71;
    font-size: 10px;
    font-weight: 720;
    text-transform: uppercase;
  }

  .metadata-facts dd {
    margin: 0;
    overflow: hidden;
    color: #272d26;
    font-size: 13px;
    font-weight: 620;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metadata-upload {
    display: grid;
    gap: 7px;
    padding: 11px;
    border: 1px dashed #aeb7ab;
    border-radius: 5px;
    background: #f8faf7;
  }

  .parameter-groups {
    display: grid;
    gap: 24px;
  }

  fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    width: 100%;
    margin-bottom: 12px;
    padding: 0 0 7px;
    border-bottom: 1px solid #e0e4de;
    color: #343b33;
    font-size: 12px;
    font-weight: 740;
  }

  .framing-grid {
    grid-template-columns: repeat(3, minmax(150px, 1fr));
  }

  .auto-grid {
    grid-template-columns: repeat(4, minmax(150px, 1fr));
  }

  .number-field {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    min-height: 38px;
    overflow: hidden;
    border: 1px solid #bdc5ba;
    border-radius: 5px;
    background: #ffffff;
  }

  .number-field:focus-within {
    outline: 2px solid #087f9b;
    outline-offset: 2px;
  }

  .number-field input {
    width: 100%;
    min-width: 0;
    height: 36px;
    padding: 7px 9px;
    border: 0;
    outline: 0;
    color: #20241f;
    background: transparent;
  }

  .number-field > span {
    padding: 0 9px;
    color: #6d756b;
    font-size: 11px;
  }

  .save-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 62px;
    padding: 12px 22px;
    border-top: 1px solid #cfd5cc;
    background: #f7f9f6;
  }

  .save-bar span {
    min-width: 0;
    overflow: hidden;
    color: #737b71;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .save-bar code {
    color: #3d453c;
  }

  @media (max-width: 880px) {
    .editor-header {
      align-items: flex-start;
      flex-direction: column;
    }

    .editor-identity h1 {
      max-width: calc(100vw - 96px);
    }

    .metadata-facts,
    .auto-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .metadata-facts > div:nth-child(4n) {
      border-right: 1px solid #e0e4de;
    }

    .metadata-facts > div:nth-child(2n) {
      border-right: 0;
    }

    .metadata-facts > div:nth-last-child(-n + 4) {
      border-bottom: 1px solid #e0e4de;
    }

    .metadata-facts .source-fact {
      grid-column: span 2;
      border-bottom: 0;
    }
  }

  @media (max-width: 620px) {
    .game-editor-page {
      padding-bottom: 18px;
    }

    .editor-header,
    .editor-message,
    .editor-form {
      width: calc(100% - 18px);
    }

    .header-actions {
      width: 100%;
    }

    .header-actions form,
    .header-actions .secondary-command {
      flex: 1;
    }

    .header-actions form .secondary-command {
      width: 100%;
    }

    .details-grid,
    .framing-grid,
    .auto-grid {
      grid-template-columns: 1fr;
    }

    .editor-section {
      padding: 17px 14px;
    }

    .metadata-facts {
      grid-template-columns: 1fr;
    }

    .metadata-facts > div,
    .metadata-facts > div:nth-child(2n),
    .metadata-facts > div:nth-child(4n) {
      border-right: 0;
      border-bottom: 1px solid #e0e4de;
    }

    .metadata-facts .source-fact {
      grid-column: auto;
      border-bottom: 0;
    }

    .save-bar {
      padding-inline: 14px;
    }
  }
</style>
