# Reco Games Web Application

SvelteKit application for organizing Reco panorama exports by team, recording
timecoded game statistics, and viewing video through the reusable
`RecoVideoViewer` component. SQLite stores teams, season rosters, tournaments,
lines, editable point timelines, metadata, and camera settings.

## Run locally

```bash
npm install
npm run dev
```

The development administrator password is `admin`. Production requires
`ADMIN_PASSWORD` and `SESSION_SECRET`; see `.env.example`. Administrators set a
shared, hashed player password when creating each team. The database defaults
to `data/reco-web.sqlite` and is migrated automatically.

## Access and data

- `/admin` requires the global administrator password and manages teams.
- `/admin/teams/:slug` manages season players, tournament attendance,
  tournament-owned games, and any number of lines with suggested players.
- `/teams/:slug` requires that team's player password or the global
  administrator password. Players can view team statistics and videos and edit
  statistics, but cannot access another team.
- `/games/:token` is private to the owning team and its administrators. A
  signed-in player or administrator may create multiple revocable
  `/share/:token` links. Each share link provides only the game video and viewer
  controls, with no login and no statistics.

An administrator supplies either a server-local `file://` URL or an `http(s)`
URL for each video. Browsers receive video through
`/api/games/:token/video`, which supports byte ranges and does not expose local
server paths. Metadata uploads are validated, retained as their original JSONL,
and also stored in parsed form for `/api/games/:token/metadata`.

## Rosters and statistics

Every game belongs to a tournament. A tournament belongs to one season roster,
selects the players attending that tournament, and owns its line definitions.
Every game uses that tournament roster directly. Point lineups are selected
from the tournament roster; selecting a line preloads its available suggested
players without enforcing membership. The configured player count produces a
warning rather than blocking a short or oversized lineup.

Each season player has an MMP or FMP preferred gender matchup role. A rare
game-level override takes precedence over that roster role, and a point-level
override takes precedence over both. Exactly seven pull-release players are
classified as an MMP point for a 4 MMP/3 FMP lineup or an FMP point for a
4 FMP/3 MMP lineup. Short, incomplete, or nonstandard lineups remain explicitly
unclassified. Game and tournament statistics report MMP/FMP point, offense,
defense, and win totals separately.

A point begins at the recorded pull-release time. The timeline derives live
possession, the current handler, active players after substitutions, score, and
all statistics. Supported entries are completions, tracked-team turnovers,
defended plays, opponent turnovers, goals, conceded goals, injury
substitutions, dead-disc intervals, and absolute score synchronization after a
video gap. Callahans are one goal event with no thrower and count as both a
goal and block. Scoring passes count as completions and receptions.

Actions pause video while the recorder chooses the necessary players, then
resume it if it was previously playing. Completion throwers are prefilled from
the last receiver until possession changes. Player selectors contain only the
players active at that event time. Entries may deliberately retain unknown
players and are marked incomplete until edited from the timeline.

Fouls, injuries, timeouts, and other stoppages are stored as intervals. They
remain part of playing time but are subtracted exactly from time with the disc.
Player point-win credit includes everyone with positive playing time, while
plus/minus is applied only to players active when the goal occurs. Line totals
are calculated once per point or event rather than summing player totals.

Team passwords are stored as salted scrypt hashes. Changing a team password
invalidates its existing player sessions. Only one browser may edit a game at
once. A live connection owns the lock with
no elapsed-time expiration; closing the editor connection releases it. Any
signed-in player may explicitly take over, immediately invalidating the former
editor's mutation token. Every edit, delete, and timecode change recalculates
the game from its authoritative timeline.

Desktop shortcuts while edit mode is active are `C` completion, `T` turnover,
`D` defended, `G` goal or Callahan, `X` conceded, `S` substitution, `F`
stoppage/resume, and `Ctrl/Cmd+Z` to undo the most recently added entry.

## Viewer

Drag to pan and use the mouse wheel or transport controls to zoom.

Enable **Undistort** to render the angular panorama through a rectilinear camera
that fills the viewer while matching Reco's normal vertical-FOV convention. In
this mode, dragging changes camera yaw/pitch and the FOV slider or mouse wheel
controls the lens. Autocamera framing uses the viewer's live aspect ratio.
The camera-orientation control adjusts rig tilt and roll. Schema v3 exports
initialize those controls from Reco's calibration so panning uses the same
leveled camera frame as a normal Reco render. The perspective renderer requires
WebGL 2.

Enable **Auto camera** to frame the active players automatically. The viewer
maintains a virtual camera continuously, even while automatic mode is disabled.
Enabling the mode snaps the visible camera to that already-calculated pose.
Current detections and actual samples inside the configured **Look ahead**
window drive the virtual camera without relying on track IDs. Detection centers
inside its FOV are included immediately. **New area delay** applies only to
newly occupied regions outside the virtual view, including at the start of the
video; gaps reset their new-area history. Manual panning and zooming do not
change that calculation.

Included detection boxes are solid cyan. Newly occupied boxes outside the auto
FOV are dashed amber where visible until their displayed delay expires. Labels
show confidence without class names or motion arrows. Smooth time, maximum
camera speed, and minimum FOV control the camera response. **Frame padding**
controls the extra edge space around accepted detection boxes: lower values
produce a tighter crop, while **Minimum FOV** remains the zoom-in limit.
**Pan accel** and **Zoom accel** limit how quickly camera velocity can change,
avoiding abrupt reframing. Dragging or manually changing FOV exits automatic
mode.

## Reusable component

`RecoVideoViewer` can be embedded in a game, statistics, or multi-video app.
The parent selects the active game and owns the video URL; the viewer owns
playback, panorama projection, overlays, and camera controls.

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    RecoVideoViewer,
    type MetadataTimeline,
    type RecoVideoViewerSource,
    type RecoViewerPlaybackState,
  } from '$lib';

  let source: RecoVideoViewerSource | null = null;

  async function loadGame(): Promise<void> {
    const response = await fetch('/api/games/game-token/metadata');
    source = {
      videoUrl: '/api/games/game-token/video',
      metadata: (await response.json()) as MetadataTimeline,
      videoName: 'Game 42',
      metadataName: 'Game 42 metadata',
    };
  }

  onMount(() => {
    void loadGame();
  });

  function syncGameTimeline(state: RecoViewerPlaybackState): void {
    // Update statistics and game events for state.currentTime.
  }
</script>

<div class="video-pane">
  <RecoVideoViewer {source} onPlaybackChange={syncGameTimeline} />
</div>

<style>
  .video-pane {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
</style>
```

Import the component and public types from `src/lib/index.ts`. Replace
`source` with a new object when the active game changes. The viewer never
revokes a parent-provided URL, so the embedding app remains responsible for
object URL cleanup. Set `allowLocalFiles` only when the viewer should show its
own video and metadata pickers; supplying `source` disables those controls.

The `settings` prop and `onSettingsChange` callback round-trip roll, tilt, FOV,
and automatic camera tuning. `onPlaybackChange`, `onViewChange`, and
`onStatusChange` expose other state without coupling the viewer to
application-level stores. Bind the component instance to call `play()`,
`pause()`, `seekTo()`, `setAutoCameraEnabled()`, or `getPlaybackState()` from
parent controls.

## Metadata support

The parser accepts `web_panorama` schema version 2 or newer with the
`angular_rectangular` projection and `pitch_max_to_pitch_min` Y axis. Detection
centers are mapped exactly from panorama yaw/pitch into video coordinates.
Schema v3 adds `rig_orientation` in `reco_framing_radians`; schema v2 files use
zero tilt and roll until adjusted in the viewer.

Schema v2 stores detection box dimensions in normalized source-camera
coordinates. The viewer preserves those dimensions around the panorama-mapped
center. A future sidecar field containing projected panorama box corners can
replace this approximation in `src/lib/metadata.ts` and the overlay renderer.

## Checks

```bash
npm run check
npm test
npm run build
```
