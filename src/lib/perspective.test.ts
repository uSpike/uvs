import { describe, expect, it } from 'vitest';
import {
  MAX_FOV_DEGREES,
  MIN_FOV_DEGREES,
  clampFov,
  clampPerspectiveCenter,
  panoramaDisplaySideCenterYaw,
  panoramaCenter,
  panoramaPointIsOnDisplaySide,
  perspectiveCameraBasis,
  projectPanoramaPoint,
} from './perspective';

const extent = {
  yaw_min: -1,
  yaw_max: 1,
  pitch_min: -0.5,
  pitch_max: 0.5,
};

const camera = {
  yaw: 0,
  pitch: 0,
  fovDegrees: 75,
  aspect: 16 / 9,
  tilt: 0,
  roll: 0,
};

describe('perspective projection', () => {
  it('projects the camera target to the frame center', () => {
    expect(projectPanoramaPoint({ yaw: 0, pitch: 0 }, camera)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('matches Reco yaw orientation across the frame', () => {
    const lowerYaw = projectPanoramaPoint({ yaw: -0.2, pitch: 0 }, camera);
    const higherYaw = projectPanoramaPoint({ yaw: 0.2, pitch: 0 }, camera);
    expect(lowerYaw?.x).toBeGreaterThan(0.5);
    expect(higherYaw?.x).toBeLessThan(0.5);
  });

  it('maps displayed panorama sides opposite to world yaw order', () => {
    expect(panoramaPointIsOnDisplaySide({ yaw: 0.6, pitch: 0 }, extent, 'left')).toBe(true);
    expect(panoramaPointIsOnDisplaySide({ yaw: -0.6, pitch: 0 }, extent, 'left')).toBe(false);
    expect(panoramaPointIsOnDisplaySide({ yaw: -0.6, pitch: 0 }, extent, 'right')).toBe(true);
    expect(panoramaDisplaySideCenterYaw(extent, 'left')).toBe(0.5);
    expect(panoramaDisplaySideCenterYaw(extent, 'right')).toBe(-0.5);
  });

  it('places positive pitch above the frame center', () => {
    expect(projectPanoramaPoint({ yaw: 0, pitch: 0.2 }, camera)?.y).toBeLessThan(0.5);
  });

  it('rejects points behind the camera', () => {
    expect(projectPanoramaPoint({ yaw: Math.PI, pitch: 0 }, camera)).toBeNull();
  });

  it('keeps a world-space target centered with rig tilt and roll applied', () => {
    const orientedCamera = {
      ...camera,
      yaw: 0.55,
      pitch: -0.08,
      tilt: 0.18,
      roll: -0.11,
    };
    const projected = projectPanoramaPoint(
      { yaw: orientedCamera.yaw, pitch: orientedCamera.pitch },
      orientedCamera,
    );
    expect(projected?.x).toBeCloseTo(0.5, 8);
    expect(projected?.y).toBeCloseTo(0.5, 8);
  });

  it('counter-rotates the camera frame as a tilted rig pans', () => {
    const basis = perspectiveCameraBasis({
      ...camera,
      yaw: 0.7,
      tilt: 0.2,
    });
    expect(Math.abs(basis.right.y)).toBeGreaterThan(0.05);
  });

  it('applies rig roll around the forward axis', () => {
    const basis = perspectiveCameraBasis({ ...camera, roll: 0.15 });
    expect(Math.abs(basis.right.y)).toBeGreaterThan(0.1);
  });
});

describe('perspective controls', () => {
  it('clamps FOV to the supported control range', () => {
    expect(clampFov(1)).toBe(MIN_FOV_DEGREES);
    expect(clampFov(200)).toBe(MAX_FOV_DEGREES);
  });

  it('centers and clamps the camera within the exported extent', () => {
    expect(panoramaCenter(extent)).toEqual({ yaw: 0, pitch: 0 });
    expect(clampPerspectiveCenter(2, -1, extent)).toEqual({ yaw: 1, pitch: -0.5 });
  });
});
