<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import {
    AlertTriangle,
    Check,
    ChevronLeft,
    ChevronRight,
    ClipboardList,
    Edit3,
    Lock,
    Pause,
    Play,
    Plus,
    RefreshCw,
    RotateCcw,
    Save,
    ShieldAlert,
    Trash2,
    Users,
    X,
  } from '@lucide/svelte';
  import { autoCameraEndzoneAtTime, autoSkipTargetTimeMs, calculatePointResults, calculatePointState, calculateScoreAtTime, classifyMatchupRoles, latestHandlerSpatialAnnotation, latestPointTimeMs, type EventSpatialAnnotation, type GameEventPayload, type GameEventType, type GameHighlight, type GameTrackingSnapshot, type ManualPlayerGameStatistics, type SpatialAnnotationRole, type StartingPossession, type StrategyKind, type TeamEndzone, type TrackingEvent, type TrackingPoint } from './game-stats';
  import type { GameRecordingMode } from './game-settings';
  import type { UVSViewerSpatialMarker, UVSViewerSpatialPoint } from './viewer-types';
  import { gameEventLabel } from './game-events';
  import type { MatchupRole } from './matchup';
  import { STAT_DESCRIPTIONS as statHelp } from './stat-descriptions';

  interface PlaybackSnapshot {
    currentTime: number;
    playing: boolean;
  }

  let {
    token,
    initialSnapshot,
    playback,
    manageTournamentUrl,
    getPlayback,
    pausePlayback,
    playPlayback,
    seekPlayback,
    stepPlaybackFrames,
    recordingMode,
    onSpatialStateChange,
    onHighlightOverlayChange,
    onEditingChange,
    onSnapshotChange,
  }: {
    token: string;
    initialSnapshot: GameTrackingSnapshot;
    playback: PlaybackSnapshot;
    manageTournamentUrl: string | null;
    getPlayback: () => PlaybackSnapshot;
    pausePlayback: () => void;
    playPlayback: () => Promise<void>;
    seekPlayback: (seconds: number) => void;
    stepPlaybackFrames: (frameDelta: number) => void;
    recordingMode: GameRecordingMode;
    onSpatialStateChange: (state: {
      placementActive: boolean;
      markers: UVSViewerSpatialMarker[];
    }) => void;
    onHighlightOverlayChange: (overlay: {
      description: string;
      position: number;
      total: number;
      countdownSeconds: number | null;
    } | null) => void;
    onEditingChange: (editing: boolean) => void;
    onSnapshotChange: (snapshot: GameTrackingSnapshot) => void;
  } = $props();

  type PanelTab = 'record' | 'paper' | 'highlights';
  type DraftMode = 'point' | 'event' | 'highlight' | null;
  type SpatialDraftStage = 'inactive' | 'place_primary' | 'choose_action' | 'details';

  interface SpatialDraftAnnotation extends Omit<EventSpatialAnnotation, 'id'> {
    clientX: number;
    clientY: number;
  }

  interface ManualPointDraft {
    lineId: number;
    startingPossession: StartingPossession;
    initialDefenseType: string;
    offenseStrategyId: number;
    defenseStrategyId: number;
    ourTurnovers: number;
    scoringMethod: string;
    scorerPlayerId: string;
    ourScore: number;
    opponentScore: number;
  }

  interface TimelineContextItem {
    label: string;
    description: string;
  }

  interface EventTimelineContext {
    previous: TimelineContextItem;
    next: TimelineContextItem | null;
  }

  interface PointScrubberRange {
    point: TrackingPoint;
    startTimeMs: number;
    endTimeMs: number;
    completed: boolean;
  }

  let snapshot = $state.raw<GameTrackingSnapshot>((() => initialSnapshot)());
  let activeTab = $state<PanelTab>((() => initialSnapshot.data.game.hasVideo ? 'record' : 'paper')());
  let editing = $state(false);
  let lockToken = $state('');
  let lockHeldElsewhere = $state(false);
  let lockError = $state('');
  let mutationError = $state('');
  let saving = $state(false);
  let presenceAbort: AbortController | null = null;
  let ownerId = '';
  let resumeAfterDraft = false;
  let draftMode = $state<DraftMode>(null);
  let redoEvent = $state<TrackingEvent | null>(null);
  let spatialDraft = $state(false);
  let spatialDraftStage = $state<SpatialDraftStage>('inactive');
  let spatialAnnotations = $state<SpatialDraftAnnotation[]>([]);
  let spatialPopover = $state<{ left: number; top: number } | null>(null);

  let editingPointId = $state<number | null>(null);
  let pointLineId = $state(0);
  let pointPossession = $state<StartingPossession>('offense');
  let pointPullerId = $state('');
  let pointEndzoneOverride = $state<TeamEndzone | ''>('');
  let pointPlayerIds = $state<number[]>([]);
  let pointMatchupRoleOverrides = $state<Record<number, MatchupRole>>({});

  let editingEventId = $state<number | null>(null);
  let eventPointId = $state<number | null>(null);
  let eventType = $state<GameEventType>('completion');
  let eventTimeSeconds = $state(0);
  let firstPlayerId = $state('');
  let secondPlayerId = $state('');
  let turnoverReason = $state('throwaway');
  let opponentTurnoverReason = $state('throwaway');
  let callahan = $state(false);
  let stoppageKind = $state('foul');
  let stoppageEndSeconds = $state<string>('');
  let scoreUs = $state(0);
  let scoreOpponent = $state(0);
  let strategyKind = $state<StrategyKind>('offense');
  let strategyId = $state(0);
  let editingHighlightId = $state<number | null>(null);
  let highlightStartSeconds = $state(0);
  let highlightEndSeconds = $state(0);
  let highlightDescription = $state('');
  let highlightPlayerIds = $state<number[]>([]);
  let highlightPlaylistActive = $state(false);
  let highlightPlaylistPosition = $state(0);
  let highlightPlaylistRun = 0;
  let manualPlayerDrafts = $state<ManualPlayerGameStatistics[]>((() => manualPlayerRows(initialSnapshot))());
  let manualPointDrafts = $state<ManualPointDraft[]>((() => manualPointRows(initialSnapshot))());
  let observedOpenPointId = $state<number | null>(null);
  let observedOpenPointEndMs = $state(0);
  let autoSkipPointGaps = $state(true);
  let pointGapBufferSeconds = $state(5);

  const currentPoint = $derived(
    snapshot.currentPointId === null
      ? null
      : snapshot.data.points.find((point) => point.id === snapshot.currentPointId) ?? null,
  );
  const pointScrubber = $derived(pointScrubberAtTime(Math.round(playback.currentTime * 1000)));
  const recordPoint = $derived(pointScrubber?.point ?? null);
  const recordPointState = $derived(recordPoint ? calculatePointState(recordPoint) : null);
  const recordLine = $derived(
    recordPoint
      ? snapshot.data.lines.find((line) => line.id === recordPoint.lineId) ?? null
      : null,
  );
  const nextRecordedPoint = $derived(nextPointAfterTime(Math.round(playback.currentTime * 1000)));
  const pointResults = $derived(calculatePointResults(snapshot.data));
  const displayedScore = $derived(
    snapshot.data.game.hasVideo
      ? calculateScoreAtTime(snapshot.data, Math.round(playback.currentTime * 1000))
      : snapshot.statistics,
  );
  const previousNavigationPoint = $derived(adjacentNavigationPoint(-1));
  const nextNavigationPoint = $derived(adjacentNavigationPoint(1));

  $effect(() => {
    if (!currentPoint) {
      observedOpenPointId = null;
      observedOpenPointEndMs = 0;
      return;
    }
    const nextEndTimeMs = Math.max(
      currentPoint.startTimeMs,
      latestPointTimeMs(currentPoint),
      Math.round(playback.currentTime * 1000),
    );
    if (observedOpenPointId !== currentPoint.id) {
      observedOpenPointId = currentPoint.id;
      observedOpenPointEndMs = nextEndTimeMs;
    } else if (nextEndTimeMs > observedOpenPointEndMs) {
      observedOpenPointEndMs = nextEndTimeMs;
    }
  });

  $effect(() => {
    if (highlightPlaylistActive && activeTab !== 'highlights') stopHighlightPlaylist();
  });

  $effect(() => {
    if (
      editing ||
      !autoSkipPointGaps ||
      activeTab !== 'record' ||
      !playback.playing ||
      highlightPlaylistActive
    ) return;
    const targetTimeMs = autoSkipTargetTimeMs(
      snapshot.data,
      Math.round(playback.currentTime * 1000),
      Math.round(Math.max(0, pointGapBufferSeconds) * 1000),
    );
    if (targetTimeMs !== null) seekPlayback(targetTimeMs / 1000);
  });

  onMount(() => {
    ownerId = crypto.randomUUID();
    window.addEventListener('keydown', handleShortcut);
    window.addEventListener('pagehide', releaseForPageClose);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
      window.removeEventListener('pagehide', releaseForPageClose);
      if (editing) releaseLock();
      stopHighlightPlaylist(false);
    };
  });

  /** Enter or leave the exclusive statistics editor from the page title bar. */
  export function toggleEditing(): void {
    if (editing) releaseLock();
    else void acquireLock(false);
  }

  async function acquireLock(takeover = false): Promise<void> {
    lockError = '';
    lockHeldElsewhere = false;
    try {
      const response = await fetch(resolve(`/api/games/${token}/edit-lock`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ownerId, takeover }),
      });
      const result = await response.json() as { acquired?: boolean; token?: string | null; error?: string };
      if (response.status === 409) {
        lockHeldElsewhere = true;
        return;
      }
      if (!response.ok || !result.acquired || !result.token) {
        lockError = result.error ?? 'The editing lock could not be acquired.';
        return;
      }
      lockToken = result.token;
      editing = true;
      onEditingChange(true);
      activeTab = snapshot.data.game.hasVideo ? 'record' : 'paper';
      connectPresence(result.token);
      await refreshSnapshotForEditing();
      if (editing && lockToken === result.token) seekToOpenPointResumeTime();
    } catch (caught) {
      lockError = caught instanceof Error ? caught.message : 'The editing lock could not be acquired.';
    }
  }

  async function refreshSnapshotForEditing(): Promise<void> {
    try {
      const response = await fetch(resolve(`/api/games/${token}/stats`), { cache: 'no-store' });
      if (!response.ok) return;
      snapshot = await response.json() as GameTrackingSnapshot;
      onSnapshotChange(snapshot);
      resetManualDrafts(snapshot);
    } catch {
      // The page's initial snapshot is still usable if a refresh is unavailable.
    }
  }

  function seekToOpenPointResumeTime(): void {
    if (!snapshot.data.game.hasVideo || !currentPoint || snapshot.currentPointState?.ended !== false) return;
    seekPlayback(latestPointTimeMs(currentPoint) / 1000);
  }

  function connectPresence(tokenValue: string): void {
    presenceAbort?.abort();
    const controller = new AbortController();
    presenceAbort = controller;
    void (async () => {
      try {
        const response = await fetch(
          resolve(`/api/games/${token}/edit-lock/presence?token=${encodeURIComponent(tokenValue)}`),
          { signal: controller.signal, cache: 'no-store' },
        );
        if (!response.ok || !response.body) throw new Error('The editing connection could not be opened.');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = '';
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          buffered = `${buffered}${decoder.decode(next.value, { stream: true })}`.slice(-512);
          if (buffered.includes('event: revoked')) {
            loseLock('Another player took over statistics editing.');
            return;
          }
        }
        if (editing && lockToken === tokenValue && !controller.signal.aborted) {
          loseLock('The live editing connection closed.');
        }
      } catch (caught) {
        if (!controller.signal.aborted && editing && lockToken === tokenValue) {
          loseLock(caught instanceof Error ? caught.message : 'The live editing connection closed.');
        }
      }
    })();
  }

  function loseLock(message: string): void {
    editing = false;
    onEditingChange(false);
    lockToken = '';
    lockError = message;
    draftMode = null;
    clearSpatialDraft();
    presenceAbort?.abort();
    presenceAbort = null;
  }

  function releaseLock(): void {
    const releasedToken = lockToken;
    editing = false;
    onEditingChange(false);
    lockToken = '';
    draftMode = null;
    clearSpatialDraft();
    presenceAbort?.abort();
    presenceAbort = null;
    if (releasedToken) {
      void fetch(resolve(`/api/games/${token}/edit-lock`), {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: releasedToken }),
        keepalive: true,
      });
    }
  }

  function releaseForPageClose(): void {
    releaseLock();
  }

  async function mutate(
    body: Record<string, unknown>,
    preserveUndoHistory = false,
  ): Promise<GameTrackingSnapshot | null> {
    if (!lockToken) return null;
    if (!preserveUndoHistory) redoEvent = null;
    saving = true;
    mutationError = '';
    try {
      const response = await fetch(resolve(`/api/games/${token}/stats`), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-uvs-edit-token': lockToken,
        },
        body: JSON.stringify(body),
      });
      const result = await response.json() as GameTrackingSnapshot | { error?: string };
      if (!response.ok) {
        const message = 'error' in result ? result.error ?? 'Statistics could not be updated.' : 'Statistics could not be updated.';
        if (response.status === 409) loseLock(message);
        else mutationError = message;
        return null;
      }
      snapshot = result as GameTrackingSnapshot;
      onSnapshotChange(snapshot);
      return snapshot;
    } catch (caught) {
      mutationError = caught instanceof Error ? caught.message : 'Statistics could not be updated.';
      return null;
    } finally {
      saving = false;
    }
  }

  function manualPlayerRows(value: GameTrackingSnapshot): ManualPlayerGameStatistics[] {
    const stored = new Map(value.data.manualPlayerStatistics.map((stats) => [stats.playerId, stats]));
    return value.data.players.map((player) => ({
      playerId: player.id,
      pointsPlayed: stored.get(player.id)?.pointsPlayed ?? 0,
      hockeyAssists: stored.get(player.id)?.hockeyAssists ?? 0,
      assists: stored.get(player.id)?.assists ?? 0,
      goals: stored.get(player.id)?.goals ?? 0,
      blocks: stored.get(player.id)?.blocks ?? 0,
    }));
  }

  function manualPointRows(value: GameTrackingSnapshot): ManualPointDraft[] {
    return value.data.manualPoints.map((point) => ({
      lineId: point.lineId,
      startingPossession: point.startingPossession,
      initialDefenseType: point.initialDefenseType ?? '',
      offenseStrategyId: point.offenseStrategyId ?? 0,
      defenseStrategyId: point.defenseStrategyId ?? 0,
      ourTurnovers: point.ourTurnovers,
      scoringMethod: point.scoringMethod ?? '',
      scorerPlayerId: point.scorerPlayerId?.toString() ?? '',
      ourScore: point.ourScore,
      opponentScore: point.opponentScore,
    }));
  }

  function resetManualDrafts(value: GameTrackingSnapshot = snapshot): void {
    manualPlayerDrafts = manualPlayerRows(value);
    manualPointDrafts = manualPointRows(value);
  }

  function addManualPoint(): void {
    const previous = manualPointDrafts.at(-1);
    const scoreBeforePrevious = manualPointDrafts.length > 1
      ? manualPointDrafts.at(-2)!.ourScore
      : snapshot.data.game.initialOurScore;
    const previousWasOurGoal = previous ? previous.ourScore > scoreBeforePrevious : false;
    manualPointDrafts.push({
      lineId: previous?.lineId ?? snapshot.data.lines[0]?.id ?? 0,
      startingPossession: previousWasOurGoal ? 'defense' : 'offense',
      initialDefenseType: '',
      offenseStrategyId: 0,
      defenseStrategyId: 0,
      ourTurnovers: 0,
      scoringMethod: '',
      scorerPlayerId: '',
      ourScore: (previous?.ourScore ?? snapshot.data.game.initialOurScore) + 1,
      opponentScore: previous?.opponentScore ?? snapshot.data.game.initialOpponentScore,
    });
  }

  function removeManualPoint(index: number): void {
    manualPointDrafts.splice(index, 1);
  }

  function manualPointIsOurGoal(index: number): boolean {
    const previousOurScore = index === 0
      ? snapshot.data.game.initialOurScore
      : manualPointDrafts[index - 1].ourScore;
    return manualPointDrafts[index].ourScore > previousOurScore;
  }

  async function saveManualSummary(): Promise<void> {
    const saved = await mutate({
      operation: 'saveManualSummary',
      playerStatistics: manualPlayerDrafts,
      points: manualPointDrafts.map((point, index) => ({
        ...point,
        initialDefenseType: point.startingPossession === 'defense'
          ? point.defenseStrategyId
            ? strategyName(point.defenseStrategyId)
            : point.initialDefenseType || null
          : null,
        offenseStrategyId: point.offenseStrategyId || null,
        defenseStrategyId: point.defenseStrategyId || null,
        scoringMethod: manualPointIsOurGoal(index) ? point.scoringMethod || null : null,
        scorerPlayerId: manualPointIsOurGoal(index) && point.scorerPlayerId
          ? Number(point.scorerPlayerId)
          : null,
      })),
    });
    if (saved) resetManualDrafts(saved);
  }

  function pauseForDraft(): void {
    stopHighlightPlaylist();
    const playback = getPlayback();
    resumeAfterDraft = playback.playing;
    pausePlayback();
  }

  function closeDraft(resume = true): void {
    draftMode = null;
    editingPointId = null;
    editingEventId = null;
    editingHighlightId = null;
    mutationError = '';
    clearSpatialDraft();
    if (resume && resumeAfterDraft) void playPlayback();
    resumeAfterDraft = false;
  }

  function currentSeconds(): number {
    return Math.max(0, getPlayback().currentTime);
  }

  function spatialRoleLabel(role: SpatialAnnotationRole): string {
    switch (role) {
      case 'handler': return 'Player with disc';
      case 'thrower': return 'Thrower';
      case 'receiver': return 'Receiver';
      case 'intended_receiver': return 'Intended receiver';
      case 'defender': return 'Defender';
      case 'turnover_location': return 'Turnover location';
      case 'scorer': return 'Scorer';
      case 'outgoing_player': return 'Player out';
      case 'incoming_player': return 'Player in';
    }
  }

  function emitSpatialState(placementActive = false): void {
    onSpatialStateChange({
      placementActive,
      markers: spatialAnnotations.map((annotation) => ({
        label: spatialDraftStage === 'choose_action'
          ? 'Selected player'
          : spatialRoleLabel(annotation.role),
        point: {
          timeMs: annotation.timeMs,
          frameIndex: annotation.frameIndex,
          panoramaYaw: annotation.panoramaYaw,
          panoramaPitch: annotation.panoramaPitch,
          clientX: annotation.clientX,
          clientY: annotation.clientY,
        },
      })),
    });
  }

  function clearSpatialDraft(): void {
    spatialDraft = false;
    spatialDraftStage = 'inactive';
    spatialAnnotations = [];
    spatialPopover = null;
    onSpatialStateChange({ placementActive: false, markers: [] });
  }

  function beginSpatialPlacement(): void {
    if (
      recordingMode !== 'video_assisted' ||
      !editing ||
      !currentPoint ||
      !snapshot.currentPointState ||
      snapshot.currentPointState.ended ||
      snapshot.currentPointState.openStoppageEventId !== null
    ) return;

    if (spatialDraft) return;

    if (draftMode !== null) return;
    pauseForDraft();
    activeTab = 'record';
    draftMode = 'event';
    spatialDraft = true;
    spatialDraftStage = 'place_primary';
    spatialAnnotations = [];
    spatialPopover = null;
    emitSpatialState(true);
  }

  /** Accept a manual panorama point placed by the video viewer. */
  export function placeSpatialPoint(point: UVSViewerSpatialPoint): void {
    if (!spatialDraft || spatialDraftStage !== 'place_primary') return;
    spatialAnnotations = [...spatialAnnotations, {
      role: 'handler',
      playerId: null,
      timeMs: point.timeMs,
      frameIndex: point.frameIndex,
      panoramaYaw: point.panoramaYaw,
      panoramaPitch: point.panoramaPitch,
      clientX: point.clientX,
      clientY: point.clientY,
    }];
    eventTimeSeconds = point.timeMs / 1000;
    spatialDraftStage = 'choose_action';
    spatialPopover = spatialPopoverPosition(point);
    emitSpatialState(false);
  }

  /** Move a draft manual marker without changing its selected frame or time. */
  export function adjustSpatialPoint(index: number, point: UVSViewerSpatialPoint): void {
    const existing = spatialAnnotations[index];
    if (!existing) return;
    spatialAnnotations = spatialAnnotations.map((annotation, annotationIndex) =>
      annotationIndex === index
        ? {
            ...annotation,
            panoramaYaw: point.panoramaYaw,
            panoramaPitch: point.panoramaPitch,
            clientX: point.clientX,
            clientY: point.clientY,
          }
        : annotation,
    );
    if (index === spatialAnnotations.length - 1) spatialPopover = spatialPopoverPosition(point);
    emitSpatialState(false);
  }

  function spatialPopoverPosition(point: Pick<UVSViewerSpatialPoint, 'clientX' | 'clientY'>): { left: number; top: number } {
    return {
      left: Math.max(12, Math.min(window.innerWidth - 332, point.clientX + 14)),
      top: Math.max(12, Math.min(window.innerHeight - 430, point.clientY + 14)),
    };
  }

  function chooseSpatialAction(type: 'possession_start' | 'completion' | 'turnover' | 'defended' | 'goal'): void {
    if (!currentPoint || spatialAnnotations.length !== 1) return;
    eventPointId = currentPoint.id;
    eventType = type;
    resetEventFields(type);
    const state = snapshot.currentPointState;
    const callahanGoal = type === 'goal' && state?.possession === 'defense';
    callahan = callahanGoal;

    let role: SpatialAnnotationRole;
    if (type === 'possession_start') role = 'handler';
    else if (type === 'completion') role = 'receiver';
    else if (type === 'turnover') role = 'intended_receiver';
    else if (type === 'defended') role = 'defender';
    else role = 'scorer';

    const clicked = { ...spatialAnnotations[0], role, playerId: null };
    const carriedThrower =
      (type === 'completion' || type === 'turnover' || (type === 'goal' && !callahanGoal)) &&
      state?.handlerPlayerId !== null &&
      state?.handlerPlayerId !== undefined
        ? carriedHandlerSpatialAnnotation(state.handlerPlayerId)
        : null;
    spatialAnnotations = carriedThrower
      ? [{ ...carriedThrower, role: 'thrower' }, clicked]
      : [clicked];
    spatialDraftStage = 'details';
    emitSpatialState(false);
  }

  async function saveSpatialOpponentTurnover(): Promise<void> {
    if (!currentPoint || spatialAnnotations.length !== 1 || saving) return;
    eventPointId = currentPoint.id;
    eventType = 'opponent_turnover';
    resetEventFields('opponent_turnover');
    opponentTurnoverReason = 'unknown';
    spatialAnnotations = [{
      ...spatialAnnotations[0],
      role: 'turnover_location',
      playerId: null,
    }];
    spatialDraftStage = 'details';
    emitSpatialState(false);
    await saveEvent();
  }

  function carriedHandlerSpatialAnnotation(playerId: number): SpatialDraftAnnotation | null {
    if (!currentPoint) return null;
    const annotation = latestHandlerSpatialAnnotation(currentPoint, playerId);
    return annotation
      ? {
          role: 'thrower',
          playerId,
          timeMs: annotation.timeMs,
          frameIndex: annotation.frameIndex,
          panoramaYaw: annotation.panoramaYaw,
          panoramaPitch: annotation.panoramaPitch,
          clientX: 0,
          clientY: 0,
        }
      : null;
  }

  async function selectSpatialClickedPlayer(playerId: number): Promise<void> {
    if (saving) return;
    if (eventType === 'completion' || eventType === 'turnover' || eventType === 'goal') {
      secondPlayerId = playerId.toString();
    } else {
      firstPlayerId = playerId.toString();
    }
    spatialAnnotations = spatialAnnotations.map((annotation, index) => index === spatialAnnotations.length - 1
      ? { ...annotation, playerId }
      : annotation);
    emitSpatialState(false);
    await saveEvent();
  }

  function spatialClickedPlayerId(): string {
    return eventType === 'completion' || eventType === 'turnover' || eventType === 'goal'
      ? secondPlayerId
      : firstPlayerId;
  }

  function pointScrubberAtTime(timeMs: number): PointScrubberRange | null {
    const completedPoint = [...snapshot.data.points].reverse().find((point) => {
      const state = calculatePointState(point);
      return state.ended && state.endTimeMs !== null &&
        timeMs >= point.startTimeMs && timeMs <= state.endTimeMs;
    });
    if (completedPoint) {
      return {
        point: completedPoint,
        startTimeMs: completedPoint.startTimeMs,
        endTimeMs: calculatePointState(completedPoint).endTimeMs ?? completedPoint.startTimeMs,
        completed: true,
      };
    }
    if (!currentPoint) return null;
    return {
      point: currentPoint,
      startTimeMs: currentPoint.startTimeMs,
      endTimeMs: Math.max(
        currentPoint.startTimeMs,
        latestPointTimeMs(currentPoint),
        observedOpenPointEndMs,
      ),
      completed: false,
    };
  }

  function nextPointAfterTime(timeMs: number): TrackingPoint | null {
    return [...snapshot.data.points]
      .sort((left, right) => left.startTimeMs - right.startTimeMs || left.id - right.id)
      .find((point) => point.startTimeMs > timeMs) ?? null;
  }

  function adjacentNavigationPoint(direction: -1 | 1): TrackingPoint | null {
    const points = [...snapshot.data.points].sort(
      (left, right) => left.sequenceNumber - right.sequenceNumber || left.id - right.id,
    );
    if (recordPoint) {
      const index = points.findIndex((point) => point.id === recordPoint.id);
      return points[index + direction] ?? null;
    }
    const timeMs = Math.round(playback.currentTime * 1000);
    return direction === -1
      ? points.filter((point) => point.startTimeMs < timeMs).at(-1) ?? null
      : points.find((point) => point.startTimeMs > timeMs) ?? null;
  }

  function seekToPoint(point: TrackingPoint): void {
    seekPlayback(point.startTimeMs / 1000);
  }

  function scrubPoint(event: Event): void {
    seekPlayback(Number((event.currentTarget as HTMLInputElement).value) / 1000);
  }

  function setPointGapBuffer(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    pointGapBufferSeconds = Number.isFinite(value)
      ? Math.min(60, Math.max(0, value))
      : 5;
  }

  function defaultStrategyId(value: GameTrackingSnapshot, kind: StrategyKind): number {
    const choices = value.data.strategies.filter((strategy) => strategy.kind === kind);
    return choices.find((strategy) => strategy.isDefault)?.id ?? choices[0]?.id ?? 0;
  }

  function strategyName(id: number | null | undefined): string {
    if (!id) return 'Not set';
    return snapshot.data.strategies.find((strategy) => strategy.id === id)?.name ?? 'Unavailable';
  }

  function openNewPoint(): void {
    if (snapshot.data.lines.length === 0 || snapshot.data.players.length === 0) return;
    pauseForDraft();
    const previous = snapshot.data.points.at(-1);
    const previousOutcome = previous ? calculatePointState(previous).outcome : null;
    pointPossession = previousOutcome === 'goal' ? 'defense' : 'offense';
    pointLineId = previous?.lineId ?? snapshot.data.lines[0].id;
    pointPullerId = '';
    pointEndzoneOverride = '';
    pointPlayerIds = [];
    pointMatchupRoleOverrides = {};
    editingPointId = null;
    draftMode = 'point';
  }

  function openPointEditor(point: TrackingPoint): void {
    pauseForDraft();
    seekPlayback(point.startTimeMs / 1000);
    pointLineId = point.lineId;
    pointPossession = point.startingPossession;
    pointPullerId = point.pullerPlayerId?.toString() ?? '';
    pointEndzoneOverride = point.lineupEndzoneOverride ?? '';
    pointPlayerIds = [...point.startingPlayerIds];
    pointMatchupRoleOverrides = { ...point.matchupRoleOverrides };
    editingPointId = point.id;
    draftMode = 'point';
  }

  function chooseLine(lineId: number): void {
    pointLineId = lineId;
  }

  function automaticPointEndzone(): TeamEndzone {
    const target = editingPointId === null
      ? null
      : snapshot.data.points.find((point) => point.id === editingPointId) ?? null;
    const data = target
      ? {
          ...snapshot.data,
          points: snapshot.data.points.map((point) =>
            point.id === target.id ? { ...point, lineupEndzoneOverride: null } : point,
          ),
        }
      : snapshot.data;
    const timeMs = target ? Math.max(0, target.startTimeMs - 1) : Math.round(currentSeconds() * 1000);
    return autoCameraEndzoneAtTime(data, timeMs) ?? snapshot.data.game.initialLineupEndzone;
  }

  async function setInitialEndzone(endzone: TeamEndzone): Promise<void> {
    await mutate({ operation: 'setInitialEndzone', endzone });
  }

  function pointPlayerOptions() {
    const linePlayerIds = new Set(
      snapshot.data.lines.find((line) => line.id === pointLineId)?.suggestedPlayerIds ?? [],
    );
    const roleOrder: Record<MatchupRole, number> = { fmp: 0, mmp: 1 };
    return [...snapshot.data.players].sort((left, right) => {
      const lineDifference = Number(!linePlayerIds.has(left.id)) - Number(!linePlayerIds.has(right.id));
      if (lineDifference !== 0) return lineDifference;
      const roleDifference = (left.matchupRole ? roleOrder[left.matchupRole] : 2) -
        (right.matchupRole ? roleOrder[right.matchupRole] : 2);
      if (roleDifference !== 0) return roleDifference;
      return left.name.localeCompare(right.name);
    });
  }

  function isPointLinePlayer(playerId: number): boolean {
    return snapshot.data.lines
      .find((line) => line.id === pointLineId)
      ?.suggestedPlayerIds.includes(playerId) ?? false;
  }

  function togglePointPlayer(playerId: number): void {
    pointPlayerIds = pointPlayerIds.includes(playerId)
      ? pointPlayerIds.filter((id) => id !== playerId)
      : [...pointPlayerIds, playerId];
    if (!pointPlayerIds.includes(Number(pointPullerId))) pointPullerId = '';
    if (!pointPlayerIds.includes(playerId)) {
      const next = { ...pointMatchupRoleOverrides };
      delete next[playerId];
      pointMatchupRoleOverrides = next;
    }
  }

  function playerGameRole(playerId: number): MatchupRole | null {
    return snapshot.data.players.find((player) => player.id === playerId)?.matchupRole ?? null;
  }

  function pointPlayerRole(playerId: number): MatchupRole | null {
    return pointMatchupRoleOverrides[playerId] ?? playerGameRole(playerId);
  }

  function setPointMatchupRole(playerId: number, value: string): void {
    const next = { ...pointMatchupRoleOverrides };
    if (value === 'mmp' || value === 'fmp') next[playerId] = value;
    else delete next[playerId];
    pointMatchupRoleOverrides = next;
  }

  function draftPointMatchup(): MatchupRole | null {
    return classifyMatchupRoles(pointPlayerIds.map(pointPlayerRole));
  }

  function stepDraftFrame(frameDelta: -10 | -1 | 1 | 10): void {
    stepPlaybackFrames(frameDelta);
    if (draftMode === 'event') {
      eventTimeSeconds = currentSeconds();
    }
  }

  function persistedPointMatchup(point: TrackingPoint): MatchupRole | null {
    return classifyMatchupRoles(
      point.startingPlayerIds.map(
        (playerId) => point.matchupRoleOverrides[playerId] ?? playerGameRole(playerId),
      ),
    );
  }

  async function savePoint(): Promise<void> {
    const operation = editingPointId === null ? 'startPoint' : 'updatePoint';
    const result = await mutate({
      operation,
      pointId: editingPointId,
      lineId: pointLineId,
      startingPossession: pointPossession,
      timeMs: Math.round(currentSeconds() * 1000),
      pullerPlayerId: pointPullerId ? Number(pointPullerId) : null,
      playerIds: pointPlayerIds,
      matchupRoleOverrides: pointMatchupRoleOverrides,
      lineupEndzoneOverride: pointEndzoneOverride || null,
      initialOffenseStrategyId: null,
      initialDefenseStrategyId: null,
    });
    if (!result) return;
    closeDraft();
  }

  function openNewEvent(type: GameEventType): void {
    const pointId = type === 'score_set' ? null : snapshot.currentPointId;
    if (type !== 'score_set' && pointId === null) return;
    pauseForDraft();
    editingEventId = null;
    eventPointId = pointId;
    eventType = type;
    eventTimeSeconds = currentSeconds();
    resetEventFields(type);
    draftMode = 'event';
  }

  function openCallahan(): void {
    openNewEvent('goal');
    callahan = true;
    firstPlayerId = '';
  }

  function openStrategyEvent(kind: StrategyKind): void {
    openNewEvent('strategy_set');
    strategyKind = kind;
    const stateId = kind === 'offense'
      ? snapshot.currentPointState?.offenseStrategyId
      : snapshot.currentPointState?.defenseStrategyId;
    strategyId = stateId ?? defaultStrategyId(snapshot, kind);
  }

  function changeEventType(type: GameEventType): void {
    eventType = type;
    resetEventFields(type);
  }

  function openEventEditor(event: TrackingEvent): void {
    pauseForDraft();
    seekPlayback(event.timeMs / 1000);
    editingEventId = event.id;
    eventPointId = event.pointId;
    eventType = event.type;
    eventTimeSeconds = event.timeMs / 1000;
    resetEventFields(event.type, event.payload);
    draftMode = 'event';
  }

  function resetEventFields(type: GameEventType, payload?: GameEventPayload): void {
    firstPlayerId = '';
    secondPlayerId = '';
    turnoverReason = 'throwaway';
    opponentTurnoverReason = 'throwaway';
    callahan = false;
    stoppageKind = 'foul';
    stoppageEndSeconds = '';
    scoreUs = snapshot.statistics.ourScore;
    scoreOpponent = snapshot.statistics.opponentScore;
    strategyKind = 'offense';
    strategyId = defaultStrategyId(snapshot, 'offense');
    const state = eventPointId === snapshot.currentPointId ? snapshot.currentPointState : null;
    if (type === 'possession_start') {
      const value = payload as { playerId?: number | null } | undefined;
      firstPlayerId = (value?.playerId ?? state?.handlerPlayerId)?.toString() ?? '';
    } else if (type === 'completion') {
      const value = payload as { throwerId?: number | null; receiverId?: number | null } | undefined;
      firstPlayerId = (value?.throwerId ?? state?.handlerPlayerId)?.toString() ?? '';
      secondPlayerId = value?.receiverId?.toString() ?? '';
    } else if (type === 'turnover') {
      const value = payload as { throwerId?: number | null; intendedReceiverId?: number | null; reason?: string } | undefined;
      firstPlayerId = (value?.throwerId ?? state?.handlerPlayerId)?.toString() ?? '';
      secondPlayerId = value?.intendedReceiverId?.toString() ?? '';
      turnoverReason = value?.reason ?? 'throwaway';
    } else if (type === 'defended') {
      firstPlayerId = (payload as { defenderId?: number | null } | undefined)?.defenderId?.toString() ?? '';
    } else if (type === 'opponent_turnover') {
      opponentTurnoverReason = (payload as { reason?: string } | undefined)?.reason ?? 'throwaway';
    } else if (type === 'goal') {
      const value = payload as { throwerId?: number | null; receiverId?: number | null; callahan?: boolean } | undefined;
      callahan = value?.callahan ?? false;
      firstPlayerId = callahan ? '' : (value?.throwerId ?? state?.handlerPlayerId)?.toString() ?? '';
      secondPlayerId = value?.receiverId?.toString() ?? '';
    } else if (type === 'conceded') {
      callahan = (payload as { callahan?: boolean } | undefined)?.callahan ?? false;
    } else if (type === 'substitution') {
      const value = payload as { outgoingPlayerId?: number | null; incomingPlayerId?: number | null } | undefined;
      firstPlayerId = value?.outgoingPlayerId?.toString() ?? '';
      secondPlayerId = value?.incomingPlayerId?.toString() ?? '';
    } else if (type === 'stoppage') {
      const value = payload as { kind?: string; endTimeMs?: number | null } | undefined;
      stoppageKind = value?.kind ?? 'foul';
      stoppageEndSeconds = value?.endTimeMs === null || value?.endTimeMs === undefined
        ? ''
        : String(value.endTimeMs / 1000);
    } else if (type === 'score_set') {
      const value = payload as { ourScore?: number; opponentScore?: number } | undefined;
      scoreUs = value?.ourScore ?? snapshot.statistics.ourScore;
      scoreOpponent = value?.opponentScore ?? snapshot.statistics.opponentScore;
    } else if (type === 'strategy_set') {
      const value = payload as { kind?: StrategyKind; strategyId?: number } | undefined;
      strategyKind = value?.kind ?? snapshot.currentPointState?.possession ?? 'offense';
      const currentId = strategyKind === 'offense'
        ? snapshot.currentPointState?.offenseStrategyId
        : snapshot.currentPointState?.defenseStrategyId;
      strategyId = value?.strategyId ?? currentId ?? defaultStrategyId(snapshot, strategyKind);
    }
  }

  function eventPayload(): GameEventPayload {
    const first = firstPlayerId ? Number(firstPlayerId) : null;
    const second = secondPlayerId ? Number(secondPlayerId) : null;
    switch (eventType) {
      case 'possession_start': return { playerId: first };
      case 'completion': return { throwerId: first, receiverId: second };
      case 'turnover': return {
        throwerId: first,
        intendedReceiverId: second,
        reason: turnoverReason as 'drop' | 'block' | 'throwaway' | 'unknown',
      };
      case 'defended': return { defenderId: first };
      case 'opponent_turnover': return {
        reason: opponentTurnoverReason as 'drop' | 'throwaway' | 'unknown',
      };
      case 'goal': return { throwerId: callahan ? null : first, receiverId: second, callahan };
      case 'conceded': return { callahan };
      case 'substitution': return { outgoingPlayerId: first, incomingPlayerId: second };
      case 'stoppage': return {
        kind: stoppageKind as 'foul' | 'injury' | 'timeout' | 'other',
        endTimeMs: stoppageEndSeconds === '' ? null : Math.round(Number(stoppageEndSeconds) * 1000),
      };
      case 'score_set': return { ourScore: scoreUs, opponentScore: scoreOpponent };
      case 'strategy_set': return { kind: strategyKind, strategyId };
    }
  }

  function eventHasRequiredPlayerAttribution(): boolean {
    switch (eventType) {
      case 'possession_start':
        return firstPlayerId !== '';
      case 'completion':
        return firstPlayerId !== '' && secondPlayerId !== '';
      case 'turnover':
        return firstPlayerId !== '';
      case 'defended':
        return firstPlayerId !== '';
      case 'goal':
        return secondPlayerId !== '' && (callahan || firstPlayerId !== '');
      default:
        return true;
    }
  }

  function changeStrategyKind(kind: StrategyKind): void {
    strategyKind = kind;
    const currentId = kind === 'offense'
      ? snapshot.currentPointState?.offenseStrategyId
      : snapshot.currentPointState?.defenseStrategyId;
    strategyId = currentId ?? defaultStrategyId(snapshot, kind);
  }

  function openNewHighlight(): void {
    pauseForDraft();
    const end = currentSeconds();
    editingHighlightId = null;
    highlightStartSeconds = Math.max(0, end - 5);
    highlightEndSeconds = Math.max(highlightStartSeconds + 0.001, end);
    highlightDescription = '';
    highlightPlayerIds = [];
    draftMode = 'highlight';
  }

  function openHighlightEditor(highlight: GameHighlight): void {
    pauseForDraft();
    editingHighlightId = highlight.id;
    highlightStartSeconds = highlight.startTimeMs / 1000;
    highlightEndSeconds = highlight.endTimeMs / 1000;
    highlightDescription = highlight.description;
    highlightPlayerIds = [...highlight.playerIds];
    seekPlayback(highlight.startTimeMs / 1000);
    draftMode = 'highlight';
  }

  function seekHighlight(highlight: GameHighlight): void {
    stopHighlightPlaylist();
    seekPlayback(highlight.startTimeMs / 1000);
  }

  function setHighlightBoundary(boundary: 'start' | 'end'): void {
    const seconds = currentSeconds();
    if (boundary === 'start') highlightStartSeconds = seconds;
    else highlightEndSeconds = seconds;
  }

  function seekHighlightBoundary(boundary: 'start' | 'end'): void {
    seekPlayback(boundary === 'start' ? highlightStartSeconds : highlightEndSeconds);
  }

  function stepHighlightBoundary(boundary: 'start' | 'end', frames: -10 | -1 | 1 | 10): void {
    seekHighlightBoundary(boundary);
    stepPlaybackFrames(frames);
    requestAnimationFrame(() => setHighlightBoundary(boundary));
  }

  function toggleHighlightPlayer(playerId: number): void {
    highlightPlayerIds = highlightPlayerIds.includes(playerId)
      ? highlightPlayerIds.filter((id) => id !== playerId)
      : [...highlightPlayerIds, playerId];
  }

  async function saveHighlight(): Promise<void> {
    const result = await mutate({
      operation: editingHighlightId === null ? 'addHighlight' : 'updateHighlight',
      highlightId: editingHighlightId,
      startTimeMs: Math.round(highlightStartSeconds * 1000),
      endTimeMs: Math.round(highlightEndSeconds * 1000),
      description: highlightDescription,
      playerIds: highlightPlayerIds,
    });
    if (result) closeDraft(false);
  }

  async function deleteHighlight(highlight: GameHighlight): Promise<void> {
    if (!confirm(`Delete highlight “${highlight.description}”?`)) return;
    stopHighlightPlaylist();
    await mutate({ operation: 'deleteHighlight', highlightId: highlight.id });
  }

  async function playAllHighlights(): Promise<void> {
    const highlights = [...snapshot.data.highlights].sort(
      (left, right) => left.startTimeMs - right.startTimeMs || left.id - right.id,
    );
    if (highlights.length === 0) return;

    stopHighlightPlaylist();
    const run = ++highlightPlaylistRun;
    highlightPlaylistActive = true;
    highlightPlaylistPosition = 0;

    for (let index = 0; index < highlights.length; index += 1) {
      if (run !== highlightPlaylistRun) return;
      const highlight = highlights[index];
      highlightPlaylistPosition = index + 1;
      pausePlayback();
      seekPlayback(highlight.startTimeMs / 1000);

      for (let countdownSeconds = 3; countdownSeconds >= 1; countdownSeconds -= 1) {
        onHighlightOverlayChange({
          description: highlight.description,
          position: index + 1,
          total: highlights.length,
          countdownSeconds,
        });
        if (!await playlistDelay(1_000, run)) return;
      }

      onHighlightOverlayChange({
        description: highlight.description,
        position: index + 1,
        total: highlights.length,
        countdownSeconds: null,
      });
      try {
        await playPlayback();
      } catch {
        stopHighlightPlaylist();
        return;
      }
      if (!await playlistDelay(120, run)) return;

      while (run === highlightPlaylistRun) {
        const playback = getPlayback();
        if (playback.currentTime * 1000 >= highlight.endTimeMs - 20) break;
        if (!playback.playing) {
          stopHighlightPlaylist();
          return;
        }
        if (!await playlistDelay(40, run)) return;
      }
      if (run !== highlightPlaylistRun) return;
      pausePlayback();
    }

    if (run === highlightPlaylistRun) stopHighlightPlaylist(false);
  }

  function stopHighlightPlaylist(pause = true): void {
    if (!highlightPlaylistActive && highlightPlaylistPosition === 0) {
      onHighlightOverlayChange(null);
      return;
    }
    highlightPlaylistRun += 1;
    highlightPlaylistActive = false;
    highlightPlaylistPosition = 0;
    onHighlightOverlayChange(null);
    if (pause) pausePlayback();
  }

  function playlistDelay(milliseconds: number, run: number): Promise<boolean> {
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(run === highlightPlaylistRun), milliseconds);
    });
  }

  async function saveEvent(): Promise<void> {
    const positionedAnnotation = spatialDraft ? spatialAnnotations.at(-1) : null;
    eventTimeSeconds = positionedAnnotation
      ? positionedAnnotation.timeMs / 1000
      : currentSeconds();
    const result = await mutate({
      operation: editingEventId === null ? 'addEvent' : 'updateEvent',
      eventId: editingEventId,
      pointId: eventType === 'score_set' ? null : eventPointId,
      timeMs: Math.round(eventTimeSeconds * 1000),
      type: eventType,
      payload: eventPayload(),
      ...(spatialDraft ? {
        annotations: spatialAnnotations.map((annotation) => ({
          role: annotation.role,
          playerId: annotation.playerId,
          timeMs: annotation.timeMs,
          frameIndex: annotation.frameIndex,
          panoramaYaw: annotation.panoramaYaw,
          panoramaPitch: annotation.panoramaPitch,
        })),
      } : {}),
    });
    if (!result) return;
    closeDraft();
  }

  async function closeOpenStoppage(): Promise<void> {
    if (!currentPoint || snapshot.currentPointState?.openStoppageEventId === null) return;
    const event = currentPoint.events.find(
      (candidate) => candidate.id === snapshot.currentPointState?.openStoppageEventId,
    );
    if (!event || event.type !== 'stoppage') return;
    const wasPlaying = getPlayback().playing;
    pausePlayback();
    const result = await mutate({
      operation: 'updateEvent',
      eventId: event.id,
      pointId: event.pointId,
      timeMs: event.timeMs,
      type: event.type,
      payload: { ...event.payload, endTimeMs: Math.round(currentSeconds() * 1000) },
    });
    if (result && wasPlaying) void playPlayback();
  }

  async function deleteEvent(event: TrackingEvent): Promise<void> {
    if (!confirm(`Delete ${gameEventLabel(event.type).toLowerCase()} at ${formatTime(event.timeMs)}?`)) return;
    await mutate({ operation: 'deleteEvent', eventId: event.id });
  }

  async function deletePoint(point: TrackingPoint): Promise<void> {
    if (!confirm(`Delete point ${point.sequenceNumber} and all of its events?`)) return;
    await mutate({ operation: 'deletePoint', pointId: point.id });
  }

  function lastUndoableTimelineEntry():
    | { kind: 'event'; event: TrackingEvent }
    | { kind: 'point'; point: TrackingPoint }
    | null {
    const item = timelineItems().at(-1);
    if (!item) return null;
    return item.kind === 'event'
      ? { kind: 'event', event: item.event }
      : { kind: 'point', point: item.point };
  }

  function undoTimelineEntryLabel(): string {
    const entry = lastUndoableTimelineEntry();
    if (!entry) return 'Undo';
    return entry.kind === 'event'
      ? `Undo ${gameEventLabel(entry.event.type).toLowerCase()}`
      : `Undo point ${entry.point.sequenceNumber}`;
  }

  async function undoLastTimelineEntry(): Promise<void> {
    const timeline = timelineItems();
    const entry = lastUndoableTimelineEntry();
    if (!entry) return;
    const previousTimeMs = timeline.at(-2)?.timeMs ?? 0;
    const result = await mutate(
      entry.kind === 'event'
        ? { operation: 'deleteEvent', eventId: entry.event.id }
        : { operation: 'deletePoint', pointId: entry.point.id },
      true,
    );
    if (!result) return;
    redoEvent = entry.kind === 'event' ? entry.event : null;
    if (snapshot.data.game.hasVideo) seekPlayback(previousTimeMs / 1000);
  }

  async function redoLastTimelineEvent(): Promise<void> {
    const event = redoEvent;
    if (!event) return;
    const result = await mutate({
      operation: 'addEvent',
      pointId: event.pointId,
      timeMs: event.timeMs,
      type: event.type,
      payload: event.payload,
      annotations: event.annotations.map(({ id: _id, ...annotation }) => annotation),
    }, true);
    if (result) redoEvent = null;
  }

  function formActivePlayerIds(): number[] {
    const point = snapshot.data.points.find((candidate) => candidate.id === eventPointId);
    if (!point) return [];
    const before: TrackingPoint = {
      ...point,
      events: point.events.filter((event) =>
        event.id !== editingEventId &&
        (event.timeMs < Math.round(eventTimeSeconds * 1000) ||
          (event.timeMs === Math.round(eventTimeSeconds * 1000) && event.id < (editingEventId ?? Number.MAX_SAFE_INTEGER))),
      ),
    };
    return calculatePointState(before).activePlayerIds;
  }

  function inactivePlayers() {
    const active = new Set(formActivePlayerIds());
    return snapshot.data.players.filter((player) => !active.has(player.id));
  }

  function timelineItems(): Array<
    | { kind: 'point'; timeMs: number; id: number; point: TrackingPoint }
    | { kind: 'event'; timeMs: number; id: number; event: TrackingEvent; point: TrackingPoint | null }
  > {
    const items: ReturnType<typeof timelineItems> = [];
    for (const point of snapshot.data.points) {
      items.push({ kind: 'point', timeMs: point.startTimeMs, id: point.id, point });
      for (const event of point.events) {
        items.push({ kind: 'event', timeMs: event.timeMs, id: event.id, event, point });
      }
    }
    for (const event of snapshot.data.standaloneEvents) {
      items.push({ kind: 'event', timeMs: event.timeMs, id: event.id, event, point: null });
    }
    return items.sort((left, right) => {
      const timeDifference = left.timeMs - right.timeMs;
      if (timeDifference !== 0) return timeDifference;
      if (left.kind !== right.kind) return left.kind === 'point' ? -1 : 1;
      return left.id - right.id;
    });
  }

  function pointTimelineItems(point: TrackingPoint): ReturnType<typeof timelineItems> {
    return timelineItems().filter((item) => item.kind === 'point'
      ? item.point.id === point.id
      : item.point?.id === point.id);
  }

  function timelineItemIsLast(item: ReturnType<typeof timelineItems>[number]): boolean {
    const last = timelineItems().at(-1);
    return Boolean(last && last.kind === item.kind && last.id === item.id);
  }

  function eventTimelineContext(): EventTimelineContext {
    const draftTimeMs = Math.round(eventTimeSeconds * 1000);
    const items = timelineItems()
      .filter((item) => item.kind !== 'event' || item.event.id !== editingEventId)
      .map((item): TimelineContextItem & { timeMs: number } => item.kind === 'point'
        ? {
            timeMs: item.timeMs,
            label: `Point ${item.point.sequenceNumber} pull`,
            description: `${snapshot.data.lines.find((line) => line.id === item.point.lineId)?.name ?? 'Unknown line'} · ${item.point.startingPossession === 'offense' ? 'Offense' : 'Defense'}`,
          }
        : {
            timeMs: item.timeMs,
            label: gameEventLabel(item.event.type),
            description: eventDescription(item.event),
          });
    const previous = items.filter((item) => item.timeMs <= draftTimeMs).at(-1) ?? {
      label: 'Start of game',
      description: 'No earlier timeline entry',
    };
    const next = items.find((item) => item.timeMs > draftTimeMs) ?? null;
    return { previous, next };
  }

  function playerName(id: number | null | undefined): string {
    if (id === null || id === undefined) return 'Unknown';
    return snapshot.data.players.find((player) => player.id === id)?.name ?? 'Unknown';
  }

  function eventReasonLabel(reason: unknown): string {
    const value = String(reason);
    return value.length === 0 ? 'Unknown' : value[0].toUpperCase() + value.slice(1);
  }

  function eventDescription(event: TrackingEvent): string {
    const payload = event.payload as unknown as Record<string, unknown>;
    switch (event.type) {
      case 'possession_start': return playerName(payload.playerId as number | null);
      case 'completion': return `${playerName(payload.throwerId as number | null)} → ${playerName(payload.receiverId as number | null)}`;
      case 'turnover': {
        const thrower = playerName(payload.throwerId as number | null);
        const intendedReceiverId = payload.intendedReceiverId as number | null | undefined;
        const pass = intendedReceiverId === null || intendedReceiverId === undefined
          ? thrower
          : `${thrower} → ${playerName(intendedReceiverId)}`;
        return `${pass} · ${eventReasonLabel(payload.reason)}`;
      }
      case 'defended': return playerName(payload.defenderId as number | null);
      case 'opponent_turnover': return eventReasonLabel(payload.reason);
      case 'goal': return payload.callahan
        ? `${playerName(payload.receiverId as number | null)} · Callahan`
        : `${playerName(payload.throwerId as number | null)} → ${playerName(payload.receiverId as number | null)}`;
      case 'conceded': return payload.callahan ? 'Opponent Callahan' : snapshot.data.game.opponentName;
      case 'substitution': return `${playerName(payload.outgoingPlayerId as number | null)} → ${playerName(payload.incomingPlayerId as number | null)}`;
      case 'stoppage': return payload.endTimeMs === null
        ? `${String(payload.kind)} · open`
        : `${String(payload.kind)} · ${formatTime(Number(payload.endTimeMs))}`;
      case 'score_set': return `${String(payload.ourScore)}–${String(payload.opponentScore)}`;
      case 'strategy_set': return `${payload.kind === 'offense' ? 'Offense' : 'Defense'} · ${strategyName(payload.strategyId as number)}`;
    }
  }

  function formatTime(milliseconds: number): string {
    const totalSeconds = Math.max(0, milliseconds) / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
  }

  function handleShortcut(event: KeyboardEvent): void {
    if (!editing || event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, select, textarea') || target?.isContentEditable) return;
    const key = event.key.toLowerCase();
    if (key === 'escape' && spatialDraft) {
      event.preventDefault();
      closeDraft();
      return;
    }
    if (
      key === 's' &&
      recordingMode === 'video_assisted' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      beginSpatialPlacement();
      return;
    }
    if (target?.matches('button')) return;
    if (draftMode !== null) return;
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) void redoLastTimelineEvent();
      else void undoLastTimelineEntry();
      return;
    }
    if (!currentPoint || !snapshot.currentPointState || snapshot.currentPointState.ended) return;
    if (snapshot.currentPointState.openStoppageEventId !== null && key !== 'f') return;
    const possession = snapshot.currentPointState.possession;
    const shortcuts: Record<string, GameEventType | undefined> = recordingMode === 'forms'
      ? {
          p: possession === 'offense' ? 'possession_start' : undefined,
          c: possession === 'offense' ? 'completion' : undefined,
          t: possession === 'offense' ? 'turnover' : 'opponent_turnover',
          g: 'goal',
          x: possession === 'defense' ? 'conceded' : undefined,
          s: 'substitution',
          f: 'stoppage',
        }
      : {
          t: possession === 'defense' ? 'opponent_turnover' : undefined,
          x: possession === 'defense' ? 'conceded' : undefined,
          f: 'stoppage',
        };
    const type = shortcuts[key];
    if (type) {
      event.preventDefault();
      if (type === 'goal' && possession === 'defense') {
        openCallahan();
      } else if (type === 'stoppage' && snapshot.currentPointState.openStoppageEventId !== null) {
        void closeOpenStoppage();
      } else {
        openNewEvent(type);
      }
    }
  }

</script>

<aside class="stats-panel">
  <header class="score-header">
    <div class="score-team">
      <span>{snapshot.data.game.teamName}</span>
      <strong>{displayedScore.ourScore}</strong>
    </div>
    <span class="score-separator">–</span>
    <div class="score-team opponent">
      <span>{snapshot.data.game.opponentName}</span>
      <strong>{displayedScore.opponentScore}</strong>
    </div>
  </header>

  {#if lockHeldElsewhere}
    <div class="lock-banner">
      <Lock size={16} />
      <span>Another player is editing this game.</span>
      <button type="button" onclick={() => acquireLock(true)}>Take over</button>
    </div>
  {:else if lockError}
    <div class="lock-banner error"><ShieldAlert size={16} /><span>{lockError}</span></div>
  {/if}

  <nav class="panel-tabs" aria-label="Statistics views">
    {#if editing}
      {#if snapshot.data.game.hasVideo}
        <button class:active={activeTab === 'record'} type="button" disabled={draftMode !== null} onclick={() => activeTab = 'record'}>Record</button>
        <button class:active={activeTab === 'highlights'} type="button" disabled={draftMode !== null} onclick={() => activeTab = 'highlights'}>Highlights</button>
      {:else}
        <button class:active={activeTab === 'paper'} type="button" disabled={draftMode !== null} onclick={() => activeTab = 'paper'}>Paper</button>
      {/if}
    {:else}
      {#if snapshot.data.game.hasVideo}
        <button class:active={activeTab === 'record'} type="button" disabled={draftMode !== null} onclick={() => activeTab = 'record'}>Record</button>
        <button class:active={activeTab === 'highlights'} type="button" disabled={draftMode !== null} onclick={() => activeTab = 'highlights'}>Highlights</button>
      {:else}
        <button class:active={activeTab === 'paper'} type="button" disabled={draftMode !== null} onclick={() => activeTab = 'paper'}>Paper</button>
      {/if}
    {/if}
  </nav>

  {#if mutationError}
    <div class="mutation-error" role="alert"><AlertTriangle size={15} />{mutationError}</div>
  {/if}

  <div class="panel-content">
    {#if draftMode === 'point'}
      <form class="entry-form" onsubmit={(event) => { event.preventDefault(); void savePoint(); }}>
        <header><h2>{editingPointId === null ? 'Choose the next lineup' : 'Edit point'}</h2><button type="button" onclick={() => closeDraft()}><X size={17} /></button></header>
        {#if editingPointId === null}
          <p class="pull-instructions">Select the players, resume the video, then mark the pull release. The current video time will be captured automatically.</p>
        {:else}
          <div class="frame-position">
            <span>Video position</span>
            <div class="frame-stepper">
              <button type="button" onclick={() => stepDraftFrame(-10)}>−10 frames</button>
              <button type="button" onclick={() => stepDraftFrame(-1)}>−1 frame</button>
              <button type="button" onclick={() => stepDraftFrame(1)}>+1 frame</button>
              <button type="button" onclick={() => stepDraftFrame(10)}>+10 frames</button>
            </div>
          </div>
        {/if}
        <div class="two-fields">
          <label><span>Starts on</span><select bind:value={pointPossession}><option value="offense">Offense</option><option value="defense">Defense</option></select></label>
          <label><span>Line</span><select value={pointLineId} onchange={(event) => chooseLine(Number(event.currentTarget.value))}>{#each snapshot.data.lines as line}<option value={line.id}>{line.name}</option>{/each}</select></label>
        </div>
        <label>
          <span>Lineup endzone</span>
          <select bind:value={pointEndzoneOverride}>
            <option value="">Automatic ({automaticPointEndzone() === 'left' ? 'left' : 'right'} in video)</option>
            <option value="left">Override: left in video</option>
            <option value="right">Override: right in video</option>
          </select>
        </label>
        <fieldset class="lineup-picker">
          <legend>Players <small>{pointPlayerIds.length}/{snapshot.data.game.expectedPlayerCount}</small></legend>
          <div class="player-buttons">
            {#each pointPlayerOptions() as player}
              <button class:line-member={isPointLinePlayer(player.id)} class:selected={pointPlayerIds.includes(player.id)} type="button" onclick={() => togglePointPlayer(player.id)}>
                {#if pointPlayerIds.includes(player.id)}<Check size={13} />{/if}
                <span>{player.name}</span>
                <small
                  class:missing={pointPlayerRole(player.id) === null}
                  class:mmp={pointPlayerRole(player.id) === 'mmp'}
                  class:fmp={pointPlayerRole(player.id) === 'fmp'}
                >{pointPlayerRole(player.id)?.toUpperCase() ?? '?'}</small>
              </button>
            {/each}
          </div>
          {#if pointPlayerIds.length !== snapshot.data.game.expectedPlayerCount}
            <p class="lineup-warning"><AlertTriangle size={13} />Expected {snapshot.data.game.expectedPlayerCount}; this lineup is still allowed.</p>
          {/if}
        </fieldset>
        <details class="matchup-overrides">
          <summary>
            <span>Point matchup</span>
            <strong
              class:unclassified={draftPointMatchup() === null}
              class:mmp={draftPointMatchup() === 'mmp'}
              class:fmp={draftPointMatchup() === 'fmp'}
            >
              {draftPointMatchup()?.toUpperCase() ?? 'Unclassified'}
            </strong>
            <small>Override roles</small>
          </summary>
          <div>
            {#each snapshot.data.players.filter((player) => pointPlayerIds.includes(player.id)) as player}
              <label>
                <span>{player.name}</span>
                <select
                  value={pointMatchupRoleOverrides[player.id] ?? ''}
                  onchange={(event) => setPointMatchupRole(player.id, event.currentTarget.value)}
                >
                  <option value="">Game role ({player.matchupRole?.toUpperCase() ?? 'not set'})</option>
                  <option value="mmp">MMP override</option>
                  <option value="fmp">FMP override</option>
                </select>
              </label>
            {/each}
          </div>
        </details>
        {#if pointPossession === 'defense'}
          <fieldset class="quick-player-picker">
            <legend>Puller <small>optional</small></legend>
            <div>
              <button class:selected={pointPullerId === ''} type="button" aria-pressed={pointPullerId === ''} onclick={() => pointPullerId = ''}>Unknown</button>
              {#each snapshot.data.players.filter((player) => pointPlayerIds.includes(player.id)) as player}
                <button class:selected={pointPullerId === player.id.toString()} type="button" aria-pressed={pointPullerId === player.id.toString()} title={player.name} onclick={() => pointPullerId = player.id.toString()}>{player.name}</button>
              {/each}
            </div>
          </fieldset>
        {/if}
        <footer><button class="cancel" type="button" onclick={() => closeDraft()}>Cancel</button><button class="save" type="submit" disabled={saving || pointPlayerIds.length === 0}><Save size={14} />{saving ? 'Saving…' : editingPointId === null ? 'Mark pull now' : 'Save point'}</button></footer>
      </form>
    {:else if draftMode === 'event' && !spatialDraft}
      {@const timelineContext = eventTimelineContext()}
      <form class="entry-form" onsubmit={(event) => { event.preventDefault(); void saveEvent(); }}>
        <header><h2>{editingEventId === null ? gameEventLabel(eventType) : `Edit ${gameEventLabel(eventType).toLowerCase()}`}</h2><button type="button" onclick={() => closeDraft()}><X size={17} /></button></header>
        {#if editingEventId !== null}
          <label><span>Event type</span><select value={eventType} onchange={(event) => changeEventType(event.currentTarget.value as GameEventType)}>
            {#if eventPointId === null}
              <option value="score_set">Score set</option>
            {:else}
              <option value="possession_start">Start possession</option><option value="completion">Completion</option><option value="turnover">Turnover</option><option value="defended">Defended</option><option value="opponent_turnover">Opponent turnover</option><option value="goal">Goal</option><option value="conceded">Conceded</option><option value="substitution">Substitution</option><option value="stoppage">Stoppage</option><option value="strategy_set">Strategy change</option>
            {/if}
          </select></label>
        {/if}
        <div class="frame-position">
          <span>Video position</span>
          <div class="frame-stepper">
            <button type="button" onclick={() => stepDraftFrame(-10)}>−10 frames</button>
            <button type="button" onclick={() => stepDraftFrame(-1)}>−1 frame</button>
            <button type="button" onclick={() => stepDraftFrame(1)}>+1 frame</button>
            <button type="button" onclick={() => stepDraftFrame(10)}>+10 frames</button>
          </div>
        </div>
        <div class="timeline-insertion" aria-label="Position in timeline">
          <div class="timeline-neighbor previous">
            <small>Previous</small>
            <strong>{timelineContext.previous.label}</strong>
            <span>{timelineContext.previous.description}</span>
          </div>
          <div class="timeline-insertion-marker">
            <span></span>
            <strong>{editingEventId === null ? `Add ${gameEventLabel(eventType).toLowerCase()} here` : `Place ${gameEventLabel(eventType).toLowerCase()} here`}</strong>
            <span></span>
          </div>
          {#if timelineContext.next}
            <div class="timeline-neighbor next">
              <small>Next</small>
              <strong>{timelineContext.next.label}</strong>
              <span>{timelineContext.next.description}</span>
            </div>
          {:else}
            <div class="timeline-end">End of recorded timeline</div>
          {/if}
        </div>
        {#if eventType === 'possession_start'}
          <fieldset class="quick-player-picker required-picker">
            <legend>Player with disc</legend>
            <div>
              {#each snapshot.data.players.filter((player) => formActivePlayerIds().includes(player.id)) as player}
                <button class:selected={firstPlayerId === player.id.toString()} type="button" aria-pressed={firstPlayerId === player.id.toString()} title={player.name} onclick={() => firstPlayerId = player.id.toString()}>{player.name}</button>
              {/each}
            </div>
          </fieldset>
        {:else if eventType === 'completion'}
          <label><span>Thrower</span><select bind:value={firstPlayerId} required><option value="" disabled>Select thrower</option>{#each snapshot.data.players.filter((player) => formActivePlayerIds().includes(player.id)) as player}<option value={player.id.toString()}>{player.name}</option>{/each}</select></label>
          <fieldset class="quick-player-picker required-picker">
            <legend>Receiver</legend>
            <div>
              {#each snapshot.data.players.filter((player) => formActivePlayerIds().includes(player.id)) as player}
                <button class:selected={secondPlayerId === player.id.toString()} type="button" aria-pressed={secondPlayerId === player.id.toString()} title={player.name} onclick={() => secondPlayerId = player.id.toString()}>{player.name}</button>
              {/each}
            </div>
          </fieldset>
        {:else if eventType === 'turnover'}
          <div class="two-fields">
            <label><span>Reason</span><select bind:value={turnoverReason}><option value="drop">Drop</option><option value="block">Block</option><option value="throwaway">Throwaway</option><option value="unknown">Unknown</option></select></label>
            <label><span>Thrower</span><select bind:value={firstPlayerId} required><option value="" disabled>Select thrower</option>{#each snapshot.data.players.filter((player) => formActivePlayerIds().includes(player.id)) as player}<option value={player.id.toString()}>{player.name}</option>{/each}</select></label>
          </div>
          <fieldset class="quick-player-picker">
            <legend>Intended receiver <small>optional</small></legend>
            <div>
              <button class:selected={secondPlayerId === ''} type="button" aria-pressed={secondPlayerId === ''} title="No intended receiver or unknown" onclick={() => secondPlayerId = ''}>None / unknown</button>
              {#each snapshot.data.players.filter((player) => formActivePlayerIds().includes(player.id)) as player}
                <button class:selected={secondPlayerId === player.id.toString()} type="button" aria-pressed={secondPlayerId === player.id.toString()} title={player.name} onclick={() => secondPlayerId = player.id.toString()}>{player.name}</button>
              {/each}
            </div>
          </fieldset>
        {:else if eventType === 'defended'}
          <fieldset class="quick-player-picker required-picker">
            <legend>Defender</legend>
            <div>
              <button
                type="button"
                title="Record possession changing without awarding a player or line D"
                onclick={() => changeEventType('opponent_turnover')}
              >No player D — opponent turnover</button>
              {#each snapshot.data.players.filter((player) => formActivePlayerIds().includes(player.id)) as player}
                <button class:selected={firstPlayerId === player.id.toString()} type="button" aria-pressed={firstPlayerId === player.id.toString()} title={player.name} onclick={() => firstPlayerId = player.id.toString()}>{player.name}</button>
              {/each}
            </div>
          </fieldset>
        {:else if eventType === 'opponent_turnover'}
          <label><span>Reason</span><select bind:value={opponentTurnoverReason}><option value="drop">Drop</option><option value="throwaway">Throwaway</option><option value="unknown">Unknown</option></select></label>
        {:else if eventType === 'goal'}
          <label class="check-field"><input bind:checked={callahan} type="checkbox" onchange={() => { if (callahan) firstPlayerId = ''; }} />Callahan</label>
          {#if !callahan}<label><span>Thrower / assist</span><select bind:value={firstPlayerId} required><option value="" disabled>Select thrower</option>{#each snapshot.data.players.filter((player) => formActivePlayerIds().includes(player.id)) as player}<option value={player.id.toString()}>{player.name}</option>{/each}</select></label>{/if}
          <fieldset class="quick-player-picker required-picker">
            <legend>Scorer</legend>
            <div>
              {#each snapshot.data.players.filter((player) => formActivePlayerIds().includes(player.id)) as player}
                <button class:selected={secondPlayerId === player.id.toString()} type="button" aria-pressed={secondPlayerId === player.id.toString()} title={player.name} onclick={() => secondPlayerId = player.id.toString()}>{player.name}</button>
              {/each}
            </div>
          </fieldset>
        {:else if eventType === 'conceded'}
          <label class="check-field"><input bind:checked={callahan} type="checkbox" />Opponent Callahan</label>
        {:else if eventType === 'substitution'}
          <fieldset class="quick-player-picker">
            <legend>Player out <small>optional</small></legend>
            <div>
              <button class:selected={firstPlayerId === ''} type="button" aria-pressed={firstPlayerId === ''} onclick={() => firstPlayerId = ''}>Unknown</button>
              {#each snapshot.data.players.filter((player) => formActivePlayerIds().includes(player.id)) as player}
                <button class:selected={firstPlayerId === player.id.toString()} type="button" aria-pressed={firstPlayerId === player.id.toString()} title={player.name} onclick={() => firstPlayerId = player.id.toString()}>{player.name}</button>
              {/each}
            </div>
          </fieldset>
          <fieldset class="quick-player-picker">
            <legend>Player in <small>optional</small></legend>
            <div>
              <button class:selected={secondPlayerId === ''} type="button" aria-pressed={secondPlayerId === ''} onclick={() => secondPlayerId = ''}>Unknown</button>
              {#each inactivePlayers() as player}
                <button class:selected={secondPlayerId === player.id.toString()} type="button" aria-pressed={secondPlayerId === player.id.toString()} title={player.name} onclick={() => secondPlayerId = player.id.toString()}>{player.name}</button>
              {/each}
            </div>
          </fieldset>
        {:else if eventType === 'stoppage'}
          <label><span>Stoppage</span><select bind:value={stoppageKind}><option value="foul">Foul</option><option value="injury">Injury</option><option value="timeout">Timeout</option><option value="other">Other</option></select></label>
          {#if editingEventId !== null}<label><span>End time (blank while open)</span><input bind:value={stoppageEndSeconds} type="number" min={eventTimeSeconds} step="0.001" /></label>{/if}
        {:else if eventType === 'score_set'}
          <div class="two-fields"><label><span>{snapshot.data.game.teamName}</span><input bind:value={scoreUs} type="number" min="0" max="999" required /></label><label><span>{snapshot.data.game.opponentName}</span><input bind:value={scoreOpponent} type="number" min="0" max="999" required /></label></div>
        {:else if eventType === 'strategy_set'}
          <div class="two-fields">
            <label><span>System type</span><select value={strategyKind} onchange={(event) => changeStrategyKind(event.currentTarget.value as StrategyKind)}><option value="offense">Offense</option><option value="defense">Defense</option></select></label>
            <label><span>{strategyKind === 'offense' ? 'Offense' : 'Defense'}</span><select bind:value={strategyId} required>{#each snapshot.data.strategies.filter((strategy) => strategy.kind === strategyKind) as strategy}<option value={strategy.id}>{strategy.name}</option>{/each}</select></label>
          </div>
        {/if}
        <footer><button class="cancel" type="button" onclick={() => closeDraft()}>Cancel</button><button class="save" type="submit" disabled={saving || !eventHasRequiredPlayerAttribution()}><Save size={14} />{saving ? 'Saving…' : 'Save event'}</button></footer>
      </form>
    {:else if draftMode === 'highlight'}
      <form class="entry-form highlight-form" onsubmit={(event) => { event.preventDefault(); void saveHighlight(); }}>
        <header><h2>{editingHighlightId === null ? 'Add highlight' : 'Edit highlight'}</h2><button type="button" onclick={() => closeDraft(false)}><X size={17} /></button></header>
        <p class="pull-instructions">Mark the beginning and end of the play. Player attribution is optional.</p>
        {#each ['start', 'end'] as boundary}
          <div class="highlight-boundary">
            <div><span>{boundary === 'start' ? 'Start' : 'End'}</span><strong>{formatTime(Math.round((boundary === 'start' ? highlightStartSeconds : highlightEndSeconds) * 1000))}</strong></div>
            <div class="highlight-boundary-actions">
              <button type="button" onclick={() => seekHighlightBoundary(boundary as 'start' | 'end')}>Jump</button>
              <button type="button" onclick={() => setHighlightBoundary(boundary as 'start' | 'end')}>Use current</button>
              <button type="button" onclick={() => stepHighlightBoundary(boundary as 'start' | 'end', -10)}>−10</button>
              <button type="button" onclick={() => stepHighlightBoundary(boundary as 'start' | 'end', -1)}>−1</button>
              <button type="button" onclick={() => stepHighlightBoundary(boundary as 'start' | 'end', 1)}>+1</button>
              <button type="button" onclick={() => stepHighlightBoundary(boundary as 'start' | 'end', 10)}>+10</button>
            </div>
          </div>
        {/each}
        {#if highlightEndSeconds <= highlightStartSeconds}<p class="lineup-warning"><AlertTriangle size={13} />The end must be after the start.</p>{/if}
        <label><span>Description</span><textarea bind:value={highlightDescription} maxlength="500" rows="3" placeholder="Layout catch on the break side" required></textarea></label>
        <fieldset class="lineup-picker">
          <legend>Players <small>Optional · {highlightPlayerIds.length} selected</small></legend>
          <div class="player-buttons">
            {#each snapshot.data.players as player}
              <button class:selected={highlightPlayerIds.includes(player.id)} type="button" onclick={() => toggleHighlightPlayer(player.id)}>{#if highlightPlayerIds.includes(player.id)}<Check size={13} />{/if}<span>{player.name}</span></button>
            {/each}
          </div>
        </fieldset>
        <footer><button class="cancel" type="button" onclick={() => closeDraft(false)}>Cancel</button><button class="save" type="submit" disabled={saving || !highlightDescription.trim() || highlightEndSeconds <= highlightStartSeconds}><Save size={14} />{saving ? 'Saving…' : 'Save highlight'}</button></footer>
      </form>
    {:else if activeTab === 'record'}
      <section class="record-view">
        {#if editing}
          <div class="recorder-toolbar">
            <span><span class="live-dot"></span>Exclusive editor</span>
            {#if recordingMode === 'video_assisted'}
              <small><kbd>S</kbd> mark player on video</small>
            {/if}
          </div>
        {/if}

        {#if snapshot.data.points.length > 0}
          {#if !editing}
            <div class="point-results-table-wrap">
              <table class="point-results-table">
                <thead>
                  <tr><th>Point</th><th title={snapshot.data.game.teamName}>{snapshot.data.game.teamName}</th><th title={snapshot.data.game.opponentName}>{snapshot.data.game.opponentName}</th></tr>
                </thead>
                <tbody>
                  {#each pointResults as result}
                    <tr class:active={recordPoint?.id === result.pointId}>
                      <th><button type="button" onclick={() => { const point = snapshot.data.points.find((candidate) => candidate.id === result.pointId); if (point) seekToPoint(point); }}>Point {result.sequenceNumber}</button></th>
                      <td class:scored={result.result === 'won'}>{result.ourScore}</td>
                      <td class:scored={result.result === 'lost'} class:break-score={result.breakAgainst}>{result.opponentScore}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/if}

        {#if !recordPoint}
          <div class="point-empty">
            <ClipboardList size={25} />
            <strong>{snapshot.data.points.length === 0 ? 'No points recorded' : nextRecordedPoint ? 'Between points' : 'Ready for the next point'}</strong>
            <span>{nextRecordedPoint ? `Point ${nextRecordedPoint.sequenceNumber} is the next recorded point.` : 'Choose the line and players, then resume the video and mark the pull release.'}</span>
            {#if nextRecordedPoint && !editing}
              <button type="button" onclick={() => seekToPoint(nextRecordedPoint)}><ChevronRight size={15} />Next point</button>
            {/if}
            {#if editing}
              {#if snapshot.data.points.length === 0}
                <div class="starting-endzone">
                  <span>We start at the</span>
                  <div>
                    <button class:active={snapshot.data.game.initialLineupEndzone === 'left'} type="button" disabled={saving} onclick={() => void setInitialEndzone('left')}>Left end</button>
                    <button class:active={snapshot.data.game.initialLineupEndzone === 'right'} type="button" disabled={saving} onclick={() => void setInitialEndzone('right')}>Right end</button>
                  </div>
                  <small>As seen in the panoramic video</small>
                </div>
              {/if}
              {#if !nextRecordedPoint}
                <button
                  type="button"
                  onclick={openNewPoint}
                  disabled={snapshot.data.lines.length === 0 || snapshot.data.players.length === 0}
                  title={snapshot.data.lines.length === 0
                    ? 'Add an event line before recording.'
                    : snapshot.data.players.length === 0
                      ? 'Add players to this event roster before recording.'
                      : 'Choose the lineup before marking the pull.'}
                ><Plus size={15} />Start point</button>
              {/if}
              <button class="score-sync" type="button" onclick={() => openNewEvent('score_set')}><RefreshCw size={14} />Set current score</button>
              {#if snapshot.data.lines.length === 0}<small>Add at least one event line before recording.</small>{/if}
              {#if snapshot.data.players.length === 0}
                <small>
                  This event roster has no players.
                  {#if manageTournamentUrl}<a href={manageTournamentUrl}>Choose its players</a>{:else}Ask an administrator to add them.{/if}
                </small>
              {/if}
            {/if}
          </div>
        {:else if recordPointState}
          <div class="point-status">
            <div><strong>Point {recordPoint.sequenceNumber}</strong><span>{recordLine?.name ?? 'Unknown line'} · {persistedPointMatchup(recordPoint)?.toUpperCase() ?? 'unclassified'} · started {recordPoint.startingPossession === 'offense' ? 'O' : 'D'}</span></div>
            <span class:offense={!recordPointState.ended && recordPointState.possession === 'offense'} class:won={recordPointState.outcome === 'goal'} class="possession-badge">{recordPointState.ended ? recordPointState.outcome === 'goal' ? 'Goal' : 'Conceded' : recordPointState.possession === 'offense' ? 'Offense' : 'Defense'}</span>
          </div>
          {#if recordPointState.offenseStrategyId !== null || recordPointState.defenseStrategyId !== null}
            <div class="strategy-status">
              {#if recordPointState.offenseStrategyId !== null}<span><small>Offense</small>{strategyName(recordPointState.offenseStrategyId)}</span>{/if}
              {#if recordPointState.defenseStrategyId !== null}<span><small>Defense</small>{strategyName(recordPointState.defenseStrategyId)}</span>{/if}
            </div>
          {/if}
          <div class="active-lineup">
            {#each snapshot.data.players.filter((player) => recordPointState?.activePlayerIds.includes(player.id)) as player}
              <span class:handler={recordPointState.handlerPlayerId === player.id}>{player.name}{#if recordPointState.handlerPlayerId === player.id}<small>disc</small>{/if}</span>
            {/each}
          </div>

          {#if editing && recordPointState.ended && !currentPoint && !nextRecordedPoint}
            <div class="completed-point-actions">
              <button type="button" onclick={openNewPoint} disabled={snapshot.data.lines.length === 0 || snapshot.data.players.length === 0}><Plus size={14} />Set up next point</button>
              <button type="button" onclick={() => openNewEvent('score_set')}><RefreshCw size={13} />Set current score</button>
            </div>
          {/if}

          {#if editing && currentPoint?.id === recordPoint.id && !recordPointState.ended}
            {#if recordingMode === 'video_assisted'}
              {#if recordPointState.possession === 'defense'}
                <div class="non-player-actions">
                  <button type="button" disabled={recordPointState.openStoppageEventId !== null} onclick={() => openNewEvent('opponent_turnover')}>Opponent turnover</button>
                  <button type="button" disabled={recordPointState.openStoppageEventId !== null} onclick={() => openNewEvent('conceded')}>Conceded</button>
                </div>
              {/if}
            {:else}
              <div class:four-actions={recordPointState.possession === 'defense' || recordPointState.handlerPlayerId === null} class="action-groups">
                {#if recordPointState.possession === 'offense'}
                  {#if recordPointState.handlerPlayerId === null}
                    <button class="main-action possession" type="button" disabled={recordPointState.openStoppageEventId !== null} onclick={() => openNewEvent('possession_start')}><span>P</span>Start possession</button>
                  {/if}
                  <button class="main-action completion" type="button" disabled={recordPointState.openStoppageEventId !== null} onclick={() => openNewEvent('completion')}><span>C</span>Completion</button>
                  <button class="main-action turnover" type="button" disabled={recordPointState.openStoppageEventId !== null} onclick={() => openNewEvent('turnover')}><span>T</span>Turnover</button>
                  <button class="main-action goal" type="button" disabled={recordPointState.openStoppageEventId !== null} onclick={() => openNewEvent('goal')}><span>G</span>Goal</button>
                {:else}
                  <button class="main-action defended" type="button" disabled={recordPointState.openStoppageEventId !== null} onclick={() => openNewEvent('defended')}><span>D</span>Defended</button>
                  <button class="main-action turnover" type="button" disabled={recordPointState.openStoppageEventId !== null} onclick={() => openNewEvent('opponent_turnover')}><span>T</span>Opponent turnover</button>
                  <button class="main-action goal" type="button" disabled={recordPointState.openStoppageEventId !== null} onclick={openCallahan}><span>G</span>Callahan</button>
                  <button class="main-action conceded" type="button" disabled={recordPointState.openStoppageEventId !== null} onclick={() => openNewEvent('conceded')}><span>X</span>Conceded</button>
                {/if}
              </div>
            {/if}
            <div class="secondary-actions">
              <button type="button" onclick={() => openNewEvent('substitution')}><Users size={14} /><span>Substitute</span>{#if recordingMode === 'forms'}<kbd>S</kbd>{/if}</button>
              {#if recordPointState.openStoppageEventId !== null}
                <button class="resume" type="button" onclick={() => void closeOpenStoppage()}><Play size={14} /><span>Resume play</span><kbd>F</kbd></button>
              {:else}
                <button type="button" onclick={() => openNewEvent('stoppage')}><Pause size={14} /><span>Stoppage</span><kbd>F</kbd></button>
              {/if}
              <button type="button" onclick={() => openNewEvent('score_set')}><RefreshCw size={14} /><span>Set score</span></button>
            </div>
            <div class="strategy-actions">
              <button type="button" onclick={() => openStrategyEvent('offense')}><small>Set offense</small>{#if recordPointState.offenseStrategyId !== null}<strong>{strategyName(recordPointState.offenseStrategyId)}</strong>{/if}</button>
              <button type="button" onclick={() => openStrategyEvent('defense')}><small>Set defense</small>{#if recordPointState.defenseStrategyId !== null}<strong>{strategyName(recordPointState.defenseStrategyId)}</strong>{/if}</button>
            </div>
          {/if}
          <div class="recent-events point-events">
            <header>
              <h3>Point {recordPoint.sequenceNumber} timeline</h3>
              <div class="recent-header-actions">
                <span>{recordPoint.events.length} event{recordPoint.events.length === 1 ? '' : 's'}</span>
                {#if editing && redoEvent}
                  <button type="button" onclick={() => void redoLastTimelineEvent()} disabled={saving} title={`Restore ${gameEventLabel(redoEvent.type).toLowerCase()}`}><span class="redo-icon"><RotateCcw size={13} /></span>Redo</button>
                {/if}
              </div>
            </header>
            {#each pointTimelineItems(recordPoint).reverse() as item, index}
              <div class="recent-row" class:latest={index === 0}>
                <button class="recent-row-main" type="button" onclick={() => seekPlayback(item.timeMs / 1000)}>
                  <time>{formatTime(item.timeMs - recordPoint.startTimeMs)}</time>
                  <span>{item.kind === 'point' ? 'Pull' : gameEventLabel(item.event.type)}</span>
                  <small>{item.kind === 'point' ? `${recordLine?.name ?? 'Unknown line'} · ${persistedPointMatchup(item.point)?.toUpperCase() ?? 'unclassified'}` : eventDescription(item.event)}</small>
                </button>
                {#if editing && timelineItemIsLast(item)}
                  <button
                    class="recent-undo"
                    type="button"
                    onclick={() => void undoLastTimelineEntry()}
                    disabled={saving}
                    title={undoTimelineEntryLabel()}
                  ><RotateCcw size={13} />Undo</button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
        {#if snapshot.statistics.warnings.length > 0}
          <div class="quality-warnings">
            <header><AlertTriangle size={14} /><strong>Needs review</strong><span>{snapshot.statistics.warnings.length}</span></header>
            {#each snapshot.statistics.warnings.slice(0, 4) as warning}<p>{warning}</p>{/each}
            {#if snapshot.statistics.warnings.length > 4}<p>{snapshot.statistics.warnings.length - 4} more warnings</p>{/if}
          </div>
        {/if}
      </section>
    {:else if activeTab === 'paper'}
      <section class="paper-view">
        <header>
          <div>
            <h2>Paper statistics</h2>
            <span>Whole-game totals and point summaries</span>
          </div>
          {#if snapshot.data.manualPoints.length > 0 || snapshot.data.manualPlayerStatistics.length > 0}
            <small>Imported</small>
          {/if}
        </header>
        <p class="paper-coverage-note">
          Player totals supply points, hockey assists, assists, goals, and Ds. Point rows supply score and line results. Play-by-play-only fields remain partial or unavailable.
        </p>
        <form class="paper-form" onsubmit={(event) => { event.preventDefault(); void saveManualSummary(); }}>
          <fieldset disabled={!editing || saving}>
            <legend>Player totals</legend>
            <div class="paper-table-scroll">
              <table class="paper-player-table">
                <thead><tr><th>Player</th><th title={statHelp.pointsPlayed}>Points</th><th title={statHelp.hockeyAssists}>Hockey</th><th title={statHelp.assists}>Assists</th><th title={statHelp.goals}>Goals</th><th title={statHelp.blocks}>Ds</th></tr></thead>
                <tbody>
                  {#each manualPlayerDrafts as stats}
                    <tr>
                      <th>{playerName(stats.playerId)}</th>
                      <td><input bind:value={stats.pointsPlayed} type="number" min="0" max="9999" aria-label={`${playerName(stats.playerId)} points played`} /></td>
                      <td><input bind:value={stats.hockeyAssists} type="number" min="0" max="9999" aria-label={`${playerName(stats.playerId)} hockey assists`} /></td>
                      <td><input bind:value={stats.assists} type="number" min="0" max="9999" aria-label={`${playerName(stats.playerId)} assists`} /></td>
                      <td><input bind:value={stats.goals} type="number" min="0" max="9999" aria-label={`${playerName(stats.playerId)} goals`} /></td>
                      <td><input bind:value={stats.blocks} type="number" min="0" max="9999" aria-label={`${playerName(stats.playerId)} defenses`} /></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </fieldset>

          <fieldset disabled={!editing || saving}>
            <legend>Point summaries <small>Scores are after each point</small></legend>
            {#if manualPointDrafts.length === 0}
              <p class="paper-empty">No paper points entered.</p>
            {:else}
              <div class="paper-table-scroll">
                <table class="paper-point-table">
                  <thead><tr><th>#</th><th>Line</th><th title={statHelp.pointStart}>Start</th><th>Starting system</th><th title={statHelp.turnovers}>Our TOs</th><th title={statHelp.score}>Us</th><th title={statHelp.score}>Them</th><th>How we scored</th><th title={statHelp.goals}>Scorer</th><th></th></tr></thead>
                  <tbody>
                    {#each manualPointDrafts as point, index}
                      <tr>
                        <th>{index + 1}</th>
                        <td><select bind:value={point.lineId} aria-label={`Point ${index + 1} line`}>{#each snapshot.data.lines as line}<option value={line.id}>{line.name}</option>{/each}</select></td>
                        <td><select bind:value={point.startingPossession} aria-label={`Point ${index + 1} starting possession`}><option value="offense">O</option><option value="defense">D</option></select></td>
                        <td>
                          {#if point.startingPossession === 'offense'}
                            <select bind:value={point.offenseStrategyId} aria-label={`Point ${index + 1} starting offense`}><option value={0}>Not recorded</option>{#each snapshot.data.strategies.filter((strategy) => strategy.kind === 'offense') as strategy}<option value={strategy.id}>{strategy.name}{strategy.isDefault ? ' (default)' : ''}</option>{/each}</select>
                          {:else}
                            <select bind:value={point.defenseStrategyId} aria-label={`Point ${index + 1} starting defense`}><option value={0}>Not recorded</option>{#each snapshot.data.strategies.filter((strategy) => strategy.kind === 'defense') as strategy}<option value={strategy.id}>{strategy.name}{strategy.isDefault ? ' (default)' : ''}</option>{/each}</select>
                          {/if}
                        </td>
                        <td><input bind:value={point.ourTurnovers} type="number" min="0" max="99" aria-label={`Point ${index + 1} tracked-team turnovers`} /></td>
                        <td><input bind:value={point.ourScore} type="number" min="0" max="999" aria-label={`Point ${index + 1} team score`} /></td>
                        <td><input bind:value={point.opponentScore} type="number" min="0" max="999" aria-label={`Point ${index + 1} opponent score`} /></td>
                        <td><input bind:value={point.scoringMethod} type="text" maxlength="80" disabled={!manualPointIsOurGoal(index)} aria-label={`Point ${index + 1} scoring method`} /></td>
                        <td>
                          <select bind:value={point.scorerPlayerId} disabled={!manualPointIsOurGoal(index)} aria-label={`Point ${index + 1} scorer`}>
                            <option value="">Unknown</option>
                            {#each snapshot.data.players as player}<option value={player.id.toString()}>{player.name}</option>{/each}
                          </select>
                        </td>
                        <td><button class="paper-remove" type="button" aria-label={`Remove point ${index + 1}`} title="Remove point" onclick={() => removeManualPoint(index)}><Trash2 size={13} /></button></td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
            <button class="paper-add" type="button" disabled={snapshot.data.lines.length === 0} onclick={addManualPoint}><Plus size={14} />Add point</button>
            {#if snapshot.data.lines.length === 0}<small class="paper-line-warning">Add an event line before entering paper points.</small>{/if}
          </fieldset>

          {#if editing}
            <footer class="paper-actions">
              <button type="button" disabled={saving} onclick={() => resetManualDrafts()}><RotateCcw size={14} />Discard changes</button>
              <button class="save" type="submit" disabled={saving}><Save size={14} />{saving ? 'Saving…' : 'Save paper stats'}</button>
            </footer>
          {:else}
            <p class="paper-edit-note">Enter edit mode to import or change paper statistics.</p>
          {/if}
        </form>
      </section>
    {:else if activeTab === 'highlights'}
      <section class="highlight-view">
        <header>
          <div><h2>Highlights</h2><span>Video ranges kept separate from game statistics</span></div>
          <div class="highlight-header-actions">
            {#if highlightPlaylistActive}
              <button class="stop-playlist" type="button" onclick={() => stopHighlightPlaylist()}><Pause size={14} />Stop</button>
            {:else}
              <button type="button" disabled={snapshot.data.highlights.length === 0} onclick={() => void playAllHighlights()}><Play size={14} />Play all</button>
            {/if}
            {#if editing}<button type="button" onclick={openNewHighlight}><Plus size={14} />Add highlight</button>{/if}
          </div>
        </header>
        {#if snapshot.data.highlights.length === 0}
          <div class="highlight-empty"><strong>No highlights yet</strong><span>Pause after a cool play and add the previous few seconds.</span></div>
        {:else}
          <div class="highlight-list">
            {#each snapshot.data.highlights as highlight}
              <article class="highlight-row">
                <button class="highlight-main" type="button" onclick={() => seekHighlight(highlight)}>
                  <time>{formatTime(highlight.startTimeMs)}–{formatTime(highlight.endTimeMs)}</time>
                  <strong>{highlight.description}</strong>
                  <span>{highlightPlaylistActive && highlightPlaylistPosition === snapshot.data.highlights.indexOf(highlight) + 1 ? 'Now playing · ' : ''}{highlight.playerIds.length === 0 ? 'No player attribution' : highlight.playerIds.map((playerId) => playerName(playerId)).join(', ')}</span>
                </button>
                {#if editing}
                  <div class="timeline-actions">
                    <button type="button" onclick={() => openHighlightEditor(highlight)} title="Edit highlight"><Edit3 size={14} /></button>
                    <button type="button" onclick={() => void deleteHighlight(highlight)} title="Delete highlight"><Trash2 size={14} /></button>
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>

  {#if activeTab === 'record' && (pointScrubber || (draftMode === null && snapshot.data.points.length > 0))}
    <footer class="point-playback-controls">
      {#if editing && draftMode === null && snapshot.data.points.length > 0}
        <nav class="point-step-navigation" aria-label="Point navigation">
          <button type="button" disabled={!previousNavigationPoint} onclick={() => { if (previousNavigationPoint) seekToPoint(previousNavigationPoint); }}><ChevronLeft size={14} />Previous point</button>
          <span>{recordPoint ? `Point ${recordPoint.sequenceNumber}` : 'Between points'}</span>
          <button type="button" disabled={!nextNavigationPoint} onclick={() => { if (nextNavigationPoint) seekToPoint(nextNavigationPoint); }}>Next point<ChevronRight size={14} /></button>
        </nav>
      {/if}
      {#if !editing && snapshot.data.points.length > 0}
        <div class="auto-skip-settings">
          <label class="auto-skip-toggle"><input type="checkbox" bind:checked={autoSkipPointGaps} /><span>Auto-skip gaps</span></label>
          <label class:disabled={!autoSkipPointGaps} class="auto-skip-buffer">
            <span>Buffer</span>
            <input
              type="number"
              min="0"
              max="60"
              step="1"
              value={pointGapBufferSeconds}
              disabled={!autoSkipPointGaps}
              aria-label="Seconds to keep after a score and before the next pull"
              onchange={setPointGapBuffer}
            />
            <span>s each side</span>
          </label>
        </div>
      {/if}
      {#if pointScrubber}
        {@const scrubberValueMs = Math.min(
          pointScrubber.endTimeMs,
          Math.max(pointScrubber.startTimeMs, Math.round(playback.currentTime * 1000)),
        )}
        <section class="point-scrubber" aria-label={`Point ${pointScrubber.point.sequenceNumber} video position`}>
          <header>
            <strong>Point {pointScrubber.point.sequenceNumber}</strong>
            <span>{formatTime(scrubberValueMs - pointScrubber.startTimeMs)} / {formatTime(pointScrubber.endTimeMs - pointScrubber.startTimeMs)}</span>
          </header>
          <input
            type="range"
            min={pointScrubber.startTimeMs}
            max={Math.max(pointScrubber.startTimeMs + 1, pointScrubber.endTimeMs)}
            step="10"
            value={scrubberValueMs}
            aria-label={`Seek within point ${pointScrubber.point.sequenceNumber}`}
            oninput={scrubPoint}
          />
          <div><span>Pull</span><span>{pointScrubber.completed ? 'Score' : 'Recorded through'}</span></div>
        </section>
      {/if}
    </footer>
  {/if}
</aside>

{#if spatialDraft && spatialPopover}
  <section
    class="spatial-event-popover"
    style:left={`${spatialPopover.left}px`}
    style:top={`${spatialPopover.top}px`}
    aria-label="Spatial event details"
  >
    <header>
      <div>
        <small>Video-assisted recording</small>
        <strong>{spatialDraftStage === 'choose_action' ? 'What happened here?' : gameEventLabel(eventType)}</strong>
      </div>
      <button type="button" aria-label="Cancel spatial event" title="Cancel" onclick={() => closeDraft()}><X size={15} /></button>
    </header>

    {#if spatialDraftStage === 'choose_action'}
      <div class="spatial-action-menu">
        {#if snapshot.currentPointState?.possession === 'offense'}
          {#if snapshot.currentPointState.handlerPlayerId === null}
            <button type="button" onclick={() => chooseSpatialAction('possession_start')}>Start possession</button>
          {:else}
            <button type="button" onclick={() => chooseSpatialAction('completion')}>Completion</button>
            <button type="button" onclick={() => chooseSpatialAction('turnover')}>Turnover</button>
            <button type="button" onclick={() => chooseSpatialAction('goal')}>Goal</button>
          {/if}
        {:else}
          <button type="button" onclick={() => chooseSpatialAction('defended')}>Defended</button>
          <button type="button" disabled={saving} onclick={() => void saveSpatialOpponentTurnover()}>Opponent turnover (no D)</button>
          <button type="button" onclick={() => chooseSpatialAction('goal')}>Callahan</button>
        {/if}
      </div>
      <p>The marker is manual. Drag it on the video if the position needs adjustment.</p>
    {:else if spatialDraftStage === 'details'}
      {#if eventType === 'turnover'}
        <label class="spatial-field"><span>Reason</span><select bind:value={turnoverReason} disabled={saving}><option value="drop">Drop</option><option value="block">Block</option><option value="throwaway">Throwaway</option><option value="unknown">Unknown</option></select></label>
      {/if}

      <fieldset class="spatial-player-picker">
        <legend>{spatialRoleLabel(spatialAnnotations[spatialAnnotations.length - 1].role)}</legend>
        <div>
          {#if eventType === 'defended'}
            <button
              type="button"
              title="Record possession changing without awarding a player or line D"
              disabled={saving}
              onclick={() => void saveSpatialOpponentTurnover()}
            >No player D — opponent turnover</button>
          {/if}
          {#each snapshot.data.players.filter((player) => formActivePlayerIds().includes(player.id)) as player}
            <button
              class:selected={spatialClickedPlayerId() === player.id.toString()}
              type="button"
              title={player.name}
              disabled={saving}
              onclick={() => void selectSpatialClickedPlayer(player.id)}
            >{player.name}</button>
          {/each}
        </div>
      </fieldset>

      {#if mutationError}<p class="spatial-error" role="alert">{mutationError}</p>{/if}
      {#if saving}<p class="spatial-saving" role="status">Saving event…</p>{/if}

      {#if eventType === 'turnover' && !secondPlayerId}
        <footer>
          <button class="save" type="button" disabled={saving || !firstPlayerId} onclick={() => void saveEvent()}>{saving ? 'Saving…' : 'Receiver unknown'}</button>
        </footer>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .stats-panel { display:flex; flex-direction:column; width:100%; height:100%; min-width:0; min-height:0; color:#e9eee7; background:#181b17; border-left:1px solid #353934; }
  button, select, input { font:inherit; }
  button { cursor:pointer; }
  .score-header { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:7px; min-height:66px; padding:9px 14px; border-bottom:1px solid #353934; background:linear-gradient(180deg,#242721 0%,#1e211d 100%); }
  .score-team { display:grid; grid-template-columns:minmax(0,1fr) 42px; align-items:center; gap:10px; min-width:0; }
  .score-team span { overflow:hidden; color:#c9cec6; font-size:12px; font-weight:650; text-align:left; text-overflow:ellipsis; white-space:nowrap; }
  .score-team strong { display:grid; place-items:center; width:42px; height:42px; border:1px solid #4a5147; border-radius:6px; color:#fff; background:#151814; box-shadow:inset 0 1px 0 rgba(255,255,255,.04); font-size:27px; font-variant-numeric:tabular-nums; line-height:1; }
  .score-team:first-child strong { border-color:#426b4e; background:#17251b; }
  .score-team.opponent { grid-template-columns:42px minmax(0,1fr); }
  .score-team.opponent strong { grid-column:1; grid-row:1; }
  .score-team.opponent span { grid-column:2; grid-row:1; text-align:right; }
  .score-separator { color:#8b9288; font-size:18px; font-weight:700; }
  .lock-banner,.mutation-error { display:flex; align-items:center; gap:7px; padding:8px 10px; border-bottom:1px solid #6d5c2a; color:#f3d987; background:#332f20; font-size:11px; }
  .lock-banner.error,.mutation-error { border-color:#7c3b40; color:#ffb4b8; background:#352124; }
  .lock-banner span { flex:1; }
  .lock-banner button { border:0; color:#161914; background:#f3d987; border-radius:3px; font-size:11px; font-weight:750; }
  .panel-tabs { display:flex; border-bottom:1px solid #353934; background:#20231f; }
  .panel-tabs button { flex:1; min-height:36px; padding:0 3px; border:0; border-bottom:2px solid transparent; color:#979e94; background:transparent; font-size:10px; font-weight:680; }
  .panel-tabs button.active { border-bottom-color:#e3ae27; color:#fff; }
  .panel-tabs button:disabled { cursor:not-allowed; opacity:.35; }
  .panel-content { flex:1 1 auto; min-height:0; overflow:auto; }
  .point-playback-controls { flex:0 0 auto; border-top:1px solid #465047; background:#1b201c; box-shadow:0 -5px 16px rgba(0,0,0,.22); }
  .auto-skip-settings { display:flex; align-items:center; justify-content:space-between; gap:9px; padding:7px 11px; border-bottom:1px solid #343a34; color:#aeb7ac; background:#1d201c; font-size:9px; }
  .auto-skip-toggle,.auto-skip-buffer { display:flex; align-items:center; gap:5px; min-width:0; }
  .auto-skip-toggle { color:#d2d9d0; font-weight:700; }
  .auto-skip-toggle input { width:14px; height:14px; margin:0; accent-color:#1592ac; }
  .auto-skip-buffer input { width:42px; height:25px; padding:0 4px; border:1px solid #485149; border-radius:3px; color:#edf2ed; background:#282e29; font-size:9px; text-align:center; }
  .auto-skip-buffer.disabled { opacity:.4; }
  .point-scrubber { display:grid; gap:5px; padding:8px 12px 7px; background:#1d241f; }
  .point-scrubber header,.point-scrubber > div { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .point-scrubber header strong { color:#dce5dc; font-size:10px; }
  .point-scrubber header span { color:#aab7aa; font:9px ui-monospace,monospace; font-variant-numeric:tabular-nums; }
  .point-scrubber input { width:100%; height:14px; margin:0; accent-color:#43a36d; cursor:pointer; }
  .point-scrubber > div { color:#778177; font-size:8px; font-weight:650; text-transform:uppercase; }
  .record-view { min-height:100%; }
  .recorder-toolbar { display:flex; align-items:center; justify-content:space-between; padding:7px 10px; border-bottom:1px solid #30342e; color:#9fa69c; font-size:10px; }
  .recorder-toolbar span { display:flex; align-items:center; gap:5px; }
  .recorder-toolbar small { display:flex; align-items:center; gap:5px; color:#7f887e; font-size:8px; }
  .redo-icon { transform:scaleX(-1); }
  .live-dot { width:6px; height:6px; border-radius:50%; background:#54d683; }
  .point-step-navigation { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:7px; padding:7px 10px; border-bottom:1px solid #343a34; background:#1d201c; }
  .point-step-navigation > span { color:#929a90; font-size:9px; font-weight:750; text-align:center; }
  .point-step-navigation button { display:flex; align-items:center; justify-content:center; gap:4px; min-height:30px; padding:0 7px; border:1px solid #414740; border-radius:4px; color:#c4cbc1; background:#292d27; font-size:9px; font-weight:700; }
  .point-step-navigation button:last-child { justify-self:end; }
  .point-step-navigation button:first-child { justify-self:start; }
  .point-step-navigation button:disabled { cursor:not-allowed; opacity:.35; }
  .point-results-table-wrap { max-height:210px; overflow:auto; border-bottom:1px solid #353b35; }
  .point-results-table { width:100%; border-collapse:collapse; font-size:9px; font-variant-numeric:tabular-nums; }
  .point-results-table th,.point-results-table td { height:29px; padding:4px 7px; border-bottom:1px solid #2d322d; text-align:center; }
  .point-results-table thead th { position:sticky; top:0; z-index:1; max-width:90px; overflow:hidden; color:#858e84; background:#20241f; font-size:8px; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; }
  .point-results-table tbody th { padding:0; text-align:left; }
  .point-results-table tbody th button { width:100%; height:29px; padding:0 9px; border:0; color:#c5ccc2; background:transparent; font-size:9px; font-weight:750; text-align:left; }
  .point-results-table tbody tr:hover { background:#222722; }
  .point-results-table tbody tr.active { background:#332e1e; box-shadow:inset 3px 0 #d0a637; }
  .point-results-table td.scored { color:#f4dc8d; background:#34301e; box-shadow:inset 0 0 0 1px #635628; font-weight:850; }
  .point-results-table td.break-score { color:#ffb1b7; background:#3b2326; box-shadow:inset 0 0 0 1px #81434a; }
  .recent-events header button { display:flex; align-items:center; gap:4px; border:0; color:#b9c0b6; background:transparent; font-size:10px; }
  .recent-events header button:disabled { opacity:.4; }
  .point-empty { display:grid; place-items:center; align-content:center; gap:8px; min-height:245px; padding:24px; color:#8f968c; text-align:center; }
  .point-empty strong { color:#e9eee7; font-size:14px; }
  .point-empty span { max-width:300px; font-size:11px; line-height:1.45; }
  .point-empty button { display:flex; align-items:center; gap:6px; min-height:34px; margin-top:6px; padding:0 11px; border:1px solid #087f9b; border-radius:4px; color:#fff; background:#087f9b; font-size:12px; font-weight:700; }
  .point-empty button.score-sync { margin-top:0; border-color:#4b5148; color:#d9ded6; background:#292d27; }
  .point-empty button:disabled { cursor:not-allowed; opacity:.42; }
  .point-empty small { color:#e2bb64; font-size:10px; }
  .point-empty small a { margin-left:3px; color:#8ed8e7; }
  .starting-endzone { display:grid; place-items:center; gap:5px; margin:5px 0 2px; padding:9px 12px; border:1px solid #3b4039; border-radius:6px; background:#20231f; }
  .starting-endzone > span { color:#dce2d9; font-weight:650; }
  .starting-endzone > div { display:flex; gap:4px; }
  .point-empty .starting-endzone button { min-height:28px; margin:0; padding:0 9px; border-color:#4b5148; color:#cbd1c8; background:#292d27; font-size:11px; }
  .point-empty .starting-endzone button.active { border-color:#1592ac; color:#fff; background:#116f84; }
  .starting-endzone > small { color:#8f968c; }
  .point-status { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px; }
  .point-status > div { display:grid; gap:3px; }
  .point-status strong { font-size:14px; }
  .point-status div span { color:#92998f; font-size:10px; }
  .possession-badge { padding:4px 7px; border:1px solid #82535a; border-radius:10px; color:#ffb8be; background:#352427; font-size:9px; font-weight:800; text-transform:uppercase; }
  .possession-badge.offense { border-color:#34704b; color:#91e2aa; background:#203328; }
  .possession-badge.won { border-color:#8f762e; color:#f1d475; background:#39311d; }
  .strategy-status { display:flex; gap:5px; padding:0 12px 10px; }
  .strategy-status > span { display:flex; align-items:center; gap:5px; padding:3px 6px; border:1px solid #3e4d52; border-radius:9px; color:#c5d6da; background:#20292b; font-size:9px; }
  .strategy-status small { color:#78929a; font-size:7px; font-weight:800; text-transform:uppercase; }
  .active-lineup { display:flex; flex-wrap:wrap; gap:4px; padding:0 12px 12px; }
  .active-lineup > span { display:flex; align-items:center; gap:4px; padding:5px 7px; border:1px solid #3b4039; border-radius:3px; color:#bec5ba; background:#232621; font-size:10px; }
  .active-lineup > span.handler { border-color:#b88b19; color:#ffe092; }
  .active-lineup small { color:#e3ae27; font-size:8px; font-weight:800; text-transform:uppercase; }
  .completed-point-actions { display:flex; gap:6px; padding:0 12px 12px; }
  .completed-point-actions button { display:flex; align-items:center; gap:5px; min-height:31px; padding:0 8px; border:1px solid #4a5148; border-radius:4px; color:#cbd2c8; background:#292d27; font-size:9px; font-weight:700; }
  .completed-point-actions button:first-child { border-color:#087f9b; color:#fff; background:#087f9b; }
  .completed-point-actions button:disabled { cursor:not-allowed; opacity:.4; }
  .action-groups { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; padding:0 12px 10px; }
  .action-groups.four-actions { grid-template-columns:repeat(2,1fr); }
  .main-action { display:grid; place-items:center; gap:5px; min-height:64px; padding:7px 4px; border:1px solid #464b44; border-radius:5px; color:#edf1eb; background:#282c27; font-size:11px; font-weight:720; }
  .main-action > span { display:grid; place-items:center; width:20px; height:20px; border:1px solid #666d63; border-radius:3px; color:#aeb5ab; font-size:9px; }
  .main-action.possession { border-color:#376b85; background:#22333c; }
  .main-action.completion,.main-action.defended { border-color:#2f7652; background:#20382b; }
  .main-action.goal { border-color:#9a771f; background:#3b321e; }
  .main-action.turnover,.main-action.conceded { border-color:#74464b; background:#392629; }
  .main-action:disabled { cursor:not-allowed; opacity:.38; }
  .non-player-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; padding:0 12px 10px; }
  .non-player-actions button { min-height:33px; border:1px solid #62464a; border-radius:4px; color:#dfc7c9; background:#302426; font-size:9px; font-weight:680; }
  .non-player-actions button:disabled { cursor:not-allowed; opacity:.4; }
  .secondary-actions { display:grid; grid-template-columns:repeat(3,1fr); gap:1px; margin:0 12px 12px; border:1px solid #3b4039; }
  .secondary-actions button { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:5px; min-height:36px; padding:0 7px; border:0; border-left:1px solid #3b4039; color:#c4cac1; background:#222520; font-size:9px; text-align:left; }
  .secondary-actions button:first-child { border-left:0; }
  .secondary-actions button.resume { color:#8de2aa; }
  .strategy-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; margin:0 12px 12px; }
  .strategy-actions button { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:6px; min-height:34px; padding:5px 8px; border:1px solid #40535a; border-radius:4px; color:#d9e7ea; background:#222c2f; text-align:left; }
  .strategy-actions small { color:#829ba2; font-size:8px; text-transform:uppercase; }
  .strategy-actions strong { overflow:hidden; font-size:10px; text-overflow:ellipsis; white-space:nowrap; }
  kbd { padding:1px 3px; border:1px solid #50564d; border-radius:2px; color:#838a80; font:8px inherit; }
  .recent-events { border-top:1px solid #353934; }
  .point-events { margin-top:2px; }
  .recent-header-actions > span { color:#7f877d; font-size:9px; }
  .recent-events header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; }
  .recent-events h3 { margin:0; color:#dfe4dc; font-size:11px; }
  .recent-header-actions { display:flex; align-items:center; gap:8px; }
  .recent-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:stretch; width:100%; min-height:35px; border-top:1px solid #2c302b; background:transparent; }
  .recent-row:hover,.recent-row:focus-within { background:#222520; }
  .recent-row.latest { border-top-color:#776324; border-left:3px solid #d0a637; background:#2b281d; }
  .recent-row.latest:hover,.recent-row.latest:focus-within { background:#332e1e; }
  .recent-row-main { display:grid; grid-template-columns:42px 90px minmax(0,1fr); align-items:center; min-width:0; padding:4px 10px; border:0; color:#c3c9c0; background:transparent; text-align:left; }
  .recent-row-main time { color:#899087; font:9px ui-monospace,monospace; }
  .recent-row-main span { font-size:10px; }
  .recent-row-main small { overflow:hidden; color:#777f75; font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
  .recent-row.latest .recent-row-main { color:#fff4ce; }
  .recent-row.latest .recent-row-main time { color:#d8b74e; }
  .recent-row.latest .recent-row-main small { color:#b8ae8a; }
  .recent-undo { display:flex; align-items:center; align-self:center; gap:4px; min-height:26px; margin:4px 7px 4px 0; padding:0 7px; border:1px solid #806d32; border-radius:3px; color:#e1c76d; background:#3a321d; font-size:9px; font-weight:700; }
  .recent-undo:hover { border-color:#ae9133; background:#493d20; }
  .recent-undo:disabled { cursor:not-allowed; opacity:.4; }
  .quality-warnings { margin:10px 12px; padding:9px; border:1px solid #6d5c2a; border-radius:4px; color:#dfc777; background:#2e2a1e; }
  .quality-warnings header { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
  .quality-warnings header strong { flex:1; font-size:10px; }
  .quality-warnings header span { font-size:9px; }
  .quality-warnings p { margin:4px 0; color:#c9b878; font-size:9px; }
  .entry-form { display:grid; gap:13px; padding:13px; }
  .entry-form header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-bottom:9px; border-bottom:1px solid #353934; }
  .entry-form h2 { margin:0; font-size:14px; }
  .entry-form header button { display:grid; place-items:center; width:28px; height:28px; padding:0; border:0; color:#afb6ac; background:transparent; }
  .pull-instructions { margin:0; padding:9px 10px; border:1px solid #3d514f; border-radius:4px; color:#acd3d3; background:#202b2a; font-size:10px; line-height:1.45; }
  .entry-form label { display:grid; gap:5px; min-width:0; color:#afb6ac; font-size:10px; font-weight:680; }
  .entry-form input,.entry-form select,.entry-form textarea { width:100%; min-width:0; min-height:36px; padding:6px 7px; border:1px solid #4a5048; border-radius:4px; color:#f0f3ee; background:#252824; }
  .entry-form textarea { resize:vertical; }
  .two-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
  .quick-player-picker { min-width:0; margin:0; padding:0; border:0; }
  .quick-player-picker legend { display:flex; align-items:center; justify-content:space-between; width:100%; margin-bottom:5px; color:#afb6ac; font-size:10px; font-weight:680; }
  .quick-player-picker legend small { color:#788077; font-size:8px; font-weight:500; }
  .quick-player-picker > div { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:4px; }
  .quick-player-picker button { min-width:0; min-height:32px; padding:4px 6px; overflow:hidden; border:1px solid #424840; border-radius:4px; color:#aeb5ab; background:#252824; font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
  .quick-player-picker button:hover { border-color:#626a60; background:#2d312c; }
  .quick-player-picker button.selected { border-color:#31805a; color:#d7f1df; background:#203a2b; box-shadow:inset 0 0 0 1px #31805a; }
  .frame-position { display:grid; gap:5px; color:#afb6ac; font-size:10px; font-weight:680; }
  .frame-stepper { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:5px; }
  .frame-stepper button { display:flex; align-items:center; justify-content:center; gap:4px; min-height:34px; padding:0 7px; border:1px solid #4a5048; border-radius:4px; color:#d0d6cd; background:#30342e; font-size:9px; font-weight:680; }
  .frame-stepper button:hover { border-color:#687067; background:#373c35; }
  .highlight-boundary { display:grid; gap:6px; padding:8px; border:1px solid #3e4744; border-radius:4px; background:#202420; }
  .highlight-boundary > div:first-child { display:flex; align-items:center; justify-content:space-between; color:#9fa79d; font-size:9px; text-transform:uppercase; }
  .highlight-boundary > div:first-child strong { color:#e4ebe2; font:11px ui-monospace,monospace; }
  .highlight-boundary-actions { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:4px; }
  .highlight-boundary-actions button { min-height:28px; padding:0 3px; border:1px solid #485048; border-radius:3px; color:#c1c8be; background:#2b302a; font-size:8px; }
  .timeline-insertion { display:grid; gap:7px; padding:9px; border:1px solid #45514a; border-radius:5px; background:#202520; }
  .timeline-neighbor { display:grid; grid-template-columns:58px minmax(0,1fr); gap:2px 7px; min-width:0; padding:1px 3px; }
  .timeline-neighbor small { grid-row:1 / span 2; align-self:center; color:#858d83; font-size:8px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; }
  .timeline-neighbor strong,.timeline-neighbor span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .timeline-neighbor strong { color:#dce2d9; font-size:10px; }
  .timeline-neighbor span { color:#858d83; font-size:8px; }
  .timeline-neighbor.next { opacity:.7; }
  .timeline-insertion-marker { display:grid; grid-template-columns:minmax(12px,1fr) auto minmax(12px,1fr); align-items:center; gap:8px; color:#8ed8e7; }
  .timeline-insertion-marker span { height:2px; background:#087f9b; }
  .timeline-insertion-marker strong { font-size:9px; font-weight:800; text-transform:uppercase; }
  .timeline-end { color:#6f776d; font-size:8px; text-align:center; text-transform:uppercase; }
  .lineup-picker { min-width:0; margin:0; padding:0; border:0; }
  .lineup-picker legend { display:flex; justify-content:space-between; width:100%; margin-bottom:6px; color:#afb6ac; font-size:10px; font-weight:680; }
  .lineup-picker small { color:#7e867b; }
  .player-buttons { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px; }
  .player-buttons button { display:flex; align-items:center; gap:4px; min-height:31px; padding:4px 7px; overflow:hidden; border:1px solid #3e433d; border-radius:3px; color:#9ea59b; background:#222520; font-size:10px; text-align:left; text-overflow:ellipsis; white-space:nowrap; }
  .player-buttons button.line-member { border-left:3px solid #66827e; padding-left:5px; background:#252b27; }
  .player-buttons button.selected { border-color:#34704b; color:#cdebd6; background:#203328; }
  .player-buttons button.line-member.selected { border-left-color:#69b98a; }
  .player-buttons button > span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
  .player-buttons button > small { margin-left:auto; color:#9ca39a; font-size:8px; font-weight:800; }
  .player-buttons button > small.mmp { color:#72c6b5; }
  .player-buttons button > small.fmp { color:#ddb95f; }
  .player-buttons button > small.missing { color:#e2bb64; }
  .lineup-warning { display:flex; align-items:center; gap:5px; margin:7px 0 0; color:#e2bb64; font-size:9px; }
  .matchup-overrides { border:1px solid #3e433d; border-radius:4px; background:#20231f; }
  .matchup-overrides > summary { display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:7px; padding:8px; cursor:pointer; color:#aeb5ab; font-size:10px; list-style:none; }
  .matchup-overrides > summary::-webkit-details-marker { display:none; }
  .matchup-overrides > summary strong { color:#b1b8ae; font-size:9px; }
  .matchup-overrides > summary strong.mmp { color:#72c6b5; }
  .matchup-overrides > summary strong.fmp { color:#ddb95f; }
  .matchup-overrides > summary strong.unclassified { color:#e2bb64; }
  .matchup-overrides > summary small { color:#777f75; font-size:8px; }
  .matchup-overrides > div { display:grid; gap:5px; padding:0 8px 8px; }
  .matchup-overrides label { display:grid; grid-template-columns:minmax(0,1fr) 150px; align-items:center; gap:7px; }
  .matchup-overrides label select { min-height:30px; font-size:9px; }
  .check-field { display:flex!important; grid-template:none!important; align-items:center; flex-direction:row!important; gap:7px!important; min-height:32px; }
  .check-field input { width:auto; min-height:0; }
  .entry-form footer { display:flex; justify-content:flex-end; gap:7px; padding-top:8px; border-top:1px solid #353934; }
  .entry-form footer button { display:flex; align-items:center; gap:5px; min-height:34px; padding:0 10px; border:1px solid #4a5048; border-radius:4px; color:#d4dad1; background:#292d27; font-size:11px; font-weight:700; }
  .entry-form footer button.save { border-color:#087f9b; color:#fff; background:#087f9b; }
  .entry-form footer button:disabled { cursor:not-allowed; opacity:.45; }
  .paper-view > header { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:11px 12px; border-bottom:1px solid #353934; }
  .paper-view > header > div { display:grid; gap:3px; }
  .paper-view h2 { margin:0; color:#e2e7df; font-size:13px; }
  .paper-view header span { color:#858d82; font-size:9px; }
  .paper-view header > small { padding:2px 5px; border:1px solid #487558; border-radius:8px; color:#8de2aa; font-size:8px; font-weight:750; text-transform:uppercase; }
  .paper-coverage-note { margin:0; padding:9px 12px; border-bottom:1px solid #353934; color:#b7a96f; background:#29271d; font-size:9px; line-height:1.45; }
  .paper-form { display:grid; gap:14px; padding:12px; }
  .paper-form fieldset { display:grid; gap:8px; min-width:0; margin:0; padding:0; border:0; }
  .paper-form fieldset:disabled { opacity:.72; }
  .paper-form legend { margin-bottom:7px; color:#d7ddd4; font-size:10px; font-weight:720; }
  .paper-form legend small { margin-left:5px; color:#7f877c; font-size:8px; font-weight:500; }
  .paper-table-scroll { max-width:100%; overflow:auto; border:1px solid #343833; border-radius:4px; }
  .paper-form table { min-width:max-content; }
  .paper-form th:first-child { min-width:42px; }
  .paper-player-table th:first-child { min-width:130px; }
  .paper-form td { padding:3px; }
  .paper-form input,.paper-form select { min-width:0; height:28px; padding:3px 5px; border:1px solid #484e46; border-radius:3px; color:#edf1eb; background:#252824; font-size:9px; }
  .paper-form input[type='number'] { width:62px; text-align:right; }
  .paper-point-table select { width:92px; }
  .paper-point-table td:nth-child(4) input,.paper-point-table td:nth-child(8) input { width:130px; }
  .paper-point-table td:nth-child(9) select { width:120px; }
  .paper-form input:disabled,.paper-form select:disabled { color:#6f766d; background:#20231f; }
  .paper-empty { margin:0; padding:10px; color:#858d82; background:#20231f; font-size:9px; }
  .paper-add,.paper-actions button { display:inline-flex; align-items:center; justify-content:center; gap:5px; width:max-content; min-height:32px; padding:0 9px; border:1px solid #474d45; border-radius:4px; color:#d2d8cf; background:#292d27; font-size:10px; font-weight:680; }
  .paper-add:disabled,.paper-actions button:disabled { cursor:not-allowed; opacity:.45; }
  .paper-remove { display:grid; place-items:center; width:27px; height:27px; padding:0; border:1px solid #54413f; border-radius:3px; color:#dc8d91; background:#2c2322; }
  .paper-line-warning,.paper-edit-note { color:#d3b65f; font-size:9px; }
  .paper-edit-note { margin:0; }
  .paper-actions { display:flex; justify-content:flex-end; gap:7px; padding-top:4px; border-top:1px solid #353934; }
  .paper-actions button.save { border-color:#087f9b; color:#fff; background:#087f9b; }
  table { width:max-content; min-width:100%; border-collapse:collapse; font-size:9px; }
  th,td { height:31px; padding:4px 7px; border-bottom:1px solid #2d312c; text-align:right; white-space:nowrap; }
  thead th { position:sticky; top:0; color:#8f968c; background:#20231f; font-size:8px; text-transform:uppercase; }
  th:first-child { position:sticky; left:0; min-width:110px; color:#d7dcd5; background:#1d201c; text-align:left; }
  tbody tr:hover td,tbody tr:hover th { background:#252824; }
  .timeline-actions { display:flex; gap:3px; }
  .timeline-actions button { display:grid; place-items:center; width:27px; height:27px; padding:0; border:1px solid #42473f; border-radius:3px; color:#aeb5ab; background:#252824; }
  .highlight-view { min-height:100%; }
  .highlight-view > header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:11px 12px; border-bottom:1px solid #353934; }
  .highlight-view > header > div { display:grid; gap:3px; }
  .highlight-view h2 { margin:0; color:#e2e7df; font-size:13px; }
  .highlight-view header span { color:#858d82; font-size:9px; }
  .highlight-view header button { display:flex; align-items:center; gap:5px; min-height:30px; padding:0 8px; border:1px solid #087f9b; border-radius:4px; color:#fff; background:#087f9b; font-size:9px; font-weight:700; }
  .highlight-view header button:disabled { cursor:not-allowed; opacity:.4; }
  .highlight-header-actions { display:flex; align-items:center; gap:5px; }
  .highlight-view header button.stop-playlist { border-color:#8a4b50; background:#6d3439; }
  .spatial-event-popover { position:fixed; z-index:100; display:grid; gap:10px; width:320px; max-height:min(420px,calc(100vh - 24px)); padding:11px; overflow:auto; border:1px solid #5b6b68; border-radius:6px; color:#edf3ee; background:#1c211e; box-shadow:0 12px 34px rgba(0,0,0,.55); }
  .spatial-event-popover > header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-bottom:8px; border-bottom:1px solid #363d38; }
  .spatial-event-popover > header > div { display:grid; gap:2px; }
  .spatial-event-popover > header small { color:#6fc5d5; font-size:8px; font-weight:750; text-transform:uppercase; }
  .spatial-event-popover > header strong { font-size:13px; }
  .spatial-event-popover > header button { display:grid; place-items:center; width:26px; height:26px; padding:0; border:0; color:#aab3aa; background:transparent; }
  .spatial-event-popover > p { margin:0; color:#929b92; font-size:9px; line-height:1.45; }
  .spatial-action-menu { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
  .spatial-action-menu button { min-height:38px; padding:5px; border:1px solid #3d7255; border-radius:4px; color:#ddf2e3; background:#23382a; font-size:10px; font-weight:720; }
  .spatial-action-menu button:nth-child(3n) { border-color:#765054; color:#f2d9db; background:#382729; }
  .spatial-player-picker { min-width:0; margin:0; padding:0; border:0; }
  .spatial-player-picker legend,.spatial-field > span { margin-bottom:5px; color:#adb6ad; font-size:9px; font-weight:720; }
  .spatial-player-picker > div { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; max-height:126px; overflow:auto; }
  .spatial-player-picker button { min-width:0; min-height:30px; padding:4px; overflow:hidden; border:1px solid #414941; border-radius:3px; color:#b7c0b7; background:#282e29; font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
  .spatial-player-picker button.selected { border-color:#32916a; color:#e0f5e6; background:#21402f; box-shadow:inset 0 0 0 1px #32916a; }
  .spatial-field { display:grid; gap:4px; }
  .spatial-field select { min-height:32px; padding:4px 6px; border:1px solid #485149; border-radius:3px; color:#edf2ed; background:#282e29; }
  .spatial-event-popover footer { display:flex; justify-content:flex-end; gap:5px; padding-top:7px; border-top:1px solid #363d38; }
  .spatial-event-popover footer button { min-height:31px; padding:0 8px; border:1px solid #495149; border-radius:3px; color:#c6cec6; background:#292f2a; font-size:9px; font-weight:700; }
  .spatial-event-popover footer button.save { border-color:#087f9b; color:#fff; background:#087f9b; }
  .spatial-event-popover footer button:disabled { cursor:not-allowed; opacity:.42; }
  .spatial-error { margin:0; color:#ffb0b5; font-size:9px; }
  .spatial-saving { margin:0; color:#8ed7e4; font-size:9px; }
  .highlight-empty { display:grid; place-items:center; gap:5px; padding:40px 20px; color:#858d82; text-align:center; }
  .highlight-empty strong { color:#dce2d9; font-size:12px; }
  .highlight-empty span { font-size:9px; }
  .highlight-list { display:grid; }
  .highlight-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:7px; padding:7px 9px; border-bottom:1px solid #2d312c; }
  .highlight-main { display:grid; grid-template-columns:94px minmax(0,1fr); gap:3px 8px; min-width:0; padding:2px; border:0; color:#dce2d9; background:transparent; text-align:left; }
  .highlight-main time { grid-row:1 / span 2; color:#8ea4aa; font:8px ui-monospace,monospace; }
  .highlight-main strong,.highlight-main span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .highlight-main strong { font-size:10px; }
  .highlight-main span { color:#7f877d; font-size:8px; }
  @media (max-width:900px) { .stats-panel { border-top:1px solid #353934; border-left:0; } }
</style>
