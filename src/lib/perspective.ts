import type { PanoramaExtent, PanoramaPoint } from './metadata';

export const DEFAULT_FOV_DEGREES = 75;
export const MIN_FOV_DEGREES = 15;
export const MAX_FOV_DEGREES = 120;
export const PERSPECTIVE_ASPECT = 16 / 9;

export interface PerspectiveCamera {
  yaw: number;
  pitch: number;
  fovDegrees: number;
  aspect: number;
  tilt: number;
  roll: number;
}

export interface PerspectiveCameraBasis {
  forward: Vector3;
  right: Vector3;
  up: Vector3;
}

/** Horizontal side as it appears in the rendered, undistorted panorama. */
export type PanoramaDisplaySide = 'left' | 'right';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

const BASE_FORWARD: Vector3 = { x: 0, y: 0, z: 1 };
const BASE_RIGHT: Vector3 = { x: -1, y: 0, z: 0 };
const WORLD_UP: Vector3 = { x: 0, y: 1, z: 0 };

function dot(left: Vector3, right: Vector3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 1e-12
    ? { x: vector.x / length, y: vector.y / length, z: vector.z / length }
    : vector;
}

function rotateAroundAxis(vector: Vector3, axis: Vector3, angle: number): Vector3 {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const axisCrossVector = cross(axis, vector);
  const axisDotVector = dot(axis, vector);
  return {
    x:
      vector.x * cos +
      axisCrossVector.x * sin +
      axis.x * axisDotVector * (1 - cos),
    y:
      vector.y * cos +
      axisCrossVector.y * sin +
      axis.y * axisDotVector * (1 - cos),
    z:
      vector.z * cos +
      axisCrossVector.z * sin +
      axis.z * axisDotVector * (1 - cos),
  };
}

function panoramaDirection(yaw: number, pitch: number): Vector3 {
  const cosPitch = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: Math.cos(yaw) * cosPitch,
  };
}

function rigFrame(tilt: number, roll: number): { forward: Vector3; up: Vector3 } {
  let forward = BASE_FORWARD;
  let up = WORLD_UP;
  if (Math.abs(tilt) > 1e-9) {
    forward = rotateAroundAxis(forward, BASE_RIGHT, tilt);
    up = rotateAroundAxis(up, BASE_RIGHT, tilt);
  }
  if (Math.abs(roll) > 1e-9) {
    up = rotateAroundAxis(up, forward, -roll);
  }
  return { forward, up };
}

function worldToRenderPose(
  yaw: number,
  pitch: number,
  tilt: number,
  roll: number,
): { yaw: number; pitch: number } {
  if (Math.abs(tilt) < 1e-9 && Math.abs(roll) < 1e-9) {
    return { yaw, pitch };
  }

  const direction = panoramaDirection(yaw, pitch);
  const frame = rigFrame(tilt, roll);
  const upDotRight = dot(frame.up, BASE_RIGHT);
  const directionDotUp = dot(direction, frame.up);
  const a = dot(direction, BASE_RIGHT) - upDotRight * directionDotUp;
  const b = dot(direction, cross(frame.up, BASE_RIGHT));
  const c = upDotRight * directionDotUp;
  const radius = Math.hypot(a, b);
  if (radius < 1e-9) {
    return {
      yaw,
      pitch: dot(direction, frame.up) >= 0 ? Math.PI / 2 : -Math.PI / 2,
    };
  }

  const phase = Math.atan2(b, a);
  const delta = Math.acos(Math.min(1, Math.max(-1, -c / radius)));
  let bestAlignment = Number.NEGATIVE_INFINITY;
  let bestYaw = yaw;
  let bestPitch = pitch;
  for (const renderYaw of [phase + delta, phase - delta]) {
    const yawedForward = rotateAroundAxis(frame.forward, frame.up, renderYaw);
    const alignment = dot(yawedForward, direction);
    if (alignment > bestAlignment) {
      const pitchAxis = rotateAroundAxis(BASE_RIGHT, frame.up, renderYaw);
      bestAlignment = alignment;
      bestYaw = renderYaw;
      bestPitch = Math.atan2(dot(cross(yawedForward, direction), pitchAxis), alignment);
    }
  }

  return {
    yaw: ((bestYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI,
    pitch: bestPitch,
  };
}

/** Build the same tilt/roll-aware camera frame used by Reco's normal renderer. */
export function perspectiveCameraBasis(camera: PerspectiveCamera): PerspectiveCameraBasis {
  const frame = rigFrame(camera.tilt, camera.roll);
  const renderPose = worldToRenderPose(
    camera.yaw,
    camera.pitch,
    camera.tilt,
    camera.roll,
  );
  const pitchAxis = rotateAroundAxis(BASE_RIGHT, frame.up, renderPose.yaw);
  const yawedForward = rotateAroundAxis(frame.forward, frame.up, renderPose.yaw);
  const forward = normalize(rotateAroundAxis(yawedForward, pitchAxis, renderPose.pitch));
  const up = normalize(rotateAroundAxis(frame.up, pitchAxis, renderPose.pitch));
  return {
    forward,
    // Reco's positive yaw turns left, so screen-right points toward lower yaw.
    right: normalize(cross(forward, up)),
    up,
  };
}

export function clampFov(fovDegrees: number): number {
  return Math.min(MAX_FOV_DEGREES, Math.max(MIN_FOV_DEGREES, fovDegrees));
}

export function clampPerspectiveCenter(
  yaw: number,
  pitch: number,
  extent: PanoramaExtent,
): { yaw: number; pitch: number } {
  return {
    yaw: Math.min(extent.yaw_max, Math.max(extent.yaw_min, yaw)),
    pitch: Math.min(extent.pitch_max, Math.max(extent.pitch_min, pitch)),
  };
}

export function panoramaCenter(extent: PanoramaExtent): { yaw: number; pitch: number } {
  return {
    yaw: (extent.yaw_min + extent.yaw_max) / 2,
    pitch: (extent.pitch_min + extent.pitch_max) / 2,
  };
}

/**
 * Test a world-yaw point against a displayed side. Reco's positive yaw turns
 * left, so the rendered horizontal direction is the inverse of yaw order.
 */
export function panoramaPointIsOnDisplaySide(
  point: PanoramaPoint,
  extent: PanoramaExtent,
  side: PanoramaDisplaySide,
): boolean {
  const midpoint = (extent.yaw_min + extent.yaw_max) / 2;
  return side === 'left' ? point.yaw >= midpoint : point.yaw <= midpoint;
}

/** Return the yaw centered one quarter of the way into a displayed side. */
export function panoramaDisplaySideCenterYaw(
  extent: PanoramaExtent,
  side: PanoramaDisplaySide,
): number {
  const yawSpan = extent.yaw_max - extent.yaw_min;
  return side === 'left'
    ? extent.yaw_min + yawSpan * 0.75
    : extent.yaw_min + yawSpan * 0.25;
}

/** Project a panorama point when it lies inside the visible viewport. */
export function projectPanoramaPoint(
  point: PanoramaPoint,
  camera: PerspectiveCamera,
): { x: number; y: number } | null {
  if (
    !Number.isFinite(point.yaw) ||
    !Number.isFinite(point.pitch) ||
    !Number.isFinite(camera.yaw) ||
    !Number.isFinite(camera.pitch) ||
    !Number.isFinite(camera.fovDegrees) ||
    !Number.isFinite(camera.aspect) ||
    !Number.isFinite(camera.tilt) ||
    !Number.isFinite(camera.roll) ||
    camera.aspect <= 0
  ) {
    return null;
  }

  const tanHalfVerticalFov = Math.tan((clampFov(camera.fovDegrees) * Math.PI) / 360);
  const direction = panoramaDirection(point.yaw, point.pitch);
  const basis = perspectiveCameraBasis(camera);
  const depth = dot(direction, basis.forward);
  if (depth <= 1e-6) {
    return null;
  }

  const ndcX = dot(direction, basis.right) / (depth * tanHalfVerticalFov * camera.aspect);
  const ndcY = dot(direction, basis.up) / (depth * tanHalfVerticalFov);
  const x = (ndcX + 1) / 2;
  const y = (1 - ndcY) / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  return { x, y };
}

/** Convert a normalized viewport position back into a panorama-space direction. */
export function unprojectPerspectivePoint(
  normalized: { x: number; y: number },
  camera: PerspectiveCamera,
): PanoramaPoint | null {
  if (
    !Number.isFinite(normalized.x) ||
    !Number.isFinite(normalized.y) ||
    normalized.x < 0 ||
    normalized.x > 1 ||
    normalized.y < 0 ||
    normalized.y > 1 ||
    !Number.isFinite(camera.aspect) ||
    camera.aspect <= 0
  ) return null;

  const tanHalfVerticalFov = Math.tan((clampFov(camera.fovDegrees) * Math.PI) / 360);
  const ndcX = normalized.x * 2 - 1;
  const ndcY = 1 - normalized.y * 2;
  const basis = perspectiveCameraBasis(camera);
  const direction = normalize({
    x: basis.forward.x +
      basis.right.x * ndcX * tanHalfVerticalFov * camera.aspect +
      basis.up.x * ndcY * tanHalfVerticalFov,
    y: basis.forward.y +
      basis.right.y * ndcX * tanHalfVerticalFov * camera.aspect +
      basis.up.y * ndcY * tanHalfVerticalFov,
    z: basis.forward.z +
      basis.right.z * ndcX * tanHalfVerticalFov * camera.aspect +
      basis.up.z * ndcY * tanHalfVerticalFov,
  });
  return {
    yaw: Math.atan2(direction.x, direction.z),
    pitch: Math.asin(Math.min(1, Math.max(-1, direction.y))),
  };
}
