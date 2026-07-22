import {
  frameIndexAtTime,
  type DetectionSample,
  type MetadataTimeline,
  type PanoramaExtent,
  type PanoramaPoint,
  type WebDetection,
  type WebTrackState,
} from './metadata';
import {
  MAX_FOV_DEGREES,
  MIN_FOV_DEGREES,
  clampFov,
  clampPerspectiveCenter,
  projectPanoramaPoint,
} from './perspective';

const VELOCITY_WINDOW_SECONDS = 3.5;
const MIN_MOMENTUM_OBSERVATIONS = 4;
const MAX_PLAYER_SPEED_RADIANS = (20 * Math.PI) / 180;
const MAX_PREDICTION_OFFSET_RADIANS = (15 * Math.PI) / 180;
const DETECTION_AREA_RADIUS_RADIANS = (8 * Math.PI) / 180;
const ASSOCIATION_BASE_RADIANS = (6 * Math.PI) / 180;
const ASSOCIATION_SPEED_RADIANS = (24 * Math.PI) / 180;
const MAX_FRAME_PADDING_PERCENT = 45;

export interface PlayerVelocity {
  yaw: number;
  pitch: number;
}

export interface PlayerTrackObservation {
  trackId: number;
  classId: number;
  frameIndex: number;
  timeSeconds: number;
  point: PanoramaPoint;
  smoothedPoint: PanoramaPoint;
  velocity: PlayerVelocity;
  historySeconds: number;
  hitCount: number;
  state: WebTrackState;
  confidence: number;
  detection: WebDetection | null;
  source: 'exported' | 'associated';
}

export interface PlayerTrack {
  id: number;
  classId: number;
  observations: PlayerTrackObservation[];
}

export interface PlayerTrackSample {
  frameIndex: number;
  observations: PlayerTrackObservation[];
}

export interface PlayerTrackTimeline {
  tracks: PlayerTrack[];
  samples: PlayerTrackSample[];
  secondsPerFrame: number;
  nominalSampleSeconds: number;
  holdFrames: number;
  extent: PanoramaExtent;
  source: 'exported' | 'associated';
}

export interface DetectionAreaHistoryTimeline {
  historyByDetection: Map<WebDetection, number>;
}

/** Inclusion state for one detection under the configured new-area delay. */
export interface DetectionAreaStatus {
  included: boolean;
  historySeconds: number;
  remainingSeconds: number;
}

export type DetectionTrustState = 'included' | 'pending' | 'excluded';

export interface TrustedDetectionSelection {
  included: WebDetection[];
  stateByDetection: Map<WebDetection, DetectionTrustState>;
}

export interface AutoCameraSubject {
  observedPoint: PanoramaPoint;
  predictedPoint: PanoramaPoint;
  detection: WebDetection | null;
}

export interface PredictedPlayer extends AutoCameraSubject {
  trackId: number;
  classId: number;
  velocity: PlayerVelocity;
  speedDegreesPerSecond: number;
  momentumReliable: boolean;
  historySeconds: number;
  state: WebTrackState;
  confidence: number;
}

export interface AutoCameraConfig {
  newAreaDelaySeconds: number;
  trustHaloRadiusDegrees: number;
  trustHaloTimeoutSeconds: number;
  lookAheadSeconds: number;
  smoothingSeconds: number;
  maxPanSpeedDegrees: number;
  maxPanAccelerationDegrees: number;
  maxZoomAccelerationDegrees: number;
  minimumFovDegrees: number;
  framePaddingPercent: number;
}

export interface AutoCameraPose {
  yaw: number;
  pitch: number;
  fovDegrees: number;
}

export interface AutoCameraVelocity {
  yaw: number;
  pitch: number;
  fovDegrees: number;
}

export interface AutoCameraStep {
  pose: AutoCameraPose;
  velocity: AutoCameraVelocity;
}

export const DEFAULT_AUTO_CAMERA_CONFIG: AutoCameraConfig = {
  newAreaDelaySeconds: 5,
  trustHaloRadiusDegrees: 16,
  trustHaloTimeoutSeconds: 1.5,
  lookAheadSeconds: 1.5,
  smoothingSeconds: 1.4,
  maxPanSpeedDegrees: 40,
  maxPanAccelerationDegrees: 35,
  maxZoomAccelerationDegrees: 15,
  minimumFovDegrees: 40,
  framePaddingPercent: 12,
};

function frameTime(frameIndex: number, secondsPerFrame: number): number {
  return frameIndex * secondsPerFrame;
}

function angularDistance(left: PanoramaPoint, right: PanoramaPoint): number {
  const averagePitch = (left.pitch + right.pitch) / 2;
  return Math.hypot((left.yaw - right.yaw) * Math.cos(averagePitch), left.pitch - right.pitch);
}

function clampVelocity(velocity: PlayerVelocity): PlayerVelocity {
  const speed = Math.hypot(velocity.yaw, velocity.pitch);
  if (speed <= MAX_PLAYER_SPEED_RADIANS || speed <= 1e-9) {
    return velocity;
  }
  const scale = MAX_PLAYER_SPEED_RADIANS / speed;
  return { yaw: velocity.yaw * scale, pitch: velocity.pitch * scale };
}

function estimateVelocity(observations: PlayerTrackObservation[]): PlayerVelocity {
  const latest = observations.at(-1);
  if (!latest || observations.length < MIN_MOMENTUM_OBSERVATIONS) {
    return { yaw: 0, pitch: 0 };
  }
  const window = observations.filter(
    (observation) => latest.timeSeconds - observation.timeSeconds <= VELOCITY_WINDOW_SECONDS,
  );
  if (window.length < MIN_MOMENTUM_OBSERVATIONS) {
    return { yaw: 0, pitch: 0 };
  }

  const yawVelocities: number[] = [];
  const pitchVelocities: number[] = [];
  for (let index = 1; index < window.length; index += 1) {
    const previous = window[index - 1];
    const current = window[index];
    const elapsed = current.timeSeconds - previous.timeSeconds;
    if (elapsed <= 1e-6) continue;
    yawVelocities.push((current.point.yaw - previous.point.yaw) / elapsed);
    pitchVelocities.push((current.point.pitch - previous.point.pitch) / elapsed);
  }
  if (yawVelocities.length < MIN_MOMENTUM_OBSERVATIONS - 1) {
    return { yaw: 0, pitch: 0 };
  }
  return clampVelocity({
    yaw: median(yawVelocities),
    pitch: median(pitchVelocities),
  });
}

function smoothTrajectoryPoint(
  measured: PanoramaPoint,
  previous: PlayerTrackObservation | undefined,
  timeSeconds: number,
): PanoramaPoint {
  if (!previous) {
    return measured;
  }
  const elapsed = Math.max(1e-3, timeSeconds - previous.timeSeconds);
  const predicted = {
    yaw: previous.smoothedPoint.yaw + previous.velocity.yaw * elapsed,
    pitch: previous.smoothedPoint.pitch + previous.velocity.pitch * elapsed,
  };
  // Sparse detections need enough correction to follow real turns without
  // letting one noisy box relocate the trajectory wholesale.
  const correction = Math.min(0.55, Math.max(0.2, elapsed / (1.5 + elapsed)));
  return {
    yaw: predicted.yaw + (measured.yaw - predicted.yaw) * correction,
    pitch: predicted.pitch + (measured.pitch - predicted.pitch) * correction,
  };
}

function smoothEstimatedVelocity(observations: PlayerTrackObservation[]): PlayerVelocity {
  const measured = estimateVelocity(observations);
  const previous = observations.at(-2);
  const latest = observations.at(-1);
  if (!previous || !latest || observations.length === MIN_MOMENTUM_OBSERVATIONS) {
    return measured;
  }
  const elapsed = Math.max(1e-3, latest.timeSeconds - previous.timeSeconds);
  const response = 1 - Math.exp(-elapsed / 1.5);
  return clampVelocity({
    yaw: previous.velocity.yaw + (measured.yaw - previous.velocity.yaw) * response,
    pitch: previous.velocity.pitch + (measured.pitch - previous.velocity.pitch) * response,
  });
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function sampleCadenceSeconds(
  frameIndices: number[],
  secondsPerFrame: number,
  fallbackFrames: number,
): number {
  const deltas: number[] = [];
  for (let index = 1; index < frameIndices.length; index += 1) {
    const delta = frameIndices[index] - frameIndices[index - 1];
    if (delta > 0) {
      deltas.push(delta * secondsPerFrame);
    }
  }
  return median(deltas) || fallbackFrames * secondsPerFrame || 0.5;
}

export function buildDetectionAreaHistoryTimeline(
  metadata: MetadataTimeline,
  durationSeconds: number,
  trustedBaselineTimesSeconds: readonly number[] = [],
  trustConfig: Pick<
    AutoCameraConfig,
    'newAreaDelaySeconds' | 'trustHaloRadiusDegrees' | 'trustHaloTimeoutSeconds'
  > = DEFAULT_AUTO_CAMERA_CONFIG,
): DetectionAreaHistoryTimeline | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  interface TrustHalo {
    classId: number;
    point: PanoramaPoint;
    lastSeenSeconds: number;
  }

  interface PendingArea {
    classId: number;
    point: PanoramaPoint;
    firstSeenSeconds: number;
    lastSeenSeconds: number;
  }

  const frameCount = Math.max(1, metadata.lastFrameIndex + 1);
  const secondsPerFrame = durationSeconds / frameCount;
  const nominalSampleSeconds = sampleCadenceSeconds(
    metadata.detectionSamples.map((sample) => sample.frameIndex),
    secondsPerFrame,
    metadata.manifest.detection_interval,
  );
  const pendingRetentionSeconds = Math.max(1.25, nominalSampleSeconds * 2.25);
  const haloRadius =
    (Math.min(
      30,
      Math.max(
        4,
        Number.isFinite(trustConfig.trustHaloRadiusDegrees)
          ? trustConfig.trustHaloRadiusDegrees
          : DEFAULT_AUTO_CAMERA_CONFIG.trustHaloRadiusDegrees,
      ),
    ) *
      Math.PI) /
    180;
  const haloTimeoutSeconds = Math.min(
    5,
    Math.max(
      0.5,
      Number.isFinite(trustConfig.trustHaloTimeoutSeconds)
        ? trustConfig.trustHaloTimeoutSeconds
        : DEFAULT_AUTO_CAMERA_CONFIG.trustHaloTimeoutSeconds,
    ),
  );
  const newAreaDelaySeconds = Math.min(
    10,
    Math.max(
      0,
      Number.isFinite(trustConfig.newAreaDelaySeconds)
        ? trustConfig.newAreaDelaySeconds
        : DEFAULT_AUTO_CAMERA_CONFIG.newAreaDelaySeconds,
    ),
  );
  const trustedBaselineSamples = detectionBaselineSamples(
    metadata,
    durationSeconds,
    trustedBaselineTimesSeconds,
  );
  const historyByDetection = new Map<WebDetection, number>();
  let trustedHalos: TrustHalo[] = [];
  let pendingAreas: PendingArea[] = [];

  for (const sample of metadata.detectionSamples) {
    const timeSeconds = frameTime(sample.frameIndex, secondsPerFrame);
    const detections = sample.detections.filter(
      (detection): detection is WebDetection & { panorama: PanoramaPoint } =>
        detection.panorama !== null,
    );
    if (trustedBaselineSamples.has(sample)) {
      trustedHalos = detections.map((detection) => {
        historyByDetection.set(detection, Number.POSITIVE_INFINITY);
        return {
          classId: detection.class_id,
          point: detection.panorama,
          lastSeenSeconds: timeSeconds,
        };
      });
      pendingAreas = [];
      continue;
    }

    trustedHalos = trustedHalos.filter(
      (halo) => timeSeconds - halo.lastSeenSeconds <= haloTimeoutSeconds,
    );
    pendingAreas = pendingAreas.filter(
      (area) => timeSeconds - area.lastSeenSeconds <= pendingRetentionSeconds,
    );
    const activeHalos = [...trustedHalos];
    const refreshedHalos: TrustHalo[] = [];
    const pendingAreaPoints = new Map<PendingArea, PanoramaPoint[]>();
    for (const detection of detections) {
      const insideTrustedHalo = activeHalos.some(
        (halo) =>
          halo.classId === detection.class_id &&
          angularDistance(halo.point, detection.panorama) <= haloRadius,
      );
      if (insideTrustedHalo) {
        historyByDetection.set(detection, Number.POSITIVE_INFINITY);
        refreshedHalos.push({
          classId: detection.class_id,
          point: detection.panorama,
          lastSeenSeconds: timeSeconds,
        });
        continue;
      }

      let nearestPendingArea: PendingArea | null = null;
      let nearestPendingDistance = Number.POSITIVE_INFINITY;
      for (const area of pendingAreas) {
        if (area.classId !== detection.class_id) continue;
        const distance = angularDistance(area.point, detection.panorama);
        if (
          distance <= DETECTION_AREA_RADIUS_RADIANS &&
          distance < nearestPendingDistance
        ) {
          nearestPendingArea = area;
          nearestPendingDistance = distance;
        }
      }

      if (!nearestPendingArea) {
        nearestPendingArea = {
          classId: detection.class_id,
          point: detection.panorama,
          firstSeenSeconds: timeSeconds,
          lastSeenSeconds: timeSeconds,
        };
        pendingAreas.push(nearestPendingArea);
      }
      const historySeconds = Math.max(
        0,
        timeSeconds - nearestPendingArea.firstSeenSeconds,
      );
      if (historySeconds >= newAreaDelaySeconds) {
        historyByDetection.set(detection, Number.POSITIVE_INFINITY);
        refreshedHalos.push({
          classId: detection.class_id,
          point: detection.panorama,
          lastSeenSeconds: timeSeconds,
        });
      } else {
        historyByDetection.set(detection, historySeconds);
        const points = pendingAreaPoints.get(nearestPendingArea) ?? [];
        points.push(detection.panorama);
        pendingAreaPoints.set(nearestPendingArea, points);
      }
    }

    for (const [area, points] of pendingAreaPoints) {
      area.point = {
        yaw: points.reduce((sum, point) => sum + point.yaw, 0) / points.length,
        pitch: points.reduce((sum, point) => sum + point.pitch, 0) / points.length,
      };
      area.lastSeenSeconds = timeSeconds;
    }
    trustedHalos.push(...refreshedHalos);
  }

  return { historyByDetection };
}

function detectionBaselineSamples(
  metadata: MetadataTimeline,
  durationSeconds: number,
  baselineTimesSeconds: readonly number[],
): Set<DetectionSample> {
  const result = new Set<DetectionSample>();
  const samples = metadata.detectionSamples;
  if (samples.length === 0) return result;

  for (const timeSeconds of baselineTimesSeconds) {
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > durationSeconds) {
      continue;
    }
    const targetFrame = frameIndexAtTime(
      timeSeconds,
      durationSeconds,
      metadata.lastFrameIndex,
    );
    let low = 0;
    let high = samples.length - 1;
    let previousIndex = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (samples[middle].frameIndex <= targetFrame) {
        previousIndex = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (
      previousIndex >= 0 &&
      targetFrame - samples[previousIndex].frameIndex <= metadata.manifest.detection_interval
    ) {
      result.add(samples[previousIndex]);
      continue;
    }
    const nextIndex = previousIndex + 1;
    if (
      nextIndex < samples.length &&
      samples[nextIndex].frameIndex - targetFrame <= metadata.manifest.detection_interval
    ) {
      result.add(samples[nextIndex]);
    }
  }
  return result;
}

export function detectionsWithEstablishedArea(
  detections: WebDetection[],
  areaHistory: DetectionAreaHistoryTimeline | null,
  minimumHistorySeconds: number,
): WebDetection[] {
  return detections.filter(
    (detection) => detectionAreaStatus(detection, areaHistory, minimumHistorySeconds).included,
  );
}

/** Select every trusted detection without imposing IDs, counts, or spatial connectivity. */
export function selectTrustedDetections(
  detections: WebDetection[],
  areaHistory: DetectionAreaHistoryTimeline | null,
  minimumHistorySeconds: number,
): TrustedDetectionSelection {
  const candidates = detections.filter(
    (detection): detection is WebDetection & { panorama: PanoramaPoint } =>
      detection.panorama !== null,
  );
  const stateByDetection = new Map<WebDetection, DetectionTrustState>();
  for (const detection of detections) {
    stateByDetection.set(detection, 'excluded');
  }
  const included = candidates.filter((detection) =>
    detectionAreaStatus(detection, areaHistory, minimumHistorySeconds).included,
  );
  const includedSet = new Set<WebDetection>(included);
  for (const detection of candidates) {
    stateByDetection.set(
      detection,
      includedSet.has(detection) ? 'included' : 'pending',
    );
  }
  return { included, stateByDetection };
}

/** Return the persistence status used to include or withhold a detection. */
export function detectionAreaStatus(
  detection: WebDetection,
  areaHistory: DetectionAreaHistoryTimeline | null,
  minimumHistorySeconds: number,
): DetectionAreaStatus {
  const requiredHistory = Number.isFinite(minimumHistorySeconds)
    ? Math.max(0, minimumHistorySeconds)
    : 0;
  if (!areaHistory || requiredHistory <= 0) {
    return {
      included: true,
      historySeconds: Number.POSITIVE_INFINITY,
      remainingSeconds: 0,
    };
  }

  const recordedHistory = areaHistory.historyByDetection.get(detection);
  const historySeconds =
    recordedHistory === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : Math.max(0, recordedHistory ?? 0);
  const included = detection.panorama !== null && historySeconds >= requiredHistory;
  return {
    included,
    historySeconds,
    remainingSeconds:
      included ? 0 : Math.max(0, requiredHistory - historySeconds),
  };
}

function matchDetections(
  points: Array<{ classId: number; point: PanoramaPoint }>,
  detections: WebDetection[],
): Array<WebDetection | null> {
  const matches: Array<WebDetection | null> = Array.from({ length: points.length }, () => null);
  const candidates: Array<{ pointIndex: number; detectionIndex: number; distance: number }> = [];
  for (const [pointIndex, point] of points.entries()) {
    for (const [detectionIndex, detection] of detections.entries()) {
      if (detection.class_id === point.classId && detection.panorama) {
        candidates.push({
          pointIndex,
          detectionIndex,
          distance: angularDistance(point.point, detection.panorama),
        });
      }
    }
  }
  candidates.sort((left, right) => left.distance - right.distance);
  const usedPoints = new Set<number>();
  const usedDetections = new Set<number>();
  for (const candidate of candidates) {
    if (
      candidate.distance > 0.2 ||
      usedPoints.has(candidate.pointIndex) ||
      usedDetections.has(candidate.detectionIndex)
    ) {
      continue;
    }
    matches[candidate.pointIndex] = detections[candidate.detectionIndex];
    usedPoints.add(candidate.pointIndex);
    usedDetections.add(candidate.detectionIndex);
  }
  return matches;
}

function buildExportedTrackTimeline(
  metadata: MetadataTimeline,
  secondsPerFrame: number,
  nominalSampleSeconds: number,
): PlayerTrackTimeline {
  const detectionByFrame = new Map(
    metadata.detectionSamples.map((sample) => [sample.frameIndex, sample.detections]),
  );
  const tracks = new Map<number, PlayerTrack>();
  const samples: PlayerTrackSample[] = [];

  for (const sample of metadata.trackSamples) {
    const timeSeconds = frameTime(sample.frameIndex, secondsPerFrame);
    const detectionMatches = matchDetections(
      sample.players.map((player) => ({ classId: player.class_id, point: player.panorama })),
      detectionByFrame.get(sample.frameIndex) ?? [],
    );
    const observations = sample.players.map((player, index) => {
      let track = tracks.get(player.id);
      if (!track) {
        track = { id: player.id, classId: player.class_id, observations: [] };
        tracks.set(player.id, track);
      }
      const previous = track.observations.at(-1);
      const observation: PlayerTrackObservation = {
        trackId: player.id,
        classId: player.class_id,
        frameIndex: sample.frameIndex,
        timeSeconds,
        point: player.panorama,
        smoothedPoint: smoothTrajectoryPoint(player.panorama, previous, timeSeconds),
        velocity: previous?.velocity ?? { yaw: 0, pitch: 0 },
        historySeconds: Math.max(
          previous ? previous.historySeconds + (timeSeconds - previous.timeSeconds) : 0,
          player.age_frames * secondsPerFrame,
        ),
        hitCount: (previous?.hitCount ?? 0) + 1,
        state: player.state,
        confidence: player.confidence,
        detection: detectionMatches[index],
        source: 'exported',
      };
      track.observations.push(observation);
      observation.velocity = smoothEstimatedVelocity(track.observations);
      return observation;
    });
    samples.push({ frameIndex: sample.frameIndex, observations });
  }

  return {
    tracks: [...tracks.values()],
    samples,
    secondsPerFrame,
    nominalSampleSeconds,
    holdFrames: Math.max(1, Math.round(nominalSampleSeconds / secondsPerFrame)),
    extent: metadata.manifest.panorama_extent,
    source: 'exported',
  };
}

function buildAssociatedTrackTimeline(
  metadata: MetadataTimeline,
  secondsPerFrame: number,
  nominalSampleSeconds: number,
): PlayerTrackTimeline {
  const tracks: PlayerTrack[] = [];
  const samples: PlayerTrackSample[] = [];
  const retentionSeconds = Math.max(2.5, nominalSampleSeconds * 3);
  let nextTrackId = 1;

  for (const sample of metadata.detectionSamples) {
    const timeSeconds = frameTime(sample.frameIndex, secondsPerFrame);
    const detections = sample.detections.filter(
      (detection): detection is WebDetection & { panorama: PanoramaPoint } =>
        detection.panorama !== null,
    );
    const candidates: Array<{
      track: PlayerTrack;
      detection: (typeof detections)[number];
      distance: number;
    }> = [];
    for (const track of tracks) {
      const previous = track.observations.at(-1);
      if (!previous) continue;
      const elapsed = timeSeconds - previous.timeSeconds;
      if (elapsed <= 0 || elapsed > retentionSeconds) continue;
      const predicted = {
        yaw: previous.smoothedPoint.yaw + previous.velocity.yaw * Math.min(elapsed, 2),
        pitch: previous.smoothedPoint.pitch + previous.velocity.pitch * Math.min(elapsed, 2),
      };
      const gate = ASSOCIATION_BASE_RADIANS + ASSOCIATION_SPEED_RADIANS * Math.min(elapsed, 2);
      for (const detection of detections) {
        if (detection.class_id !== track.classId) continue;
        const distance = angularDistance(predicted, detection.panorama);
        if (distance <= gate) {
          candidates.push({ track, detection, distance });
        }
      }
    }
    candidates.sort((left, right) => left.distance - right.distance);
    const trackAssignments = new Map<PlayerTrack, (typeof detections)[number]>();
    const usedDetections = new Set<WebDetection>();
    for (const candidate of candidates) {
      if (!trackAssignments.has(candidate.track) && !usedDetections.has(candidate.detection)) {
        trackAssignments.set(candidate.track, candidate.detection);
        usedDetections.add(candidate.detection);
      }
    }
    for (const detection of detections) {
      if (!usedDetections.has(detection)) {
        const track: PlayerTrack = {
          id: nextTrackId,
          classId: detection.class_id,
          observations: [],
        };
        nextTrackId += 1;
        tracks.push(track);
        trackAssignments.set(track, detection);
      }
    }

    const observations: PlayerTrackObservation[] = [];
    for (const [track, detection] of trackAssignments) {
      const previous = track.observations.at(-1);
      const observation: PlayerTrackObservation = {
        trackId: track.id,
        classId: track.classId,
        frameIndex: sample.frameIndex,
        timeSeconds,
        point: detection.panorama,
        smoothedPoint: smoothTrajectoryPoint(detection.panorama, previous, timeSeconds),
        velocity: previous?.velocity ?? { yaw: 0, pitch: 0 },
        historySeconds: previous ? timeSeconds - track.observations[0].timeSeconds : 0,
        hitCount: (previous?.hitCount ?? 0) + 1,
        state: 'tracking',
        confidence: detection.confidence,
        detection,
        source: 'associated',
      };
      track.observations.push(observation);
      observation.velocity = smoothEstimatedVelocity(track.observations);
      observations.push(observation);
    }
    observations.sort((left, right) => left.trackId - right.trackId);
    samples.push({ frameIndex: sample.frameIndex, observations });
  }

  return {
    tracks,
    samples,
    secondsPerFrame,
    nominalSampleSeconds,
    holdFrames: Math.max(1, Math.round(nominalSampleSeconds / secondsPerFrame)),
    extent: metadata.manifest.panorama_extent,
    source: 'associated',
  };
}

export function buildPlayerTrackTimeline(
  metadata: MetadataTimeline,
  durationSeconds: number,
): PlayerTrackTimeline | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }
  const frameCount = Math.max(1, metadata.lastFrameIndex + 1);
  const secondsPerFrame = durationSeconds / frameCount;
  const usesExportedTracks = metadata.trackSamples.length > 0;
  const frameIndices = (usesExportedTracks ? metadata.trackSamples : metadata.detectionSamples).map(
    (sample) => sample.frameIndex,
  );
  const nominalSampleSeconds = sampleCadenceSeconds(
    frameIndices,
    secondsPerFrame,
    metadata.manifest.detection_interval,
  );
  return usesExportedTracks
    ? buildExportedTrackTimeline(metadata, secondsPerFrame, nominalSampleSeconds)
    : buildAssociatedTrackTimeline(metadata, secondsPerFrame, nominalSampleSeconds);
}

function latestAtOrBefore<T>(
  values: T[],
  target: number,
  selector: (value: T) => number,
): T | null {
  let low = 0;
  let high = values.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (selector(values[middle]) <= target) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match >= 0 ? values[match] : null;
}

export function trackObservationsAtFrame(
  timeline: PlayerTrackTimeline,
  frameIndex: number,
): PlayerTrackObservation[] {
  const sample = latestAtOrBefore(timeline.samples, frameIndex, (value) => value.frameIndex);
  if (!sample || frameIndex - sample.frameIndex > timeline.holdFrames) {
    return [];
  }
  return sample.observations;
}

export function predictedPlayersAtTime(
  timeline: PlayerTrackTimeline,
  currentTimeSeconds: number,
  minimumHistorySeconds: number,
  lookAheadSeconds: number,
): PredictedPlayer[] {
  const staleSeconds = Math.max(1.25, timeline.nominalSampleSeconds * 2.25);
  const requiredHistory = Math.max(0, minimumHistorySeconds);
  const predictionLead = Math.max(0, lookAheadSeconds);
  const players: PredictedPlayer[] = [];

  for (const track of timeline.tracks) {
    const observation = latestAtOrBefore(
      track.observations,
      currentTimeSeconds,
      (value) => value.timeSeconds,
    );
    if (!observation || observation.state === 'lost') continue;
    const elapsed = Math.max(0, currentTimeSeconds - observation.timeSeconds);
    if (elapsed > staleSeconds) continue;
    if (
      observation.historySeconds + 1e-6 < requiredHistory ||
      (requiredHistory > 0 && observation.hitCount < 2)
    ) {
      continue;
    }
    const momentumReliable = observation.hitCount >= MIN_MOMENTUM_OBSERVATIONS;
    const horizon = momentumReliable ? elapsed + predictionLead : 0;
    let yawOffset = observation.velocity.yaw * horizon;
    let pitchOffset = observation.velocity.pitch * horizon;
    const offsetLength = Math.hypot(
      yawOffset * Math.cos(observation.smoothedPoint.pitch),
      pitchOffset,
    );
    if (offsetLength > MAX_PREDICTION_OFFSET_RADIANS) {
      const scale = MAX_PREDICTION_OFFSET_RADIANS / offsetLength;
      yawOffset *= scale;
      pitchOffset *= scale;
    }
    const predictionOrigin = observation.point;
    const predictedPoint = {
      yaw: Math.min(
        timeline.extent.yaw_max,
        Math.max(
          timeline.extent.yaw_min,
          predictionOrigin.yaw + yawOffset,
        ),
      ),
      pitch: Math.min(
        timeline.extent.pitch_max,
        Math.max(
          timeline.extent.pitch_min,
          predictionOrigin.pitch + pitchOffset,
        ),
      ),
    };
    const speedRadians = Math.hypot(
      observation.velocity.yaw * Math.cos(observation.point.pitch),
      observation.velocity.pitch,
    );
    players.push({
      trackId: track.id,
      classId: track.classId,
      observedPoint: observation.point,
      predictedPoint,
      velocity: observation.velocity,
      speedDegreesPerSecond: (speedRadians * 180) / Math.PI,
      momentumReliable,
      historySeconds: observation.historySeconds,
      state: observation.state,
      confidence: observation.confidence,
      detection: observation.detection,
    });
  }
  return players;
}

export function autoCameraSubjectsForDetections(
  detections: WebDetection[],
): AutoCameraSubject[] {
  const subjects: AutoCameraSubject[] = [];
  for (const detection of detections) {
    if (!detection.panorama) continue;
    subjects.push({
      observedPoint: detection.panorama,
      predictedPoint: detection.panorama,
      detection,
    });
  }
  return subjects;
}

function framingCenter(players: AutoCameraSubject[], extent: PanoramaExtent): PanoramaPoint {
  let yawMin = Number.POSITIVE_INFINITY;
  let yawMax = Number.NEGATIVE_INFINITY;
  let pitchMin = Number.POSITIVE_INFINITY;
  let pitchMax = Number.NEGATIVE_INFINITY;
  for (const player of players) {
    for (const point of [player.observedPoint, player.predictedPoint]) {
      yawMin = Math.min(yawMin, point.yaw);
      yawMax = Math.max(yawMax, point.yaw);
      pitchMin = Math.min(pitchMin, point.pitch);
      pitchMax = Math.max(pitchMax, point.pitch);
    }
  }
  return clampPerspectiveCenter((yawMin + yawMax) / 2, (pitchMin + pitchMax) / 2, extent);
}

function playersFit(
  players: AutoCameraSubject[],
  center: PanoramaPoint,
  fovDegrees: number,
  aspect: number,
  tilt: number,
  roll: number,
  framePaddingPercent: number,
): boolean {
  const margin =
    Math.min(
      MAX_FRAME_PADDING_PERCENT,
      Math.max(0, Number.isFinite(framePaddingPercent) ? framePaddingPercent : 0),
    ) / 100;
  return players.every((player) => {
    const halfBoxWidth = Math.min(0.2, Math.abs(player.detection?.bbox.width ?? 0) / 2);
    const halfBoxHeight = Math.min(0.25, Math.abs(player.detection?.bbox.height ?? 0) / 2);
    return [player.observedPoint, player.predictedPoint].every((point) => {
      const projected = projectPanoramaPoint(point, {
        yaw: center.yaw,
        pitch: center.pitch,
        fovDegrees,
        aspect,
        tilt,
        roll,
      });
      return Boolean(
        projected &&
          projected.x - halfBoxWidth >= margin &&
          projected.x + halfBoxWidth <= 1 - margin &&
          projected.y - halfBoxHeight >= margin &&
          projected.y + halfBoxHeight <= 1 - margin,
      );
    });
  });
}

export function autoCameraTarget(
  players: AutoCameraSubject[],
  extent: PanoramaExtent,
  aspect: number,
  tilt: number,
  roll: number,
  minimumFovDegrees: number,
  framePaddingPercent: number,
): AutoCameraPose | null {
  if (players.length === 0 || !Number.isFinite(aspect) || aspect <= 0) {
    return null;
  }
  const center = framingCenter(players, extent);
  return {
    ...center,
    fovDegrees: requiredAutoCameraFov(
      players,
      center,
      aspect,
      tilt,
      roll,
      minimumFovDegrees,
      framePaddingPercent,
    ),
  };
}

export function requiredAutoCameraFov(
  players: AutoCameraSubject[],
  center: PanoramaPoint,
  aspect: number,
  tilt: number,
  roll: number,
  minimumFovDegrees: number,
  framePaddingPercent: number,
): number {
  let low = clampFov(minimumFovDegrees);
  let high = MAX_FOV_DEGREES;
  if (!playersFit(players, center, high, aspect, tilt, roll, framePaddingPercent)) {
    return high;
  }
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const middle = (low + high) / 2;
    if (playersFit(players, center, middle, aspect, tilt, roll, framePaddingPercent)) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return Math.max(MIN_FOV_DEGREES, high);
}

export function stepAutoCamera(
  current: AutoCameraPose,
  target: AutoCameraPose,
  currentVelocity: AutoCameraVelocity,
  elapsedSeconds: number,
  config: AutoCameraConfig,
  extent: PanoramaExtent,
): AutoCameraStep {
  const elapsed = Math.min(0.1, Math.max(0, elapsedSeconds));
  if (elapsed <= 0) {
    return { pose: current, velocity: currentVelocity };
  }
  const smoothingSeconds = Math.max(0.15, config.smoothingSeconds);
  const yawError = target.yaw - current.yaw;
  const pitchError = target.pitch - current.pitch;
  const deadZone = (0.2 * Math.PI) / 180;
  const inDeadZone = Math.hypot(yawError, pitchError) < deadZone;
  let desiredYawVelocity = inDeadZone ? 0 : yawError / smoothingSeconds;
  let desiredPitchVelocity = inDeadZone ? 0 : pitchError / smoothingSeconds;
  const desiredSpeed = Math.hypot(desiredYawVelocity, desiredPitchVelocity);
  const maxPanSpeed = (Math.max(1, config.maxPanSpeedDegrees) * Math.PI) / 180;
  if (desiredSpeed > maxPanSpeed) {
    const scale = maxPanSpeed / desiredSpeed;
    desiredYawVelocity *= scale;
    desiredPitchVelocity *= scale;
  }
  const velocityDeltaYaw = desiredYawVelocity - currentVelocity.yaw;
  const velocityDeltaPitch = desiredPitchVelocity - currentVelocity.pitch;
  const velocityDelta = Math.hypot(velocityDeltaYaw, velocityDeltaPitch);
  const maxVelocityDelta =
    ((Math.max(1, config.maxPanAccelerationDegrees) * Math.PI) / 180) * elapsed;
  const accelerationScale =
    velocityDelta > maxVelocityDelta ? maxVelocityDelta / velocityDelta : 1;
  let yawVelocity = currentVelocity.yaw + velocityDeltaYaw * accelerationScale;
  let pitchVelocity = currentVelocity.pitch + velocityDeltaPitch * accelerationScale;
  const panSpeed = Math.hypot(yawVelocity, pitchVelocity);
  if (panSpeed > maxPanSpeed) {
    const scale = maxPanSpeed / panSpeed;
    yawVelocity *= scale;
    pitchVelocity *= scale;
  }
  let yawStep = yawVelocity * elapsed;
  let pitchStep = pitchVelocity * elapsed;
  if (Math.sign(yawError) !== Math.sign(yawError - yawStep)) {
    yawStep = yawError;
    yawVelocity = 0;
  }
  if (Math.sign(pitchError) !== Math.sign(pitchError - pitchStep)) {
    pitchStep = pitchError;
    pitchVelocity = 0;
  }
  const unclampedYaw = current.yaw + yawStep;
  const unclampedPitch = current.pitch + pitchStep;
  const center = clampPerspectiveCenter(
    unclampedYaw,
    unclampedPitch,
    extent,
  );
  if (center.yaw !== unclampedYaw) yawVelocity = 0;
  if (center.pitch !== unclampedPitch) pitchVelocity = 0;

  const fovResponseSeconds = smoothingSeconds * 1.6;
  const fovError = target.fovDegrees - current.fovDegrees;
  const desiredFovVelocity = Math.max(
    -config.maxPanSpeedDegrees,
    Math.min(config.maxPanSpeedDegrees, fovError / fovResponseSeconds),
  );
  const maxFovVelocityDelta = Math.max(1, config.maxZoomAccelerationDegrees) * elapsed;
  const fovVelocityDelta = Math.max(
    -maxFovVelocityDelta,
    Math.min(maxFovVelocityDelta, desiredFovVelocity - currentVelocity.fovDegrees),
  );
  let fovVelocity = currentVelocity.fovDegrees + fovVelocityDelta;
  let fovStep = fovVelocity * elapsed;
  if (Math.sign(fovError) !== Math.sign(fovError - fovStep)) {
    fovStep = fovError;
    fovVelocity = 0;
  }
  return {
    pose: {
      ...center,
      fovDegrees: clampFov(current.fovDegrees + fovStep),
    },
    velocity: { yaw: yawVelocity, pitch: pitchVelocity, fovDegrees: fovVelocity },
  };
}
