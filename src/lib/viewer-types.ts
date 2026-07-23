import type { MetadataTimeline } from './metadata';
import type { GameViewerSettings } from './game-settings';

/** One keyboard command displayed in the viewer's shortcut reference. */
export interface UVSViewerKeyboardShortcut {
  key: string;
  description: string;
}

/** A manual selection on a specific video frame, expressed in stable panorama coordinates. */
export interface UVSViewerSpatialPoint {
  timeMs: number;
  frameIndex: number;
  panoramaYaw: number;
  panoramaPitch: number;
  clientX: number;
  clientY: number;
}

/** A draft spatial point rendered over the video while composing an event. */
export interface UVSViewerSpatialMarker {
  label: string;
  point: UVSViewerSpatialPoint;
}

/** A saved event position that can briefly pulse during ordinary playback. */
export interface UVSViewerPlaybackMarker {
  id: string;
  label: string;
  detail: string;
  tone: 'possession' | 'completion' | 'turnover' | 'goal' | 'defense' | 'neutral';
  timeMs: number;
  frameIndex: number;
  panoramaYaw: number;
  panoramaPitch: number;
}

/** Video and metadata selected by an application that embeds the viewer. */
export interface UVSVideoViewerSource {
  /** Stable URL for the panorama video. The embedding application owns its lifetime. */
  videoUrl: string;
  /** Parsed panorama metadata for the video, when available. */
  metadata?: MetadataTimeline | null;
  /** User-facing video label. */
  videoName?: string;
  /** User-facing metadata label. */
  metadataName?: string;
  /** Initial media time in seconds, applied after the video loads. */
  initialTime?: number;
}

/** Playback state emitted for synchronization with game statistics and timelines. */
export interface UVSViewerPlaybackState {
  /** Current media time in seconds. */
  currentTime: number;
  /** Loaded media duration in seconds. */
  duration: number;
  /** Whether the video is currently playing. */
  playing: boolean;
  /** Metadata frame nearest to the current media time. */
  frameIndex: number;
}

/** Visible camera state emitted when the operator changes the view. */
export interface UVSViewerViewState {
  /** Whether the rectilinear panorama projection is active. */
  perspectiveMode: boolean;
  /** Whether the virtual automatic camera controls the visible view. */
  autoCameraEnabled: boolean;
  /** Whether detection boxes are visible. */
  showDetections: boolean;
  /** Camera yaw in panorama radians. */
  yaw: number;
  /** Camera pitch in panorama radians. */
  pitch: number;
  /** Vertical field of view in degrees. */
  fovDegrees: number;
}

/** Source readiness and load diagnostics emitted by the viewer. */
export interface UVSViewerStatus {
  /** Whether a video URL is loaded. */
  hasVideo: boolean;
  /** Whether parsed panorama metadata is loaded. */
  hasMetadata: boolean;
  /** Whether both sources and video duration are available. */
  ready: boolean;
  /** Current user-facing video label. */
  videoName: string;
  /** Current user-facing metadata label. */
  metadataName: string;
  /** Blocking viewer error, or an empty string. */
  error: string;
  /** Non-blocking source warning, or an empty string. */
  warning: string;
}

export type { GameViewerSettings };
