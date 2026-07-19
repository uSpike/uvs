import {
  DEFAULT_AUTO_CAMERA_CONFIG,
  type AutoCameraConfig,
} from './auto-camera';
import type { MetadataTimeline } from './metadata';
import {
  DEFAULT_FOV_DEGREES,
  MAX_FOV_DEGREES,
  MIN_FOV_DEGREES,
} from './perspective';

const MAX_TILT_RADIANS = (30 * Math.PI) / 180;
const MAX_ROLL_RADIANS = (15 * Math.PI) / 180;

/** Persisted camera configuration for one game. */
export interface GameViewerSettings {
  /** Settings schema version. */
  version: 1;
  /** Rig tilt in radians. */
  rigTiltRadians: number;
  /** Rig roll in radians. */
  rigRollRadians: number;
  /** Initial vertical field of view in degrees. */
  fovDegrees: number;
  /** Automatic camera tuning. */
  autoCamera: AutoCameraConfig;
}

/** Build game defaults from exported calibration, or level defaults without video metadata. */
export function defaultGameViewerSettings(metadata: MetadataTimeline | null): GameViewerSettings {
  return {
    version: 1,
    rigTiltRadians: metadata?.manifest.rig_orientation.tilt ?? 0,
    rigRollRadians: metadata?.manifest.rig_orientation.roll ?? 0,
    fovDegrees: DEFAULT_FOV_DEGREES,
    autoCamera: { ...DEFAULT_AUTO_CAMERA_CONFIG },
  };
}

/** Parse and validate persisted or submitted game viewer settings. */
export function parseGameViewerSettings(value: unknown): GameViewerSettings {
  const object = requireObject(value, 'settings');
  if (object.version !== 1) {
    throw new Error('Unsupported game settings version.');
  }
  const autoCamera = requireObject(object.autoCamera, 'settings.autoCamera');

  return {
    version: 1,
    rigTiltRadians: requireRange(
      object.rigTiltRadians,
      -MAX_TILT_RADIANS,
      MAX_TILT_RADIANS,
      'Tilt',
    ),
    rigRollRadians: requireRange(
      object.rigRollRadians,
      -MAX_ROLL_RADIANS,
      MAX_ROLL_RADIANS,
      'Roll',
    ),
    fovDegrees: requireRange(
      object.fovDegrees,
      MIN_FOV_DEGREES,
      MAX_FOV_DEGREES,
      'Field of view',
    ),
    autoCamera: {
      newAreaDelaySeconds: requireRange(
        autoCamera.newAreaDelaySeconds,
        0,
        10,
        'New area delay',
      ),
      lookAheadSeconds: requireRange(autoCamera.lookAheadSeconds, 0, 3, 'Look ahead'),
      smoothingSeconds: requireRange(autoCamera.smoothingSeconds, 0.1, 3, 'Smooth time'),
      maxPanSpeedDegrees: requireRange(
        autoCamera.maxPanSpeedDegrees,
        10,
        180,
        'Maximum pan speed',
      ),
      maxPanAccelerationDegrees: requireRange(
        autoCamera.maxPanAccelerationDegrees,
        5,
        180,
        'Pan acceleration',
      ),
      maxZoomAccelerationDegrees: requireRange(
        autoCamera.maxZoomAccelerationDegrees,
        2,
        120,
        'Zoom acceleration',
      ),
      minimumFovDegrees: requireRange(
        autoCamera.minimumFovDegrees,
        20,
        90,
        'Minimum field of view',
      ),
      framePaddingPercent: requireRange(
        autoCamera.framePaddingPercent,
        0,
        25,
        'Frame padding',
      ),
    },
  };
}

/** Parse a JSON settings payload. */
export function parseGameViewerSettingsJson(value: string): GameViewerSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Game settings must be valid JSON.');
  }
  return parseGameViewerSettings(parsed);
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireRange(value: unknown, minimum: number, maximum: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}
