import { describe, expect, it } from 'vitest';
import type { WebDetection } from './metadata';
import { detectionBoxFovScale, detectionIsInsideCameraFov } from './detection-overlay';
import { DEFAULT_FOV_DEGREES } from './perspective';

function detection(yaw: number): WebDetection {
  return {
    camera: 'left',
    class_id: 0,
    confidence: 0.9,
    bbox: { center_x: 0.5, center_y: 0.5, width: 0.1, height: 0.2 },
    panorama: { yaw, pitch: 0 },
  };
}

describe('detectionIsInsideCameraFov', () => {
  const camera = {
    yaw: 0,
    pitch: 0,
    fovDegrees: 40,
    aspect: 16 / 9,
    tilt: 0,
    roll: 0,
  };

  it('accepts a detection in the current camera view', () => {
    expect(detectionIsInsideCameraFov(detection(0.25), camera)).toBe(true);
  });

  it('rejects a detection outside the current camera view', () => {
    expect(detectionIsInsideCameraFov(detection(0.9), camera)).toBe(false);
  });
});

describe('detectionBoxFovScale', () => {
  it('preserves box size at the default perspective FOV', () => {
    expect(detectionBoxFovScale(DEFAULT_FOV_DEGREES)).toBeCloseTo(1);
  });

  it('grows boxes when zooming in and shrinks them when zooming out', () => {
    expect(detectionBoxFovScale(40)).toBeGreaterThan(1);
    expect(detectionBoxFovScale(100)).toBeLessThan(1);
  });

  it('uses perspective projection scaling rather than linear degree scaling', () => {
    const expected = Math.tan((DEFAULT_FOV_DEGREES * Math.PI) / 360) /
      Math.tan((40 * Math.PI) / 360);
    expect(detectionBoxFovScale(40)).toBeCloseTo(expected);
  });
});
