import { describe, expect, it } from 'vitest';
import {
  defaultGameViewerSettings,
  parseGameViewerSettings,
  parseGameViewerSettingsJson,
} from './game-settings';
import type { MetadataTimeline } from './metadata';

const metadata = {
  manifest: {
    rig_orientation: {
      space: 'reco_framing_radians',
      tilt: 0.12,
      roll: -0.04,
    },
  },
} as MetadataTimeline;

describe('game viewer settings', () => {
  it('uses exported calibration for game defaults', () => {
    const settings = defaultGameViewerSettings(metadata);

    expect(settings.rigTiltRadians).toBe(0.12);
    expect(settings.rigRollRadians).toBe(-0.04);
    expect(settings.fovDegrees).toBe(75);
    expect(settings.recordingMode).toBe('video_assisted');
    expect(settings.autoCamera.newAreaDelaySeconds).toBe(5);
    expect(settings.autoCamera.actionJoinDistanceDegrees).toBe(10);
  });

  it('migrates settings written before recording modes to video-assisted entry', () => {
    const settings = defaultGameViewerSettings(metadata);
    const { recordingMode: _recordingMode, autoCamera, ...legacy } = settings;
    const { actionJoinDistanceDegrees: _actionReach, ...legacyAutoCamera } = autoCamera;
    const migrated = parseGameViewerSettings({ ...legacy, autoCamera: legacyAutoCamera });
    expect(migrated.recordingMode).toBe('video_assisted');
    expect(migrated.autoCamera.actionJoinDistanceDegrees).toBe(10);
  });

  it('round-trips a valid settings payload', () => {
    const settings = defaultGameViewerSettings(metadata);
    expect(parseGameViewerSettingsJson(JSON.stringify(settings))).toEqual(settings);
  });

  it('rejects settings outside the viewer control ranges', () => {
    const settings = defaultGameViewerSettings(metadata);
    expect(() => parseGameViewerSettings({ ...settings, fovDegrees: 500 })).toThrow(
      /Field of view/u,
    );
    expect(() =>
      parseGameViewerSettings({
        ...settings,
        autoCamera: { ...settings.autoCamera, framePaddingPercent: -1 },
      }),
    ).toThrow(/Frame padding/u);
  });
});
