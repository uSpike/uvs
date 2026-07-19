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
    expect(settings.autoCamera.newAreaDelaySeconds).toBe(5);
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
