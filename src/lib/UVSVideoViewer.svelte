<script lang="ts">
  import './uvs-video-viewer.css';
  import {
    AlertCircle,
    Braces,
    Camera,
    ChevronsLeft,
    ChevronsRight,
    EllipsisVertical,
    FileVideo,
    Gauge,
    Minus,
    Pause,
    Play,
    Plus,
    RotateCcw,
    Save,
    ScanSearch,
    Volume2,
    VolumeX,
    X,
  } from '@lucide/svelte';
  import { onDestroy, onMount } from 'svelte';
  import {
    detectionSamplesInFrameRange,
    detectionsAtFrame,
    frameIndexAtTime,
    parseMetadataJsonl,
    timeAtFrameIndex,
    type MetadataTimeline,
    type PanoramaExtent,
    type WebDetection,
  } from './metadata';
  import { PerspectiveRenderer } from './perspective-renderer';
  import {
    DEFAULT_AUTO_CAMERA_CONFIG,
    autoCameraTarget,
    autoCameraSubjectsForDetections,
    buildDetectionAreaHistoryTimeline,
    requiredAutoCameraFov,
    selectTrustedDetections,
    stepAutoCamera,
    type AutoCameraConfig,
    type AutoCameraPose,
    type AutoCameraVelocity,
    type DetectionAreaHistoryTimeline,
    type DetectionTrustState,
  } from './auto-camera';
  import { drawDetectionOverlay, type DetectionOverlayView } from './detection-overlay';
  import {
    DEFAULT_FOV_DEGREES,
    MAX_FOV_DEGREES,
    MIN_FOV_DEGREES,
    PERSPECTIVE_ASPECT,
    clampFov,
    clampPerspectiveCenter,
    panoramaDisplaySideCenterYaw,
    panoramaCenter,
    panoramaPointIsOnDisplaySide,
    projectPanoramaPoint,
    unprojectPerspectivePoint,
  } from './perspective';
  import { canvasPixelRatio } from './render-resolution';
  import type {
    GameViewerSettings,
    UVSVideoViewerSource,
    UVSViewerPlaybackMarker,
    UVSViewerPlaybackState,
    UVSViewerSpatialMarker,
    UVSViewerSpatialPoint,
    UVSViewerStatus,
    UVSViewerViewState,
  } from './viewer-types';
  import type { TeamEndzone } from './game-stats';

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 6;
  const MIN_TILT_DEGREES = -30;
  const MAX_TILT_DEGREES = 30;
  const MIN_ROLL_DEGREES = -15;
  const MAX_ROLL_DEGREES = 15;
  const LEVEL_ORIENTATION = { tilt: 0, roll: 0 };
  const NO_DETECTIONS: WebDetection[] = [];

  interface PerspectiveFrame {
    enabled: boolean;
    canvas: HTMLCanvasElement | undefined;
    video: HTMLVideoElement | undefined;
    metadata: MetadataTimeline | null;
    width: number;
    height: number;
    yaw: number;
    pitch: number;
    fovDegrees: number;
    cameraTilt: number;
    cameraRoll: number;
  }

  interface DetectionOverlayFrame {
    canvas: HTMLCanvasElement | undefined;
    video: HTMLVideoElement | undefined;
    detections: WebDetection[];
    metadata: MetadataTimeline | null;
    areaHistory: DetectionAreaHistoryTimeline | null;
    minimumAreaHistorySeconds: number;
    trustStateByDetection: Map<WebDetection, DetectionTrustState>;
    view: DetectionOverlayView;
  }

  /** Parent-owned video and metadata. Local file controls are disabled while set. */
  export let source: UVSVideoViewerSource | null = null;
  /** Allow this component to create local object URLs through its file controls. */
  export let allowLocalFiles = false;
  /** Compact product label shown in the viewer toolbar. */
  export let title = 'UVS Viewer';
  /** Persisted game-level camera and automatic panner configuration. */
  export let settings: GameViewerSettings | null = null;
  /** Playback callback for synchronizing game timelines and statistics. */
  export let onPlaybackChange: ((state: UVSViewerPlaybackState) => void) | undefined = undefined;
  /** Visible camera callback for embedding applications that persist operator state. */
  export let onViewChange: ((state: UVSViewerViewState) => void) | undefined = undefined;
  /** Readiness and diagnostics callback for application-level error handling. */
  export let onStatusChange: ((status: UVSViewerStatus) => void) | undefined = undefined;
  /** Settings callback used by administrative save controls. */
  export let onSettingsChange: ((settings: GameViewerSettings) => void) | undefined = undefined;
  /** Optional persistence action rendered beside the camera controls. */
  export let onSaveSettings: (() => void) | undefined = undefined;
  /** Restrict automatic framing to one video-side endzone; null uses the full field. */
  export let autoCameraEndzone: TeamEndzone | null = null;
  /** Media times where every visible detection becomes a trusted automatic-camera baseline. */
  export let trustedDetectionBaselineTimesMs: readonly number[] = [];
  /** Whether the next primary click should place a manual event annotation. */
  export let spatialPlacementActive = false;
  /** Draft manual annotations displayed on their selected video frames. */
  export let spatialMarkers: UVSViewerSpatialMarker[] = [];
  /** Saved action positions that may briefly pulse during ordinary playback. */
  export let playbackMarkers: UVSViewerPlaybackMarker[] = [];
  /** Callback fired when the operator manually marks a position on the video. */
  export let onSpatialPointPlace: ((point: UVSViewerSpatialPoint) => void) | undefined = undefined;
  /** Callback fired while an existing draft marker is dragged to a more precise position. */
  export let onSpatialPointAdjust:
    | ((index: number, point: UVSViewerSpatialPoint) => void)
    | undefined = undefined;

  let videoInput: HTMLInputElement;
  let metadataInput: HTMLInputElement;
  let rootElement: HTMLDivElement;
  let videoElement: HTMLVideoElement;
  let perspectiveCanvasElement: HTMLCanvasElement;
  let canvasElement: HTMLCanvasElement;
  let viewportElement: HTMLDivElement;
  let perspectiveRenderer: PerspectiveRenderer | null = null;
  let perspectiveRendererCanvas: HTMLCanvasElement | null = null;
  let queuedPerspectiveFrame: PerspectiveFrame | null = null;
  let queuedDetectionOverlayFrame: DetectionOverlayFrame | null = null;
  let visualVideoFrameRequest: number | null = null;
  let visualVideoFrameVideo: HTMLVideoElement | null = null;
  let visualAnimationRequest = 0;
  let lastDetectionOverlayDrawAt = 0;
  let detectionOverlayNeedsImmediateDraw = true;
  let appliedAutoCameraEndzone = autoCameraEndzone;

  let videoUrl = '';
  let ownedVideoUrl = '';
  let videoName = '';
  let metadataName = '';
  let timeline: MetadataTimeline | null = null;
  let loadError = '';
  let loadWarning = '';
  let dragActive = false;

  let viewportWidth = 0;
  let viewportHeight = 0;
  let sourceAspect = 16 / 9;
  let perspectiveAspect = PERSPECTIVE_ASPECT;
  let sceneWidth = 0;
  let sceneHeight = 0;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let perspectiveMode = false;
  let perspectiveYaw = 0;
  let perspectivePitch = 0;
  let perspectiveFov = DEFAULT_FOV_DEGREES;
  let defaultPerspectiveFov = DEFAULT_FOV_DEGREES;
  let rigOrientation = LEVEL_ORIENTATION;
  let defaultRigOrientation = LEVEL_ORIENTATION;
  let orientationControlsOpen = false;
  let detectionAreaHistoryTimeline: DetectionAreaHistoryTimeline | null = null;
  let detectionAreaHistorySource: MetadataTimeline | null = null;
  let detectionAreaHistoryDuration = -1;
  let detectionAreaHistoryBaselineKey = '';
  let detectionAreaHistoryTrustKey = '';
  let detectionAreaHistoryBuildTimer: ReturnType<typeof setTimeout> | null = null;
  let autoCameraEnabled = false;
  let autoCameraOnPlay = true;
  let autoControlsOpen = false;
  let autoCameraConfig: AutoCameraConfig = { ...DEFAULT_AUTO_CAMERA_CONFIG };
  let virtualAutoCameraPose: AutoCameraPose = {
    yaw: 0,
    pitch: 0,
    fovDegrees: DEFAULT_FOV_DEGREES,
  };
  let virtualAutoCameraVelocity: AutoCameraVelocity = {
    yaw: 0,
    pitch: 0,
    fovDegrees: 0,
  };
  let virtualAutoCameraInitialized = false;
  let lastAutoCameraTickAt = 0;

  let currentTime = 0;
  let duration = 0;
  let playing = false;
  let muted = false;
  let showDetections = false;
  let showPlaybackMarkers = false;
  let clockRequest = 0;
  let mounted = false;
  let appliedSource: UVSVideoViewerSource | null = null;
  let appliedSettings: GameViewerSettings | null = null;
  let externalSourceActive = false;
  let pendingInitialTime: number | null = null;

  let activePointer: number | null = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerStartPanX = 0;
  let pointerStartPanY = 0;
  let pointerStartYaw = 0;
  let pointerStartPitch = 0;
  let adjustingSpatialMarker: number | null = null;

  $: localFilesEnabled = allowLocalFiles && source === null;
  $: if (source !== appliedSource) {
    syncExternalSource(source);
  }
  $: if (settings !== appliedSettings) {
    applyGameViewerSettings(settings);
  }
  $: if (autoCameraEndzone !== appliedAutoCameraEndzone) {
    appliedAutoCameraEndzone = autoCameraEndzone;
    // Preserve motion when a point releases the lineup-endzone constraint.
    // Explicit seeks already invalidate the camera before changing timeline position.
    schedulePlaybackClock();
  }
  $: currentFrame = timeline
    ? frameIndexAtTime(currentTime, duration, timeline.lastFrameIndex)
    : 0;
  $: syncDetectionAreaHistory(
    timeline,
    duration,
    trustedDetectionBaselineTimesMs,
    autoCameraConfig.newAreaDelaySeconds,
    autoCameraConfig.trustHaloRadiusDegrees,
    autoCameraConfig.trustHaloTimeoutSeconds,
  );
  $: hasAutoCameraData =
    timeline?.detectionSamples.some((sample) =>
      sample.detections.some((detection) => detection.panorama !== null),
    ) ?? false;
  $: frameDetections = timeline ? detectionsAtFrame(timeline, currentFrame) : [];
  $: currentDetections = showDetections ? frameDetections : NO_DETECTIONS;
  $: currentTrustedDetections = selectTrustedDetections(
    detectionsInAutoCameraEndzone(
      frameDetections,
      timeline?.manifest.panorama_extent ?? null,
    ),
    detectionAreaHistoryTimeline,
    autoCameraConfig.newAreaDelaySeconds,
  );
  $: framingDetections = currentTrustedDetections.included;
  $: framingSubjects = autoCameraSubjectsForRegion(
    framingDetections,
    timeline?.manifest.panorama_extent ?? null,
  );
  $: pendingDetectionCount = [...currentTrustedDetections.stateByDetection.values()].filter(
    (state) => state === 'pending',
  ).length;
  $: mappedDetectionCount = frameDetections.filter((detection) => detection.panorama).length;
  $: perspectiveAspect =
    viewportWidth > 0 && viewportHeight > 0
      ? viewportWidth / viewportHeight
      : PERSPECTIVE_ASPECT;
  $: visiblePlaybackMarkers = showPlaybackMarkers
    ? playbackMarkers.flatMap((marker) => {
        const elapsedMs = currentTime * 1000 - marker.timeMs;
        if (elapsedMs < -100 || elapsedMs > 950) return [];
        const position = panoramaMarkerPosition(marker.panoramaYaw, marker.panoramaPitch);
        return position ? [{ ...marker, ...position }] : [];
      })
    : [];
  $: onPlaybackChange?.({
    currentTime,
    duration,
    playing,
    frameIndex: currentFrame,
  });
  $: onViewChange?.({
    perspectiveMode,
    autoCameraEnabled,
    showDetections,
    yaw: perspectiveYaw,
    pitch: perspectivePitch,
    fovDegrees: perspectiveFov,
  });
  $: onStatusChange?.({
    hasVideo: Boolean(videoUrl),
    hasMetadata: Boolean(timeline),
    ready: Boolean(videoUrl && timeline && duration > 0),
    videoName,
    metadataName,
    error: loadError,
    warning: loadWarning,
  });

  function syncDetectionAreaHistory(
    metadata: MetadataTimeline | null,
    videoDuration: number,
    baselineTimesMs: readonly number[],
    newAreaDelaySeconds: number,
    trustHaloRadiusDegrees: number,
    trustHaloTimeoutSeconds: number,
  ): void {
    const baselineTimesSeconds = baselineTimesMs
      .filter((timeMs) => Number.isFinite(timeMs) && timeMs >= 0)
      .map((timeMs) => timeMs / 1000)
      .sort((left, right) => left - right);
    const baselineKey = baselineTimesSeconds.join(',');
    const trustKey = [
      newAreaDelaySeconds,
      trustHaloRadiusDegrees,
      trustHaloTimeoutSeconds,
    ].join(',');
    if (
      metadata === detectionAreaHistorySource &&
      videoDuration === detectionAreaHistoryDuration &&
      baselineKey === detectionAreaHistoryBaselineKey &&
      trustKey === detectionAreaHistoryTrustKey
    ) {
      return;
    }

    const structuralChange =
      metadata !== detectionAreaHistorySource ||
      videoDuration !== detectionAreaHistoryDuration ||
      baselineKey !== detectionAreaHistoryBaselineKey;
    const rebuild = () => {
      detectionAreaHistoryBuildTimer = null;
      detectionAreaHistorySource = metadata;
      detectionAreaHistoryDuration = videoDuration;
      detectionAreaHistoryBaselineKey = baselineKey;
      detectionAreaHistoryTrustKey = trustKey;
      detectionAreaHistoryTimeline = metadata
        ? buildDetectionAreaHistoryTimeline(metadata, videoDuration, baselineTimesSeconds, {
            newAreaDelaySeconds,
            trustHaloRadiusDegrees,
            trustHaloTimeoutSeconds,
          })
        : null;
      schedulePlaybackClock();
    };

    if (detectionAreaHistoryBuildTimer !== null) {
      clearTimeout(detectionAreaHistoryBuildTimer);
      detectionAreaHistoryBuildTimer = null;
    }
    if (structuralChange || detectionAreaHistoryTimeline === null) {
      rebuild();
      return;
    }
    detectionAreaHistoryBuildTimer = setTimeout(rebuild, 180);
  }
  $: onSettingsChange?.({
    version: 1,
    rigTiltRadians: rigOrientation.tilt,
    rigRollRadians: rigOrientation.roll,
    fovDegrees: defaultPerspectiveFov,
    recordingMode: settings?.recordingMode ?? 'video_assisted',
    autoCamera: { ...autoCameraConfig },
  });

  $: {
    if (viewportWidth > 0 && viewportHeight > 0) {
      if (perspectiveMode) {
        sceneWidth = viewportWidth;
        sceneHeight = viewportHeight;
      } else if (sourceAspect > 0) {
        const fittedWidth = Math.min(viewportWidth, viewportHeight * sourceAspect);
        sceneWidth = fittedWidth;
        sceneHeight = fittedWidth / sourceAspect;
      }
    }
  }

  $: queueDetectionOverlayFrame({
    canvas: canvasElement,
    video: videoElement,
    detections: currentDetections,
    metadata: timeline,
    areaHistory: detectionAreaHistoryTimeline,
    minimumAreaHistorySeconds: autoCameraConfig.newAreaDelaySeconds,
    trustStateByDetection: currentTrustedDetections.stateByDetection,
    view: {
      width: sceneWidth,
      height: sceneHeight,
      zoom: perspectiveMode ? 1 : zoom,
      perspectiveMode,
      visibleCamera: {
        yaw: perspectiveYaw,
        pitch: perspectivePitch,
        fovDegrees: perspectiveFov,
        aspect: sceneWidth / sceneHeight,
        tilt: rigOrientation.tilt,
        roll: rigOrientation.roll,
      },
    },
  });
  $: queuePerspectiveFrame({
    enabled: perspectiveMode,
    canvas: perspectiveCanvasElement,
    video: videoElement,
    metadata: timeline,
    width: sceneWidth,
    height: sceneHeight,
    yaw: perspectiveYaw,
    pitch: perspectivePitch,
    fovDegrees: perspectiveFov,
    cameraTilt: rigOrientation.tilt,
    cameraRoll: rigOrientation.roll,
  });

  onMount(() => {
    mounted = true;
    syncExternalSource(source);
    scheduleQueuedVisualFrame();
    const observer = new ResizeObserver(([entry]) => {
      viewportWidth = entry.contentRect.width;
      viewportHeight = entry.contentRect.height;
      requestAnimationFrame(clampPan);
      schedulePlaybackClock();
    });
    observer.observe(viewportElement);
    window.addEventListener('keydown', handlePlaybackKeydown);

    return () => {
      mounted = false;
      observer.disconnect();
      window.removeEventListener('keydown', handlePlaybackKeydown);
    };
  });

  onDestroy(() => {
    if (detectionAreaHistoryBuildTimer !== null) {
      clearTimeout(detectionAreaHistoryBuildTimer);
    }
    if (clockRequest !== 0) {
      cancelAnimationFrame(clockRequest);
    }
    cancelQueuedVisualFrame();
    perspectiveRenderer?.dispose();
    releaseOwnedVideoUrl();
  });

  /** Start or resume playback. */
  export async function play(): Promise<void> {
    if (!videoElement) {
      return;
    }
    try {
      await videoElement.play();
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Playback could not start.';
    }
  }

  /** Pause playback without changing the current media time. */
  export function pause(): void {
    videoElement?.pause();
  }

  /** Seek playback and reset the virtual automatic camera at the new timeline position. */
  export function seekTo(timeSeconds: number): void {
    if (!videoElement || !Number.isFinite(timeSeconds)) {
      return;
    }
    const nextTime = Math.min(duration || Number.POSITIVE_INFINITY, Math.max(0, timeSeconds));
    pendingInitialTime = null;
    videoElement.currentTime = nextTime;
    currentTime = nextTime;
    invalidateVirtualAutoCamera();
    schedulePlaybackClock();
  }

  function skipBy(seconds: number): void {
    seekTo(currentTime + seconds);
  }

  /** Pause playback and seek by whole metadata frames. */
  export function stepFrames(frameDelta: number): void {
    if (
      !videoElement ||
      !timeline ||
      duration <= 0 ||
      !Number.isInteger(frameDelta) ||
      frameDelta === 0
    ) {
      return;
    }
    const targetFrame = Math.min(
      timeline.lastFrameIndex,
      Math.max(0, currentFrame + frameDelta),
    );
    if (targetFrame === currentFrame) {
      return;
    }
    pause();
    seekTo(timeAtFrameIndex(targetFrame, duration, timeline.lastFrameIndex));
  }

  /** Enable automatic camera output or return control to the operator. */
  export function setAutoCameraEnabled(enabled: boolean): void {
    setAutoCameraMode(enabled);
  }

  /** Return the latest playback snapshot synchronously. */
  export function getPlaybackState(): UVSViewerPlaybackState {
    return { currentTime, duration, playing, frameIndex: currentFrame };
  }

  function releaseOwnedVideoUrl(): void {
    if (ownedVideoUrl) {
      URL.revokeObjectURL(ownedVideoUrl);
      ownedVideoUrl = '';
    }
  }

  function applyMetadata(metadata: MetadataTimeline | null, name: string): void {
    timeline = metadata;
    metadataName = metadata ? name : '';
    showDetections = false;
    if (!metadata) {
      defaultPerspectiveFov = DEFAULT_FOV_DEGREES;
      defaultRigOrientation = LEVEL_ORIENTATION;
      rigOrientation = LEVEL_ORIENTATION;
      perspectiveMode = false;
      orientationControlsOpen = false;
      autoControlsOpen = false;
      autoCameraEnabled = false;
      resetVirtualAutoCamera(null);
      return;
    }

    sourceAspect = videoElement?.videoWidth
      ? videoElement.videoWidth / videoElement.videoHeight
      : metadata.manifest.video.width / metadata.manifest.video.height;
    defaultRigOrientation = {
      tilt: metadata.manifest.rig_orientation.tilt,
      roll: metadata.manifest.rig_orientation.roll,
    };
    rigOrientation = defaultRigOrientation;
    defaultPerspectiveFov = DEFAULT_FOV_DEGREES;
    perspectiveMode = Boolean(videoUrl);
    autoCameraEnabled = Boolean(videoUrl && metadataSupportsAutoCamera(metadata));
    resetPerspectiveView(metadata);
    resetVirtualAutoCamera(metadata);
  }

  function metadataSupportsAutoCamera(metadata: MetadataTimeline): boolean {
    return metadata.detectionSamples.some((sample) =>
      sample.detections.some((detection) => detection.panorama !== null),
    );
  }

  function syncExternalSource(nextSource: UVSVideoViewerSource | null): void {
    appliedSource = nextSource;
    if (!nextSource) {
      if (!externalSourceActive) {
        return;
      }
      externalSourceActive = false;
      videoElement?.pause();
      videoUrl = '';
      videoName = '';
      duration = 0;
      currentTime = 0;
      playing = false;
      pendingInitialTime = null;
      applyMetadata(null, '');
      resetAllViews();
      return;
    }

    externalSourceActive = true;
    releaseOwnedVideoUrl();
    videoElement?.pause();
    videoUrl = nextSource.videoUrl;
    videoName = nextSource.videoName ?? 'Panorama video';
    pendingInitialTime = Number.isFinite(nextSource.initialTime)
      ? Math.max(0, nextSource.initialTime ?? 0)
      : 0;
    currentTime = pendingInitialTime ?? 0;
    duration = 0;
    playing = false;
    loadError = '';
    loadWarning = '';
    const metadata = nextSource.metadata ?? null;
    applyMetadata(metadata, nextSource.metadataName ?? 'panorama metadata');
    appliedSettings = null;
    resetPanoramaView();
    if (!metadata) {
      resetPerspectiveView(null);
    }
    schedulePlaybackClock();
  }

  function applyGameViewerSettings(nextSettings: GameViewerSettings | null): void {
    appliedSettings = nextSettings;
    if (!nextSettings) {
      return;
    }
    defaultPerspectiveFov = clampFov(nextSettings.fovDegrees);
    perspectiveFov = defaultPerspectiveFov;
    rigOrientation = {
      tilt: Math.min(
        degreesToRadians(MAX_TILT_DEGREES),
        Math.max(degreesToRadians(MIN_TILT_DEGREES), nextSettings.rigTiltRadians),
      ),
      roll: Math.min(
        degreesToRadians(MAX_ROLL_DEGREES),
        Math.max(degreesToRadians(MIN_ROLL_DEGREES), nextSettings.rigRollRadians),
      ),
    };
    autoCameraConfig = { ...nextSettings.autoCamera };
    resetVirtualAutoCamera();
    schedulePlaybackClock();
  }

  function isVideoFile(file: File): boolean {
    return file.type.startsWith('video/') || /\.(mp4|mkv|mov|m4v|webm)$/iu.test(file.name);
  }

  function isMetadataFile(file: File): boolean {
    return /\.(metadata\.jsonl|jsonl|ndjson)$/iu.test(file.name);
  }

  function selectVideo(event: Event): void {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) {
      loadVideo(file);
    }
  }

  function selectMetadata(event: Event): void {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) {
      void loadMetadata(file);
    }
  }

  function loadVideo(file: File): void {
    if (!localFilesEnabled) {
      return;
    }
    if (!isVideoFile(file)) {
      loadError = `${file.name} is not a supported video file.`;
      return;
    }
    releaseOwnedVideoUrl();
    ownedVideoUrl = URL.createObjectURL(file);
    videoUrl = ownedVideoUrl;
    videoName = file.name;
    pendingInitialTime = 0;
    currentTime = 0;
    duration = 0;
    perspectiveMode = Boolean(timeline);
    autoCameraEnabled = Boolean(timeline && metadataSupportsAutoCamera(timeline));
    showDetections = false;
    loadError = '';
    loadWarning = '';
    resetAllViews();
    resetVirtualAutoCamera();
  }

  async function loadMetadata(file: File): Promise<void> {
    if (!localFilesEnabled) {
      return;
    }
    if (!isMetadataFile(file)) {
      loadError = `${file.name} is not a supported panorama metadata sidecar.`;
      return;
    }

    try {
      const parsed = parseMetadataJsonl(await file.text());
      applyMetadata(parsed, file.name);
      loadError = '';
      validateLoadedPair();
      schedulePlaybackClock();
    } catch (error) {
      applyMetadata(null, '');
      loadError = error instanceof Error ? error.message : 'Could not read the metadata file.';
    }
  }

  function handleDrop(event: DragEvent): void {
    if (!localFilesEnabled) {
      return;
    }
    event.preventDefault();
    dragActive = false;
    const files = [...(event.dataTransfer?.files ?? [])];
    const video = files.find(isVideoFile);
    const metadata = files.find(isMetadataFile);

    if (video) {
      loadVideo(video);
    }
    if (metadata) {
      void loadMetadata(metadata);
    }
    if (!video && !metadata) {
      loadError = 'No supported video or panorama metadata sidecar was dropped.';
    }
  }

  function videoLoaded(): void {
    sourceAspect = videoElement.videoWidth / videoElement.videoHeight;
    duration = Number.isFinite(videoElement.duration) ? videoElement.duration : 0;
    const initialTime = Math.min(duration, Math.max(0, pendingInitialTime ?? 0));
    if (initialTime > 0) {
      videoElement.currentTime = initialTime;
    }
    currentTime = initialTime || videoElement.currentTime;
    validateLoadedPair();
    resetAllViews();
    resetVirtualAutoCamera();
    schedulePlaybackClock();
    scheduleQueuedVisualFrame();
  }

  function videoDataLoaded(): void {
    if (pendingInitialTime === null) {
      currentTime = videoElement.currentTime;
      scheduleQueuedVisualFrame();
      return;
    }
    const initialTime = Math.min(duration, Math.max(0, pendingInitialTime));
    if (Math.abs(videoElement.currentTime - initialTime) > 0.01) {
      videoElement.currentTime = initialTime;
    }
    currentTime = initialTime;
    pendingInitialTime = null;
    scheduleQueuedVisualFrame();
  }

  function validateLoadedPair(): void {
    if (!timeline || !videoElement?.videoWidth || !videoElement.videoHeight) {
      loadWarning = '';
      return;
    }
    const expected = timeline.manifest.video;
    const dimensionsMatch =
      expected.width === videoElement.videoWidth && expected.height === videoElement.videoHeight;
    loadWarning = dimensionsMatch
      ? ''
      : `Metadata expects ${expected.width}x${expected.height}; video is ${videoElement.videoWidth}x${videoElement.videoHeight}.`;
  }

  async function togglePlayback(): Promise<void> {
    if (!videoElement) {
      if (localFilesEnabled) {
        videoInput?.click();
      }
      return;
    }
    if (videoElement.paused || videoElement.ended) {
      await play();
    } else {
      videoElement.pause();
    }
  }

  function playbackStarted(): void {
    if (autoCameraOnPlay && !autoCameraEnabled) {
      setAutoCameraMode(true);
    }
    playing = true;
    lastAutoCameraTickAt = performance.now();
    schedulePlaybackClock();
    scheduleQueuedVisualFrame();
  }

  function playbackStopped(): void {
    playing = false;
    currentTime = videoElement?.currentTime ?? currentTime;
    schedulePlaybackClock();
    cancelVisualVideoFrame();
    scheduleQueuedVisualFrame();
  }

  function schedulePlaybackClock(): void {
    if (!mounted) {
      return;
    }
    if (
      videoElement &&
      !videoElement.paused &&
      typeof videoElement.requestVideoFrameCallback === 'function'
    ) {
      scheduleQueuedVisualFrame();
      return;
    }
    if (clockRequest !== 0) {
      return;
    }
    lastAutoCameraTickAt = performance.now();
    clockRequest = requestAnimationFrame(updatePlaybackClock);
  }

  function updatePlaybackClock(timestamp: number): void {
    clockRequest = 0;
    if (!videoElement) {
      return;
    }
    if (
      !videoElement.paused &&
      typeof videoElement.requestVideoFrameCallback === 'function'
    ) {
      scheduleQueuedVisualFrame();
      return;
    }
    if (!videoElement.paused) {
      currentTime = videoElement.currentTime;
    }
    const cameraMoving = updateAutomaticCamera(timestamp);
    if (!videoElement.paused || cameraMoving) {
      clockRequest = requestAnimationFrame(updatePlaybackClock);
    } else {
      lastAutoCameraTickAt = 0;
    }
  }

  function seek(event: Event): void {
    seekTo(Number((event.currentTarget as HTMLInputElement).value));
  }

  function playbackSeeked(): void {
    currentTime = videoElement.currentTime;
    invalidateVirtualAutoCamera();
    schedulePlaybackClock();
    scheduleQueuedVisualFrame();
  }

  function toggleMute(): void {
    if (!videoElement) {
      return;
    }
    muted = !muted;
    videoElement.muted = muted;
  }

  function beginPan(event: PointerEvent): void {
    if (!videoUrl || event.button !== 0) {
      return;
    }
    if (spatialPlacementActive) {
      event.preventDefault();
      const point = spatialPointAtClient(event.clientX, event.clientY);
      if (point) onSpatialPointPlace?.(point);
      return;
    }
    if (perspectiveMode && autoCameraEnabled) {
      disableAutoCameraForManualControl();
    }
    activePointer = event.pointerId;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    pointerStartPanX = panX;
    pointerStartPanY = panY;
    pointerStartYaw = perspectiveYaw;
    pointerStartPitch = perspectivePitch;
    viewportElement.setPointerCapture(event.pointerId);
  }

  function movePan(event: PointerEvent): void {
    if (activePointer !== event.pointerId) {
      return;
    }
    if (perspectiveMode && timeline) {
      const radiansPerPixel =
        (perspectiveFov * Math.PI) / 180 / Math.max(1, sceneHeight);
      const center = clampPerspectiveCenter(
        pointerStartYaw + (event.clientX - pointerStartX) * radiansPerPixel,
        pointerStartPitch + (event.clientY - pointerStartY) * radiansPerPixel,
        timeline.manifest.panorama_extent,
      );
      perspectiveYaw = center.yaw;
      perspectivePitch = center.pitch;
      return;
    }
    panX = pointerStartPanX + event.clientX - pointerStartX;
    panY = pointerStartPanY + event.clientY - pointerStartY;
    clampPan();
  }

  function endPan(event: PointerEvent): void {
    if (activePointer === event.pointerId) {
      activePointer = null;
      viewportElement.releasePointerCapture(event.pointerId);
    }
  }

  function spatialPointAtClient(clientX: number, clientY: number): UVSViewerSpatialPoint | null {
    if (!timeline || !viewportElement) return null;
    const rect = viewportElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    let panorama: { yaw: number; pitch: number } | null;
    if (perspectiveMode) {
      panorama = unprojectPerspectivePoint(
        { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height },
        {
          yaw: perspectiveYaw,
          pitch: perspectivePitch,
          fovDegrees: perspectiveFov,
          aspect: perspectiveAspect,
          tilt: rigOrientation.tilt,
          roll: rigOrientation.roll,
        },
      );
    } else {
      const normalizedX = 0.5 +
        (clientX - rect.left - rect.width / 2 - panX) / Math.max(1, sceneWidth * zoom);
      const normalizedY = 0.5 +
        (clientY - rect.top - rect.height / 2 - panY) / Math.max(1, sceneHeight * zoom);
      if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) return null;
      const extent = timeline.manifest.panorama_extent;
      panorama = {
        yaw: extent.yaw_min + normalizedX * (extent.yaw_max - extent.yaw_min),
        pitch: extent.pitch_max - normalizedY * (extent.pitch_max - extent.pitch_min),
      };
    }
    if (!panorama) return null;
    return {
      timeMs: Math.round(currentTime * 1000),
      frameIndex: currentFrame,
      panoramaYaw: panorama.yaw,
      panoramaPitch: panorama.pitch,
      clientX,
      clientY,
    };
  }

  function spatialMarkerPosition(point: UVSViewerSpatialPoint): { x: number; y: number } | null {
    if (!timeline || point.frameIndex !== currentFrame) return null;
    return panoramaMarkerPosition(point.panoramaYaw, point.panoramaPitch);
  }

  function panoramaMarkerPosition(yaw: number, pitch: number): { x: number; y: number } | null {
    if (!timeline) return null;
    if (perspectiveMode) {
      const normalized = projectPanoramaPoint(
        { yaw, pitch },
        {
          yaw: perspectiveYaw,
          pitch: perspectivePitch,
          fovDegrees: perspectiveFov,
          aspect: perspectiveAspect,
          tilt: rigOrientation.tilt,
          roll: rigOrientation.roll,
        },
      );
      return normalized
        ? { x: normalized.x * viewportWidth, y: normalized.y * viewportHeight }
        : null;
    }
    const extent = timeline.manifest.panorama_extent;
    const yawSpan = extent.yaw_max - extent.yaw_min;
    const pitchSpan = extent.pitch_max - extent.pitch_min;
    if (yawSpan <= 0 || pitchSpan <= 0) return null;
    const normalizedX = (yaw - extent.yaw_min) / yawSpan;
    const normalizedY = (extent.pitch_max - pitch) / pitchSpan;
    return {
      x: viewportWidth / 2 + panX + (normalizedX - 0.5) * sceneWidth * zoom,
      y: viewportHeight / 2 + panY + (normalizedY - 0.5) * sceneHeight * zoom,
    };
  }

  function beginSpatialMarkerAdjust(event: PointerEvent, index: number): void {
    if (event.button !== 0 || !onSpatialPointAdjust) return;
    event.preventDefault();
    event.stopPropagation();
    adjustingSpatialMarker = index;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveSpatialMarker(event: PointerEvent, index: number): void {
    if (adjustingSpatialMarker !== index || !onSpatialPointAdjust) return;
    event.preventDefault();
    event.stopPropagation();
    const point = spatialPointAtClient(event.clientX, event.clientY);
    if (!point) return;
    const existing = spatialMarkers[index]?.point;
    onSpatialPointAdjust(index, existing
      ? { ...point, timeMs: existing.timeMs, frameIndex: existing.frameIndex }
      : point);
  }

  function endSpatialMarkerAdjust(event: PointerEvent, index: number): void {
    if (adjustingSpatialMarker !== index) return;
    event.preventDefault();
    event.stopPropagation();
    adjustingSpatialMarker = null;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: WheelEvent): void {
    if (!videoUrl) {
      return;
    }
    event.preventDefault();
    if (perspectiveMode) {
      changeFov(Math.exp(event.deltaY * 0.0015));
      return;
    }
    const factor = Math.exp(-event.deltaY * 0.0015);
    setZoom(zoom * factor, event.clientX, event.clientY);
  }

  function changeZoom(factor: number): void {
    const rect = viewportElement.getBoundingClientRect();
    setZoom(zoom * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function changeFov(factor: number): void {
    if (autoCameraEnabled) {
      disableAutoCameraForManualControl();
    }
    perspectiveFov = clampFov(perspectiveFov * factor);
    defaultPerspectiveFov = perspectiveFov;
  }

  function setFov(event: Event): void {
    if (autoCameraEnabled) {
      disableAutoCameraForManualControl();
    }
    perspectiveFov = clampFov(Number((event.currentTarget as HTMLInputElement).value));
    defaultPerspectiveFov = perspectiveFov;
  }

  function radiansToDegrees(value: number): number {
    return (value * 180) / Math.PI;
  }

  function degreesToRadians(value: number): number {
    return (value * Math.PI) / 180;
  }

  function formatDegrees(value: number): string {
    const degrees = radiansToDegrees(value);
    return `${Math.abs(degrees) < 0.05 ? '0.0' : degrees.toFixed(1)}°`;
  }

  function setRigTilt(event: Event): void {
    rigOrientation = {
      ...rigOrientation,
      tilt: degreesToRadians(Number((event.currentTarget as HTMLInputElement).value)),
    };
    schedulePlaybackClock();
  }

  function setRigRoll(event: Event): void {
    rigOrientation = {
      ...rigOrientation,
      roll: degreesToRadians(Number((event.currentTarget as HTMLInputElement).value)),
    };
    schedulePlaybackClock();
  }

  function resetRigOrientation(): void {
    rigOrientation = defaultRigOrientation;
    schedulePlaybackClock();
  }

  function setAutoCameraMode(enabled: boolean): void {
    const nextEnabled = enabled && Boolean(videoUrl && timeline && hasAutoCameraData);
    if (!nextEnabled) {
      autoCameraEnabled = false;
      schedulePlaybackClock();
      return;
    }
    setPerspectiveMode(true);
    updateAutomaticCamera(performance.now());
    autoCameraEnabled = true;
    snapVisibleCameraToAutoCamera();
    schedulePlaybackClock();
  }

  function setAutoCameraSetting(key: keyof AutoCameraConfig, event: Event): void {
    autoCameraConfig = {
      ...autoCameraConfig,
      [key]: Number((event.currentTarget as HTMLInputElement).value),
    };
    schedulePlaybackClock();
  }

  function resetAutoCameraSettings(): void {
    autoCameraConfig = { ...DEFAULT_AUTO_CAMERA_CONFIG };
    schedulePlaybackClock();
  }

  function disableAutoCameraForManualControl(): void {
    autoCameraEnabled = false;
    schedulePlaybackClock();
  }

  function resetVirtualAutoCameraVelocity(): void {
    virtualAutoCameraVelocity = { yaw: 0, pitch: 0, fovDegrees: 0 };
  }

  function invalidateVirtualAutoCamera(): void {
    virtualAutoCameraInitialized = false;
    resetVirtualAutoCameraVelocity();
    lastAutoCameraTickAt = 0;
  }

  function detectionsInAutoCameraEndzone(
    detections: WebDetection[],
    extent: PanoramaExtent | null,
  ): WebDetection[] {
    if (!autoCameraEndzone || !extent) return detections;
    return detections.filter((detection) => {
      if (!detection.panorama) return false;
      return panoramaPointIsOnDisplaySide(detection.panorama, extent, autoCameraEndzone);
    });
  }

  function autoCameraSubjectsForRegion(
    detections: WebDetection[],
    extent: PanoramaExtent | null,
  ) {
    const subjects = autoCameraSubjectsForDetections(detections);
    if (!autoCameraEndzone || !extent || subjects.length > 0) return subjects;
    const point = {
      yaw: panoramaDisplaySideCenterYaw(extent, autoCameraEndzone),
      pitch: (extent.pitch_min + extent.pitch_max) / 2,
    };
    subjects.push({ observedPoint: point, predictedPoint: point, detection: null });
    return subjects;
  }

  function resetVirtualAutoCamera(metadata: MetadataTimeline | null = timeline): void {
    const center = metadata
      ? panoramaCenter(metadata.manifest.panorama_extent)
      : { yaw: 0, pitch: 0 };
    virtualAutoCameraPose = {
      ...center,
      fovDegrees: DEFAULT_FOV_DEGREES,
    };
    invalidateVirtualAutoCamera();
  }

  function snapVisibleCameraToAutoCamera(): void {
    perspectiveYaw = virtualAutoCameraPose.yaw;
    perspectivePitch = virtualAutoCameraPose.pitch;
    perspectiveFov = virtualAutoCameraPose.fovDegrees;
  }

  function updateAutomaticCamera(timestamp: number): boolean {
    if (
      !timeline ||
      (!hasAutoCameraData && !autoCameraEndzone) ||
      duration <= 0 ||
      !Number.isFinite(perspectiveAspect) ||
      perspectiveAspect <= 0
    ) {
      return false;
    }
    const mediaTime = videoElement?.currentTime ?? currentTime;
    const mediaFrame = frameIndexAtTime(mediaTime, duration, timeline.lastFrameIndex);
    const detections = detectionsAtFrame(timeline, mediaFrame);
    const lookAheadTime = Math.min(
      duration,
      mediaTime + Math.max(0, autoCameraConfig.lookAheadSeconds),
    );
    const lookAheadFrame = frameIndexAtTime(
      lookAheadTime,
      duration,
      timeline.lastFrameIndex,
    );
    const currentSelection = selectTrustedDetections(
      detectionsInAutoCameraEndzone(detections, timeline.manifest.panorama_extent),
      detectionAreaHistoryTimeline,
      autoCameraConfig.newAreaDelaySeconds,
    );
    const subjects = autoCameraSubjectsForDetections(currentSelection.included);
    for (const sample of detectionSamplesInFrameRange(timeline, mediaFrame, lookAheadFrame)) {
      const futureSelection = selectTrustedDetections(
        detectionsInAutoCameraEndzone(
          sample.detections,
          timeline.manifest.panorama_extent,
        ),
        detectionAreaHistoryTimeline,
        autoCameraConfig.newAreaDelaySeconds,
      );
      subjects.push(...autoCameraSubjectsForDetections(futureSelection.included));
    }
    if (subjects.length === 0) {
      subjects.push(...autoCameraSubjectsForRegion([], timeline.manifest.panorama_extent));
    }
    const target = autoCameraTarget(
      subjects,
      timeline.manifest.panorama_extent,
      perspectiveAspect,
      rigOrientation.tilt,
      rigOrientation.roll,
      autoCameraConfig.minimumFovDegrees,
      autoCameraConfig.framePaddingPercent,
    );
    if (!target) {
      resetVirtualAutoCameraVelocity();
      lastAutoCameraTickAt = timestamp;
      return false;
    }

    if (!virtualAutoCameraInitialized) {
      virtualAutoCameraPose = target;
      virtualAutoCameraInitialized = true;
      resetVirtualAutoCameraVelocity();
      lastAutoCameraTickAt = timestamp;
      if (autoCameraEnabled) {
        snapVisibleCameraToAutoCamera();
      }
      return false;
    }

    const elapsedSeconds =
      lastAutoCameraTickAt > 0 ? (timestamp - lastAutoCameraTickAt) / 1000 : 0;
    lastAutoCameraTickAt = timestamp;
    const liveRequiredFov = requiredAutoCameraFov(
      subjects,
      virtualAutoCameraPose,
      perspectiveAspect,
      rigOrientation.tilt,
      rigOrientation.roll,
      autoCameraConfig.minimumFovDegrees,
      autoCameraConfig.framePaddingPercent,
    );
    const transitionTarget = {
      ...target,
      fovDegrees: Math.max(target.fovDegrees, liveRequiredFov),
    };
    const next = stepAutoCamera(
      virtualAutoCameraPose,
      transitionTarget,
      virtualAutoCameraVelocity,
      elapsedSeconds,
      autoCameraConfig,
      timeline.manifest.panorama_extent,
    );
    virtualAutoCameraVelocity = next.velocity;
    virtualAutoCameraPose = next.pose;
    if (autoCameraEnabled) {
      snapVisibleCameraToAutoCamera();
    }

    return (
      Math.hypot(target.yaw - next.pose.yaw, target.pitch - next.pose.pitch) > 1e-4 ||
      Math.abs(transitionTarget.fovDegrees - next.pose.fovDegrees) > 0.05 ||
      Math.hypot(next.velocity.yaw, next.velocity.pitch) > 1e-4 ||
      Math.abs(next.velocity.fovDegrees) > 0.05
    );
  }

  function setZoom(nextZoom: number, clientX: number, clientY: number): void {
    const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    if (clampedZoom === zoom) {
      return;
    }

    const rect = viewportElement.getBoundingClientRect();
    const cursorX = clientX - rect.left - rect.width / 2;
    const cursorY = clientY - rect.top - rect.height / 2;
    const ratio = clampedZoom / zoom;
    panX = cursorX - (cursorX - panX) * ratio;
    panY = cursorY - (cursorY - panY) * ratio;
    zoom = clampedZoom;
    clampPan();
  }

  function clampPan(): void {
    const maxX = Math.max(0, (sceneWidth * zoom - viewportWidth) / 2);
    const maxY = Math.max(0, (sceneHeight * zoom - viewportHeight) / 2);
    panX = Math.min(maxX, Math.max(-maxX, panX));
    panY = Math.min(maxY, Math.max(-maxY, panY));
  }

  function resetPanoramaView(): void {
    zoom = 1;
    panX = 0;
    panY = 0;
  }

  function resetPerspectiveView(metadata: MetadataTimeline | null = timeline): void {
    perspectiveFov = defaultPerspectiveFov;
    if (metadata) {
      const center = panoramaCenter(metadata.manifest.panorama_extent);
      perspectiveYaw = center.yaw;
      perspectivePitch = center.pitch;
    } else {
      perspectiveYaw = 0;
      perspectivePitch = 0;
    }
  }

  function resetAllViews(): void {
    resetPanoramaView();
    resetPerspectiveView();
  }

  function resetView(): void {
    if (autoCameraEnabled) {
      disableAutoCameraForManualControl();
    }
    if (perspectiveMode) {
      resetPerspectiveView();
    } else {
      resetPanoramaView();
    }
  }

  function setPerspectiveMode(enabled: boolean): void {
    perspectiveMode = enabled && Boolean(videoUrl && timeline);
    if (!perspectiveMode) {
      orientationControlsOpen = false;
      autoControlsOpen = false;
      autoCameraEnabled = false;
    }
    activePointer = null;
  }

  function handleKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, button')) {
      return;
    }
    if (event.key === '+' || event.key === '=') {
      if (perspectiveMode) {
        changeFov(0.8);
      } else {
        changeZoom(1.25);
      }
    } else if (event.key === '-') {
      if (perspectiveMode) {
        changeFov(1.25);
      } else {
        changeZoom(0.8);
      }
    } else if (event.key === '0') {
      resetView();
    }
  }

  function handlePlaybackKeydown(event: KeyboardEvent): void {
    if (
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      !videoElement ||
      !videoUrl
    ) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.matches('input, select, textarea') ||
      target?.isContentEditable ||
      target?.closest('[contenteditable="true"]')
    ) return;

    const key = event.key.toLowerCase();
    if (event.code === 'Space') {
      event.preventDefault();
      pause();
    } else if (key === 'a') {
      event.preventDefault();
      skipBy(-1);
    } else if (key === 'd') {
      event.preventDefault();
      skipBy(1);
    }
  }

  function focusViewer(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('button, input, label')) {
      rootElement.focus({ preventScroll: true });
    }
  }

  function queuePerspectiveFrame(frame: PerspectiveFrame): void {
    queuedPerspectiveFrame = frame;
    scheduleQueuedVisualFrame();
  }

  function queueDetectionOverlayFrame(frame: DetectionOverlayFrame): void {
    const previous = queuedDetectionOverlayFrame;
    if (
      !previous ||
      previous.canvas !== frame.canvas ||
      previous.detections !== frame.detections ||
      previous.metadata !== frame.metadata ||
      previous.minimumAreaHistorySeconds !== frame.minimumAreaHistorySeconds ||
      previous.view.width !== frame.view.width ||
      previous.view.height !== frame.view.height ||
      previous.view.zoom !== frame.view.zoom ||
      previous.view.perspectiveMode !== frame.view.perspectiveMode ||
      previous.view.visibleCamera.yaw !== frame.view.visibleCamera.yaw ||
      previous.view.visibleCamera.pitch !== frame.view.visibleCamera.pitch ||
      previous.view.visibleCamera.fovDegrees !== frame.view.visibleCamera.fovDegrees ||
      previous.view.visibleCamera.tilt !== frame.view.visibleCamera.tilt ||
      previous.view.visibleCamera.roll !== frame.view.visibleCamera.roll
    ) {
      detectionOverlayNeedsImmediateDraw = true;
    }
    queuedDetectionOverlayFrame = frame;
    scheduleQueuedVisualFrame();
  }

  function queuedVisualVideo(): HTMLVideoElement | null {
    const perspective = queuedPerspectiveFrame;
    if (
      perspective?.enabled &&
      perspective.canvas &&
      perspective.video &&
      perspective.metadata &&
      perspective.width > 0 &&
      perspective.height > 0
    ) {
      return perspective.video;
    }
    const overlay = queuedDetectionOverlayFrame;
    return overlay?.canvas &&
      overlay.video &&
      overlay.view.width > 0 &&
      overlay.view.height > 0
      ? overlay.video
      : null;
  }

  function scheduleQueuedVisualFrame(): void {
    const video = queuedVisualVideo();
    if (!mounted || !video) {
      cancelQueuedVisualFrame();
      return;
    }

    if (!video.paused && typeof video.requestVideoFrameCallback === 'function') {
      if (visualVideoFrameRequest !== null && visualVideoFrameVideo === video) {
        return;
      }
      cancelVisualVideoFrame();
      if (visualAnimationRequest !== 0) {
        cancelAnimationFrame(visualAnimationRequest);
        visualAnimationRequest = 0;
      }
      visualVideoFrameVideo = video;
      visualVideoFrameRequest = video.requestVideoFrameCallback((timestamp) => {
        visualVideoFrameRequest = null;
        visualVideoFrameVideo = null;
        if (!video.paused) {
          currentTime = video.currentTime;
          updateAutomaticCamera(timestamp);
        }
        renderQueuedPerspectiveFrame();
        drawQueuedDetectionOverlayFrame(timestamp);
        scheduleQueuedVisualFrame();
      });
      return;
    }

    cancelVisualVideoFrame();
    if (visualAnimationRequest === 0) {
      visualAnimationRequest = requestAnimationFrame(() => {
        visualAnimationRequest = 0;
        renderQueuedPerspectiveFrame();
        drawQueuedDetectionOverlayFrame(performance.now(), true);
        const queuedVideo = queuedVisualVideo();
        if (queuedVideo && !queuedVideo.paused) {
          scheduleQueuedVisualFrame();
        }
      });
    }
  }

  function cancelVisualVideoFrame(): void {
    if (visualVideoFrameRequest !== null && visualVideoFrameVideo) {
      visualVideoFrameVideo.cancelVideoFrameCallback(visualVideoFrameRequest);
    }
    visualVideoFrameRequest = null;
    visualVideoFrameVideo = null;
  }

  function cancelQueuedVisualFrame(): void {
    cancelVisualVideoFrame();
    if (visualAnimationRequest !== 0) {
      cancelAnimationFrame(visualAnimationRequest);
      visualAnimationRequest = 0;
    }
  }

  function drawQueuedDetectionOverlayFrame(timestamp: number, force = false): void {
    const frame = queuedDetectionOverlayFrame;
    if (!frame?.canvas || frame.view.width <= 0 || frame.view.height <= 0) {
      return;
    }
    if (
      !force &&
      !detectionOverlayNeedsImmediateDraw &&
      timestamp - lastDetectionOverlayDrawAt < 100
    ) {
      return;
    }
    drawDetectionOverlay(
      frame.canvas,
      frame.detections,
      frame.metadata,
      frame.areaHistory,
      frame.minimumAreaHistorySeconds,
      frame.trustStateByDetection,
      frame.view,
    );
    lastDetectionOverlayDrawAt = timestamp;
    detectionOverlayNeedsImmediateDraw = false;
  }

  function renderQueuedPerspectiveFrame(): void {
    const frame = queuedPerspectiveFrame;
    if (
      !frame?.enabled ||
      !frame.canvas ||
      !frame.video ||
      !frame.metadata ||
      frame.width <= 0 ||
      frame.height <= 0
    ) {
      return;
    }

    try {
      if (!perspectiveRenderer || perspectiveRendererCanvas !== frame.canvas) {
        perspectiveRenderer?.dispose();
        perspectiveRenderer = new PerspectiveRenderer(frame.canvas);
        perspectiveRendererCanvas = frame.canvas;
      }
      perspectiveRenderer.render(frame.video, {
        width: frame.width,
        height: frame.height,
        pixelRatio: canvasPixelRatio(
          frame.width,
          frame.height,
          window.devicePixelRatio || 1,
        ),
        yaw: frame.yaw,
        pitch: frame.pitch,
        fovDegrees: frame.fovDegrees,
        tilt: frame.cameraTilt,
        roll: frame.cameraRoll,
        extent: frame.metadata.manifest.panorama_extent,
      });
    } catch (error) {
      perspectiveRenderer?.dispose();
      perspectiveRenderer = null;
      perspectiveRendererCanvas = null;
      perspectiveMode = false;
      loadError = `Perspective rendering failed: ${error instanceof Error ? error.message : 'unknown WebGL error'}`;
    }
  }

  function formatTime(value: number): string {
    if (!Number.isFinite(value) || value < 0) {
      return '0:00';
    }
    const wholeSeconds = Math.floor(value);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const seconds = wholeSeconds % 60;
    return hours > 0
      ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      : `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (focus scopes shortcuts to this viewer) -->
<div
  bind:this={rootElement}
  class="uvs-video-viewer"
  role="region"
  aria-label={`${title} video viewer`}
  tabindex="-1"
  onkeydown={handleKeydown}
  onpointerdown={focusViewer}
>
  {#if localFilesEnabled}
  <header class="topbar">
    <div class="file-actions">
      <label class="command" title="Open panorama video">
        <FileVideo size={17} aria-hidden="true" />
        <span>{videoName || 'Open video'}</span>
        <input
          bind:this={videoInput}
          class="visually-hidden"
          type="file"
          accept="video/*,.mp4,.mkv,.mov,.m4v,.webm"
          onchange={selectVideo}
        />
      </label>
      <label class="command" title="Open panorama metadata sidecar">
        <Braces size={17} aria-hidden="true" />
        <span>{metadataName || 'Open metadata'}</span>
        <input
          bind:this={metadataInput}
          class="visually-hidden"
          type="file"
          accept=".metadata.jsonl,.jsonl,.ndjson,application/x-ndjson,application/json"
          onchange={selectMetadata}
        />
      </label>
    </div>
  </header>
  {/if}

  {#if loadError || loadWarning}
    <div class:error-banner={loadError} class:warning-banner={!loadError && loadWarning} role="status">
      <AlertCircle size={16} aria-hidden="true" />
      <span>{loadError || loadWarning}</span>
    </div>
  {/if}

  <main
    class:drag-active={dragActive}
    ondragenter={(event) => {
      if (!localFilesEnabled) return;
      event.preventDefault();
      dragActive = true;
    }}
    ondragover={(event) => {
      if (localFilesEnabled) event.preventDefault();
    }}
    ondragleave={(event) => {
      if (event.currentTarget === event.target) dragActive = false;
    }}
    ondrop={handleDrop}
  >
    <div
      bind:this={viewportElement}
      class="viewport"
      class:panning={activePointer !== null}
      class:spatial-placement={spatialPlacementActive}
      role="region"
      aria-label="Panorama video viewport"
      onpointerdown={beginPan}
      onpointermove={movePan}
      onpointerup={endPan}
      onpointercancel={endPan}
      onwheel={handleWheel}
      ondblclick={resetView}
    >
      {#if videoUrl}
        <div
          class="scene-anchor"
          style:transform={`translate(-50%, -50%) translate(${perspectiveMode ? 0 : panX}px, ${perspectiveMode ? 0 : panY}px)`}
        >
          <div
            class="scene"
            style:width={`${sceneWidth}px`}
            style:height={`${sceneHeight}px`}
            style:transform={`scale(${perspectiveMode ? 1 : zoom})`}
          >
            <!-- svelte-ignore a11y_media_has_caption (local footage has no caption source) -->
            <video
              bind:this={videoElement}
              class:source-hidden={perspectiveMode}
              src={videoUrl}
              preload="metadata"
              playsinline
              aria-label={videoName}
              onloadedmetadata={videoLoaded}
              onloadeddata={videoDataLoaded}
              onplay={playbackStarted}
              onpause={playbackStopped}
              onended={playbackStopped}
              onseeked={playbackSeeked}
            ></video>
            <canvas
              bind:this={perspectiveCanvasElement}
              class="perspective-frame"
              class:visible={perspectiveMode}
              aria-hidden="true"
            ></canvas>
            <canvas bind:this={canvasElement} class="detection-overlay" aria-hidden="true"></canvas>
          </div>
        </div>
      {:else}
        <div class="empty-state">
          <FileVideo size={38} strokeWidth={1.5} aria-hidden="true" />
          <span>No panorama loaded</span>
          {#if localFilesEnabled}
            <div class="empty-actions">
              <button class="command" type="button" onclick={() => videoInput.click()}>
                <FileVideo size={17} aria-hidden="true" />
                Open video
              </button>
              <button class="command" type="button" onclick={() => metadataInput.click()}>
                <Braces size={17} aria-hidden="true" />
                Open metadata
              </button>
            </div>
          {/if}
        </div>
      {/if}

      {#each visiblePlaybackMarkers as marker (marker.id)}
        <div
          class="playback-action-marker"
          class:possession={marker.tone === 'possession'}
          class:completion={marker.tone === 'completion'}
          class:turnover={marker.tone === 'turnover'}
          class:goal={marker.tone === 'goal'}
          class:defense={marker.tone === 'defense'}
          style:left={`${marker.x}px`}
          style:top={`${marker.y}px`}
          aria-hidden="true"
        >
          <span><i></i></span>
          <small><strong>{marker.label}</strong>{marker.detail}</small>
        </div>
      {/each}

      {#each spatialMarkers as marker, index}
        {@const markerPosition = spatialMarkerPosition(marker.point)}
        {#if markerPosition}
          <button
            class="spatial-marker"
            class:adjusting={adjustingSpatialMarker === index}
            type="button"
            style:left={`${markerPosition.x}px`}
            style:top={`${markerPosition.y}px`}
            aria-label={`Move ${marker.label} position`}
            title={`Drag to adjust ${marker.label}`}
            onpointerdown={(event) => beginSpatialMarkerAdjust(event, index)}
            onpointermove={(event) => moveSpatialMarker(event, index)}
            onpointerup={(event) => endSpatialMarkerAdjust(event, index)}
            onpointercancel={(event) => endSpatialMarkerAdjust(event, index)}
          ><span aria-hidden="true">•</span><small>{marker.label}</small></button>
        {/if}
      {/each}

      {#if spatialPlacementActive}
        <div class="spatial-placement-prompt"><kbd>S</kbd><span>Click the player’s position</span><small>Esc cancels</small></div>
      {/if}

      {#if dragActive}
        <div class="drop-target">Drop files</div>
      {/if}
    </div>

    {#if perspectiveMode && orientationControlsOpen}
      <section class="orientation-panel" aria-label="Camera orientation controls">
        <div class="orientation-header">
          <span>Camera orientation</span>
          <button
            class="icon-button compact"
            type="button"
            aria-label="Close camera orientation controls"
            title="Close"
            onclick={() => (orientationControlsOpen = false)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div class="orientation-control">
          <span class="control-label">Tilt</span>
          <input
            type="range"
            min={MIN_TILT_DEGREES}
            max={MAX_TILT_DEGREES}
            step="0.1"
            value={radiansToDegrees(rigOrientation.tilt)}
            aria-label="Camera tilt"
            oninput={setRigTilt}
          />
          <output>{formatDegrees(rigOrientation.tilt)}</output>
        </div>

        <div class="orientation-control">
          <span class="control-label">Roll</span>
          <input
            type="range"
            min={MIN_ROLL_DEGREES}
            max={MAX_ROLL_DEGREES}
            step="0.1"
            value={radiansToDegrees(rigOrientation.roll)}
            aria-label="Camera roll"
            oninput={setRigRoll}
          />
          <output>{formatDegrees(rigOrientation.roll)}</output>
        </div>

        <button
          class="orientation-reset"
          type="button"
          disabled={Math.abs(rigOrientation.tilt - defaultRigOrientation.tilt) < 1e-8 &&
            Math.abs(rigOrientation.roll - defaultRigOrientation.roll) < 1e-8}
          onclick={resetRigOrientation}
        >
          <RotateCcw size={15} aria-hidden="true" />
          Reset to export
        </button>
      </section>
    {/if}

    {#if perspectiveMode && autoControlsOpen}
      <section class="auto-camera-panel" aria-label="Automatic camera controls">
        <div class="orientation-header">
          <span class="panel-title">
            <ScanSearch size={16} aria-hidden="true" />
            Automatic camera
          </span>
          <div class="panel-actions">
            <button
              class="icon-button compact"
              type="button"
              aria-label="Reset automatic camera settings"
              title="Reset automatic camera settings"
              onclick={resetAutoCameraSettings}
            >
              <RotateCcw size={15} aria-hidden="true" />
            </button>
            <button
              class="icon-button compact"
              type="button"
              aria-label="Close automatic camera controls"
              title="Close"
              onclick={() => (autoControlsOpen = false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="auto-camera-status">
          <span class:active={autoCameraEnabled}></span>
          <strong>{framingDetections.length} / {mappedDetectionCount}</strong>
          <span>detections trusted</span>
          <span class="waiting-count">
            {pendingDetectionCount} pending
          </span>
        </div>

        <div class="detection-box-legend" aria-label="Detection box colors">
          <span><i class="included" aria-hidden="true"></i>Trusted</span>
          <span><i class="pending" aria-hidden="true"></i>Pending</span>
          <span><i class="excluded" aria-hidden="true"></i>Filtered</span>
        </div>

        <div class="auto-control">
          <span class="control-label">New area delay</span>
          <input
            type="range"
            min="0"
            max="10"
            step="0.5"
            value={autoCameraConfig.newAreaDelaySeconds}
            aria-label="New detection area delay"
            oninput={(event) => setAutoCameraSetting('newAreaDelaySeconds', event)}
          />
          <output>
            {autoCameraConfig.newAreaDelaySeconds.toFixed(1)}s
          </output>
        </div>

        <div class="auto-control">
          <span class="control-label">Halo size</span>
          <input
            type="range"
            min="4"
            max="30"
            step="1"
            value={autoCameraConfig.trustHaloRadiusDegrees}
            aria-label="Trusted detection halo size"
            oninput={(event) => setAutoCameraSetting('trustHaloRadiusDegrees', event)}
          />
          <output>{Math.round(autoCameraConfig.trustHaloRadiusDegrees)}°</output>
        </div>

        <div class="auto-control">
          <span class="control-label">Halo memory</span>
          <input
            type="range"
            min="0.5"
            max="5"
            step="0.25"
            value={autoCameraConfig.trustHaloTimeoutSeconds}
            aria-label="Trusted detection halo memory"
            oninput={(event) => setAutoCameraSetting('trustHaloTimeoutSeconds', event)}
          />
          <output>{autoCameraConfig.trustHaloTimeoutSeconds.toFixed(2)}s</output>
        </div>

        <div class="auto-control">
          <span class="control-label">Look ahead</span>
          <input
            type="range"
            min="0"
            max="3"
            step="0.1"
            value={autoCameraConfig.lookAheadSeconds}
            aria-label="Automatic camera look ahead"
            oninput={(event) => setAutoCameraSetting('lookAheadSeconds', event)}
          />
          <output>{autoCameraConfig.lookAheadSeconds.toFixed(1)}s</output>
        </div>

        <div class="auto-control">
          <span class="control-label">Smooth time</span>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={autoCameraConfig.smoothingSeconds}
            aria-label="Automatic camera smoothing time"
            oninput={(event) => setAutoCameraSetting('smoothingSeconds', event)}
          />
          <output>{autoCameraConfig.smoothingSeconds.toFixed(1)}s</output>
        </div>

        <div class="auto-control">
          <span class="control-label">Max speed</span>
          <input
            type="range"
            min="10"
            max="180"
            step="5"
            value={autoCameraConfig.maxPanSpeedDegrees}
            aria-label="Maximum automatic camera pan speed"
            oninput={(event) => setAutoCameraSetting('maxPanSpeedDegrees', event)}
          />
          <output>{Math.round(autoCameraConfig.maxPanSpeedDegrees)}°/s</output>
        </div>

        <div class="auto-control">
          <span class="control-label">Pan accel</span>
          <input
            type="range"
            min="5"
            max="180"
            step="5"
            value={autoCameraConfig.maxPanAccelerationDegrees}
            aria-label="Maximum automatic camera pan acceleration"
            oninput={(event) => setAutoCameraSetting('maxPanAccelerationDegrees', event)}
          />
          <output>
            {Math.round(autoCameraConfig.maxPanAccelerationDegrees)}°/s²
          </output>
        </div>

        <div class="auto-control">
          <span class="control-label">Zoom accel</span>
          <input
            type="range"
            min="2"
            max="120"
            step="1"
            value={autoCameraConfig.maxZoomAccelerationDegrees}
            aria-label="Maximum automatic camera zoom acceleration"
            oninput={(event) => setAutoCameraSetting('maxZoomAccelerationDegrees', event)}
          />
          <output>
            {Math.round(autoCameraConfig.maxZoomAccelerationDegrees)}°/s²
          </output>
        </div>

        <div class="auto-control">
          <span class="control-label">Frame padding</span>
          <input
            type="range"
            min="0"
            max="25"
            step="1"
            value={autoCameraConfig.framePaddingPercent}
            aria-label="Automatic camera frame padding"
            oninput={(event) => setAutoCameraSetting('framePaddingPercent', event)}
          />
          <output>
            {Math.round(autoCameraConfig.framePaddingPercent)}%
          </output>
        </div>

        <div class="auto-control">
          <span class="control-label">Minimum FOV</span>
          <input
            type="range"
            min="20"
            max="90"
            step="1"
            value={autoCameraConfig.minimumFovDegrees}
            aria-label="Minimum automatic camera field of view"
            oninput={(event) => setAutoCameraSetting('minimumFovDegrees', event)}
          />
          <output>{Math.round(autoCameraConfig.minimumFovDegrees)}°</output>
        </div>
      </section>
    {/if}
  </main>

  <footer class="transport">
    <button
      class="icon-button primary"
      type="button"
      aria-label={playing ? 'Pause' : 'Play'}
      title={playing ? 'Pause' : 'Play'}
      onclick={() => void togglePlayback()}
    >
      {#if playing}
        <Pause size={18} fill="currentColor" aria-hidden="true" />
      {:else}
        <Play size={18} fill="currentColor" aria-hidden="true" />
      {/if}
    </button>

    <button
      class="icon-button"
      type="button"
      aria-label={muted ? 'Unmute' : 'Mute'}
      title={muted ? 'Unmute' : 'Mute'}
      disabled={!videoUrl}
      onclick={toggleMute}
    >
      {#if muted}
        <VolumeX size={18} aria-hidden="true" />
      {:else}
        <Volume2 size={18} aria-hidden="true" />
      {/if}
    </button>

    <button
      class="icon-button compact"
      type="button"
      aria-label="Back 5 seconds"
      title="Back 5 seconds"
      disabled={!videoUrl || duration <= 0}
      onclick={() => skipBy(-5)}
    >
      <ChevronsLeft size={17} aria-hidden="true" />
    </button>

    <button
      class="icon-button compact"
      type="button"
      aria-label="Forward 5 seconds"
      title="Forward 5 seconds"
      disabled={!videoUrl || duration <= 0}
      onclick={() => skipBy(5)}
    >
      <ChevronsRight size={17} aria-hidden="true" />
    </button>

    <span class="timecode">{formatTime(currentTime)}</span>
    <input
      class="timeline"
      type="range"
      min="0"
      max={duration || 0}
      step="0.01"
      value={currentTime}
      disabled={!videoUrl || duration <= 0}
      aria-label="Seek video"
      oninput={seek}
    />
    <span class="timecode duration">{formatTime(duration)}</span>

    <div class="transport-divider"></div>

    <div class="auto-camera-transport-controls" aria-label="Automatic camera playback controls">
      <button
        class="icon-button"
        class:active={autoCameraEnabled}
        type="button"
        aria-label={autoCameraEnabled ? 'Turn off automatic camera' : 'Turn on automatic camera'}
        aria-pressed={autoCameraEnabled}
        title={autoCameraEnabled ? 'Turn off automatic camera' : 'Turn on automatic camera'}
        disabled={!hasAutoCameraData || !videoUrl}
        onclick={() => setAutoCameraMode(!autoCameraEnabled)}
      >
        <ScanSearch size={17} aria-hidden="true" />
      </button>

      <button
        class="icon-button auto-camera-on-play"
        class:active={autoCameraOnPlay}
        type="button"
        aria-label={autoCameraOnPlay ? 'Disable AutoCam on play' : 'Enable AutoCam on play'}
        aria-pressed={autoCameraOnPlay}
        title={autoCameraOnPlay
          ? 'AutoCam will turn on when playback resumes'
          : 'AutoCam will stay off when playback resumes'}
        disabled={!hasAutoCameraData || !videoUrl}
        onclick={() => (autoCameraOnPlay = !autoCameraOnPlay)}
      >
        <ScanSearch size={16} aria-hidden="true" />
        <Play class="auto-camera-on-play-badge" size={9} fill="currentColor" aria-hidden="true" />
      </button>
    </div>

    <details class="view-options">
      <summary class="icon-button" aria-label="View options" title="View options">
        <EllipsisVertical size={18} aria-hidden="true" />
      </summary>
      <div class="view-options-menu">
        <label
          class="switch"
          class:disabled={!timeline || !videoUrl}
          title="Render a rectilinear 16:9 camera view"
        >
          <input
            type="checkbox"
            checked={perspectiveMode}
            disabled={!timeline || !videoUrl}
            onchange={(event) => setPerspectiveMode(event.currentTarget.checked)}
          />
          <span>Undistort</span>
        </label>
        <label class="switch" class:disabled={!timeline}>
          <input type="checkbox" bind:checked={showDetections} disabled={!timeline} />
          <span>Detections</span>
        </label>
        <label class="switch" class:disabled={playbackMarkers.length === 0} title="Flash saved action positions during playback">
          <input type="checkbox" bind:checked={showPlaybackMarkers} disabled={playbackMarkers.length === 0} />
          <span>Action markers</span>
        </label>
      </div>
    </details>

    {#if perspectiveMode}
      <div class="fov-controls" aria-label="Field of view controls">
        <span class="control-label">FOV</span>
        <input
          class="fov-slider"
          type="range"
          min={MIN_FOV_DEGREES}
          max={MAX_FOV_DEGREES}
          step="1"
          value={perspectiveFov}
          aria-label="Vertical field of view"
          oninput={setFov}
        />
        <output>{Math.round(perspectiveFov)}°</output>
        <button
          class="icon-button"
          class:active={autoControlsOpen}
          type="button"
          aria-label="Automatic camera settings"
          aria-expanded={autoControlsOpen}
          title="Automatic camera settings"
          onclick={() => {
            autoControlsOpen = !autoControlsOpen;
            if (autoControlsOpen) orientationControlsOpen = false;
          }}
        >
          <Gauge size={17} aria-hidden="true" />
        </button>
        <button
          class="icon-button"
          class:active={orientationControlsOpen}
          type="button"
          aria-label="Camera tilt and roll"
          aria-expanded={orientationControlsOpen}
          title="Camera tilt and roll"
          onclick={() => {
            orientationControlsOpen = !orientationControlsOpen;
            if (orientationControlsOpen) autoControlsOpen = false;
          }}
        >
          <Camera size={17} aria-hidden="true" />
        </button>
        {#if onSaveSettings}
          <button
            class="icon-button"
            type="button"
            aria-label="Save viewer settings"
            title="Save viewer settings"
            onclick={onSaveSettings}
          >
            <Save size={17} aria-hidden="true" />
          </button>
        {/if}
      </div>
    {:else}
      <div class="zoom-controls" aria-label="Zoom controls">
        <button
          class="icon-button"
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={!videoUrl || zoom <= MIN_ZOOM}
          onclick={() => changeZoom(0.8)}
        >
          <Minus size={18} aria-hidden="true" />
        </button>
        <span class="zoom-value">{Math.round(zoom * 100)}%</span>
        <button
          class="icon-button"
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={!videoUrl || zoom >= MAX_ZOOM}
          onclick={() => changeZoom(1.25)}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
        <button
          class="icon-button"
          type="button"
          aria-label="Reset view"
          title="Reset view"
          disabled={!videoUrl || (zoom === 1 && panX === 0 && panY === 0)}
          onclick={resetView}
        >
          <RotateCcw size={17} aria-hidden="true" />
        </button>
      </div>
    {/if}
  </footer>
</div>
