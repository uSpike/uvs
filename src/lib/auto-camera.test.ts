import { describe, expect, it } from 'vitest';
import type { MetadataTimeline, WebDetection, WebTrack } from './metadata';
import {
  DEFAULT_AUTO_CAMERA_CONFIG,
  autoCameraTarget,
  autoCameraSubjectsForDetections,
  buildDetectionAreaHistoryTimeline,
  buildPlayerTrackTimeline,
  detectionAreaStatus,
  detectionsWithEstablishedArea,
  predictedPlayersAtTime,
  requiredAutoCameraFov,
  selectActionRegionDetections,
  stepAutoCamera,
  trackObservationsAtFrame,
  type PredictedPlayer,
} from './auto-camera';
import { projectPanoramaPoint } from './perspective';

const extent = {
  yaw_min: -1.5,
  yaw_max: 1.5,
  pitch_min: -0.5,
  pitch_max: 0.5,
};

function detection(yaw: number, pitch = 0): WebDetection {
  return {
    camera: 'left',
    class_id: 0,
    confidence: 0.9,
    bbox: { center_x: 0.5, center_y: 0.5, width: 0.08, height: 0.18 },
    panorama: { yaw, pitch },
  };
}

function track(id: number, yaw: number, ageFrames: number): WebTrack {
  return {
    id,
    class_id: 0,
    state: 'tracking',
    confidence: 0.9,
    age_frames: ageFrames,
    origin: 'left',
    panorama: { yaw, pitch: 0 },
  };
}

function timeline(overrides: Partial<MetadataTimeline> = {}): MetadataTimeline {
  return {
    manifest: {
      schema_version: 3,
      export_mode: 'web_panorama',
      video: {
        path: 'match.mp4',
        width: 3840,
        height: 1080,
        codec: 'h264',
        quality: 'balanced',
      },
      roi: { space: 'panorama_yaw_pitch_radians', points: [] },
      panorama_extent: extent,
      rig_orientation: { space: 'reco_framing_radians', tilt: 0, roll: 0 },
      video_projection: 'angular_rectangular',
      video_y_axis: 'pitch_max_to_pitch_min',
      detection_interval: 10,
      tracking_mode: 'field',
    },
    detectionSamples: [],
    trackSamples: [],
    lastFrameIndex: 99,
    ...overrides,
  };
}

describe('player track timeline', () => {
  it('prefers exported player IDs and predicts their momentum', () => {
    const detections = [0, 10, 20, 30].map((frameIndex, index) => ({
      frameIndex,
      detections: [detection(index * 0.1)],
    }));
    const metadata = timeline({
      detectionSamples: detections,
      trackSamples: [0, 10, 20, 30].map((frameIndex, index) => ({
        frameIndex,
        timestampMs: frameIndex * 100,
        players: [track(7, index * 0.1, frameIndex)],
        ball: null,
      })),
    });

    const model = buildPlayerTrackTimeline(metadata, 10);
    expect(model?.source).toBe('exported');
    const players = predictedPlayersAtTime(model!, 3, 1.5, 1);
    expect(players).toHaveLength(1);
    expect(players[0].trackId).toBe(7);
    expect(players[0].momentumReliable).toBe(true);
    expect(players[0].speedDegreesPerSecond).toBeCloseTo(5.73, 1);
    expect(players[0].predictedPoint.yaw).toBeCloseTo(0.4, 6);
    expect(trackObservationsAtFrame(model!, 30)[0].detection).toBe(detections[3].detections[0]);
  });

  it('associates detection-only samples and withholds short-lived candidates', () => {
    const persistent = [0, 10, 20, 30].map((frameIndex, index) => ({
      frameIndex,
      detections: [
        detection(index * 0.05),
        ...(frameIndex === 30 ? [detection(1.1)] : []),
      ],
    }));
    const model = buildPlayerTrackTimeline(
      timeline({ detectionSamples: persistent, lastFrameIndex: 39 }),
      4,
    );

    expect(model?.source).toBe('associated');
    const players = predictedPlayersAtTime(model!, 3, 2, 0);
    expect(players).toHaveLength(1);
    expect(players[0].observedPoint.yaw).toBeCloseTo(0.15, 6);
  });

  it('keeps forward momentum through one noisy track observation', () => {
    const yaws = [0, 0.1, 0.2, 0.08];
    const metadata = timeline({
      detectionSamples: yaws.map((yaw, index) => ({
        frameIndex: index * 10,
        detections: [detection(yaw)],
      })),
      trackSamples: yaws.map((yaw, index) => ({
        frameIndex: index * 10,
        timestampMs: index * 1000,
        players: [track(7, yaw, index * 10)],
        ball: null,
      })),
      lastFrameIndex: 39,
    });

    const model = buildPlayerTrackTimeline(metadata, 4)!;
    const [immature] = predictedPlayersAtTime(model, 2, 0, 1);
    expect(immature.momentumReliable).toBe(false);
    expect(immature.predictedPoint).toEqual(immature.observedPoint);

    const [player] = predictedPlayersAtTime(model, 3, 0, 1);
    expect(player.observedPoint.yaw).toBeCloseTo(0.08, 6);
    expect(player.momentumReliable).toBe(true);
    expect(player.speedDegreesPerSecond).toBeCloseTo(5.73, 1);
    expect(player.predictedPoint.yaw).toBeGreaterThan(player.observedPoint.yaw);
  });

  it('caps momentum lead from fast sparse tracks', () => {
    const yaws = [-0.6, -0.3, 0, 0.3];
    const metadata = timeline({
      detectionSamples: yaws.map((yaw, index) => ({
        frameIndex: index * 10,
        detections: [detection(yaw)],
      })),
      trackSamples: yaws.map((yaw, index) => ({
        frameIndex: index * 10,
        timestampMs: index * 1000,
        players: [track(7, yaw, index * 10)],
        ball: null,
      })),
      lastFrameIndex: 39,
    });

    const model = buildPlayerTrackTimeline(metadata, 4)!;
    const [player] = predictedPlayersAtTime(model, 3, 0, 3);
    expect(player.momentumReliable).toBe(true);
    expect(player.predictedPoint.yaw - player.observedPoint.yaw).toBeLessThanOrEqual(
      (15 * Math.PI) / 180 + 1e-8,
    );
  });
});

describe('detection area history', () => {
  it('records persistence before an occupied area becomes established', () => {
    const detectionSamples = [0, 10, 20, 30, 40, 50, 60].map((frameIndex) => ({
      frameIndex,
      detections: [
        detection(0),
        ...(frameIndex >= 10 ? [detection(1)] : []),
      ],
    }));
    const model = buildDetectionAreaHistoryTimeline(
      timeline({ detectionSamples, lastFrameIndex: 69 }),
      7,
    )!;

    expect(detectionsWithEstablishedArea(detectionSamples[0].detections, model, 5)).toHaveLength(0);
    expect(detectionsWithEstablishedArea(detectionSamples[1].detections, model, 5)).toHaveLength(0);
    expect(detectionsWithEstablishedArea(detectionSamples[5].detections, model, 5)).toHaveLength(1);
    expect(detectionsWithEstablishedArea(detectionSamples[6].detections, model, 5)).toHaveLength(2);

    const initial = detectionAreaStatus(detectionSamples[0].detections[0], model, 5);
    const pending = detectionAreaStatus(detectionSamples[1].detections[1], model, 5);
    const included = detectionAreaStatus(detectionSamples[6].detections[1], model, 5);
    expect(initial).toEqual({
      included: false,
      historySeconds: 0,
      remainingSeconds: 5,
    });
    expect(pending).toEqual({ included: false, historySeconds: 0, remainingSeconds: 5 });
    expect(included).toEqual({ included: true, historySeconds: 5, remainingSeconds: 0 });
  });

  it('restarts the delay when a new area disappears for several samples', () => {
    const detectionSamples = [0, 10, 20, 30, 40, 50].map((frameIndex) => ({
      frameIndex,
      detections: [
        detection(0),
        ...([10, 20, 50].includes(frameIndex) ? [detection(1)] : []),
      ],
    }));
    const model = buildDetectionAreaHistoryTimeline(
      timeline({ detectionSamples, lastFrameIndex: 59 }),
      6,
    )!;

    expect(detectionsWithEstablishedArea(detectionSamples[5].detections, model, 2)).toHaveLength(1);
  });

  it('trusts both sides at a pull and carries that trust through fast sparse motion', () => {
    const pullLeft = detection(-0.7);
    const pullRight = detection(0.7);
    const movedLeft = detection(-0.45);
    const movedRight = detection(0.45);
    const newSidelineArea = detection(1.4);
    const detectionSamples = [
      { frameIndex: 0, detections: [detection(0)] },
      { frameIndex: 10, detections: [pullLeft, pullRight] },
      { frameIndex: 20, detections: [movedLeft, movedRight, newSidelineArea] },
    ];
    const model = buildDetectionAreaHistoryTimeline(
      timeline({ detectionSamples, lastFrameIndex: 39 }),
      4,
      [1.5],
    )!;

    expect(detectionAreaStatus(pullLeft, model, 5).historySeconds).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(detectionAreaStatus(movedLeft, model, 5).historySeconds).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(detectionAreaStatus(movedRight, model, 5).historySeconds).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(detectionAreaStatus(newSidelineArea, model, 5)).toEqual({
      included: false,
      historySeconds: 0,
      remainingSeconds: 5,
    });

    const selection = selectActionRegionDetections(
      detectionSamples[2].detections,
      model,
      5,
      { yaw: 0, pitch: 0 },
      4,
    );
    expect(selection.included).toEqual([movedLeft, movedRight]);
    expect(selection.stateByDetection.get(newSidelineArea)).toBe('pending');
  });

  it('replaces the trusted detection set at every pull', () => {
    const firstPull = detection(-0.7);
    const laterArea = detection(1.2);
    const secondPull = detection(1.2);
    const detectionSamples = [
      { frameIndex: 10, detections: [firstPull] },
      { frameIndex: 20, detections: [laterArea] },
      { frameIndex: 30, detections: [secondPull] },
    ];
    const model = buildDetectionAreaHistoryTimeline(
      timeline({ detectionSamples, lastFrameIndex: 39 }),
      4,
      [1, 3],
    )!;

    expect(detectionAreaStatus(laterArea, model, 5).included).toBe(false);
    expect(detectionAreaStatus(secondPull, model, 5).historySeconds).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('keeps a fast pull-baseline runner trusted near a newer untrusted area', () => {
    const pullRunner = detection(0);
    const movedRunner = detection(0.2);
    const newArea = detection(0.7);
    const runnerNearNewArea = detection(0.55);
    const detectionSamples = [
      { frameIndex: 10, detections: [pullRunner] },
      { frameIndex: 20, detections: [movedRunner, newArea] },
      { frameIndex: 30, detections: [runnerNearNewArea] },
    ];
    const model = buildDetectionAreaHistoryTimeline(
      timeline({ detectionSamples, lastFrameIndex: 39 }),
      4,
      [1],
    )!;

    expect(detectionAreaStatus(newArea, model, 5).included).toBe(false);
    expect(detectionAreaStatus(runnerNearNewArea, model, 5).historySeconds).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('keeps separate trusted trails when pull-baseline players spread apart', () => {
    const left = detection(-0.5);
    const right = detection(0.5);
    const detectionSamples = [
      { frameIndex: 10, detections: [detection(0)] },
      { frameIndex: 20, detections: [detection(-0.2), detection(0.2)] },
      { frameIndex: 30, detections: [left, right] },
    ];
    const model = buildDetectionAreaHistoryTimeline(
      timeline({ detectionSamples, lastFrameIndex: 39 }),
      4,
      [1],
    )!;

    expect(detectionAreaStatus(left, model, 5).historySeconds).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(detectionAreaStatus(right, model, 5).historySeconds).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('keeps a persistent remote area outside the connected action region', () => {
    const actionLeft = detection(-0.08);
    const actionRight = detection(0.1);
    const newActionDetection = detection(0.2);
    const sideline = detection(0.9);
    const areaHistory = {
      historyByDetection: new Map<WebDetection, number>([
        [actionLeft, 8],
        [actionRight, 8],
        [newActionDetection, 0],
        [sideline, 20],
      ]),
    };

    const selection = selectActionRegionDetections(
      [actionLeft, actionRight, newActionDetection, sideline],
      areaHistory,
      5,
      { yaw: 0, pitch: 0 },
      16,
    );

    expect(selection.included).toEqual([actionLeft, actionRight, newActionDetection]);
    expect(selection.stateByDetection.get(newActionDetection)).toBe('included');
    expect(selection.stateByDetection.get(sideline)).toBe('excluded');
  });

  it('keeps a disconnected new area pending instead of using the camera FOV', () => {
    const action = detection(0);
    const sideline = detection(0.8);
    const areaHistory = {
      historyByDetection: new Map<WebDetection, number>([
        [action, 8],
        [sideline, 1],
      ]),
    };

    const selection = selectActionRegionDetections(
      [action, sideline],
      areaHistory,
      5,
      { yaw: 0, pitch: 0 },
      16,
    );

    expect(selection.included).toEqual([action]);
    expect(selection.stateByDetection.get(sideline)).toBe('pending');
  });

  it('does not let a new detection closer to the camera replace established action', () => {
    const sideline = detection(0);
    const actionLeft = detection(0.35);
    const actionRight = detection(0.43);
    const areaHistory = {
      historyByDetection: new Map<WebDetection, number>([
        [sideline, 0],
        [actionLeft, 8],
        [actionRight, 8],
      ]),
    };

    const selection = selectActionRegionDetections(
      [sideline, actionLeft, actionRight],
      areaHistory,
      5,
      { yaw: 0, pitch: 0 },
      6,
    );

    expect(selection.included).toEqual([actionLeft, actionRight]);
    expect(selection.stateByDetection.get(sideline)).toBe('pending');
  });

  it('does not impose a player-count limit on one connected action component', () => {
    const detections = Array.from({ length: 24 }, (_, index) => detection(-0.46 + index * 0.04));
    const areaHistory = {
      historyByDetection: new Map(detections.map((item) => [item, 8])),
    };

    const selection = selectActionRegionDetections(
      detections,
      areaHistory,
      5,
      { yaw: 0, pitch: 0 },
      8,
    );

    expect(selection.included).toHaveLength(24);
  });
});

describe('automatic framing', () => {
  function player(id: number, yaw: number, pitch: number): PredictedPlayer {
    const box = detection(yaw, pitch);
    return {
      trackId: id,
      classId: 0,
      observedPoint: { yaw, pitch },
      predictedPoint: { yaw, pitch },
      velocity: { yaw: 0, pitch: 0 },
      speedDegreesPerSecond: 0,
      momentumReliable: true,
      historySeconds: 3,
      state: 'tracking',
      confidence: 0.9,
      detection: box,
    };
  }

  it('frames every current detection without track data', () => {
    const detections = [detection(-0.6), detection(0.6)];
    const subjects = autoCameraSubjectsForDetections(detections);
    expect(subjects).toHaveLength(2);
    expect(subjects[0].predictedPoint).toEqual(detections[0].panorama);
    expect(subjects[1].predictedPoint).toEqual(detections[1].panorama);

    const target = autoCameraTarget(subjects, extent, 16 / 9, 0, 0, 35, 12)!;
    expect(target.yaw).toBeCloseTo(0, 6);
    for (const subject of subjects) {
      const projected = projectPanoramaPoint(subject.observedPoint, {
        ...target,
        aspect: 16 / 9,
        tilt: 0,
        roll: 0,
      });
      expect(projected).not.toBeNull();
      expect(projected!.x).toBeGreaterThan(0.12);
      expect(projected!.x).toBeLessThan(0.88);
    }
  });

  it('chooses a FOV that contains every predicted player', () => {
    const players = [player(1, -0.42, -0.08), player(2, 0.48, 0.12)];
    const target = autoCameraTarget(players, extent, 16 / 9, 0.16, -0.05, 35, 12);
    expect(target).not.toBeNull();
    for (const item of players) {
      const projected = projectPanoramaPoint(item.predictedPoint, {
        ...target!,
        aspect: 16 / 9,
        tilt: 0.16,
        roll: -0.05,
      });
      expect(projected).not.toBeNull();
      expect(projected!.x).toBeGreaterThan(0.12);
      expect(projected!.x).toBeLessThan(0.88);
      expect(projected!.y).toBeGreaterThan(0.12);
      expect(projected!.y).toBeLessThan(0.88);
    }
  });

  it('widens the shot as frame padding increases', () => {
    const players = [player(1, -0.42, 0), player(2, 0.48, 0)];
    const tight = autoCameraTarget(players, extent, 16 / 9, 0, 0, 20, 0)!;
    const loose = autoCameraTarget(players, extent, 16 / 9, 0, 0, 20, 24)!;

    expect(loose.fovDegrees).toBeGreaterThan(tight.fovDegrees);
  });

  it('limits camera motion while accelerating smoothly toward the target', () => {
    const next = stepAutoCamera(
      { yaw: 0, pitch: 0, fovDegrees: 75 },
      { yaw: 1, pitch: 0.5, fovDegrees: 40 },
      { yaw: 0, pitch: 0, fovDegrees: 0 },
      0.1,
      { ...DEFAULT_AUTO_CAMERA_CONFIG, maxPanSpeedDegrees: 30 },
      extent,
    );
    expect(Math.hypot(next.pose.yaw, next.pose.pitch)).toBeLessThanOrEqual(
      (30 * Math.PI) / 1800 + 1e-8,
    );
    expect(next.pose.fovDegrees).toBeGreaterThanOrEqual(72);
  });

  it('bounds pan and zoom acceleration when framing changes abruptly', () => {
    const next = stepAutoCamera(
      { yaw: 0, pitch: 0, fovDegrees: 50 },
      { yaw: 1, pitch: 0.5, fovDegrees: 110 },
      { yaw: 0, pitch: 0, fovDegrees: 0 },
      0.1,
      {
        ...DEFAULT_AUTO_CAMERA_CONFIG,
        maxPanAccelerationDegrees: 10,
        maxZoomAccelerationDegrees: 6,
      },
      extent,
    );

    const panVelocityDegrees =
      (Math.hypot(next.velocity.yaw, next.velocity.pitch) * 180) / Math.PI;
    expect(panVelocityDegrees).toBeLessThanOrEqual(1 + 1e-8);
    expect(Math.abs(next.velocity.fovDegrees)).toBeLessThanOrEqual(0.6 + 1e-8);
    expect(Math.hypot(next.pose.yaw, next.pose.pitch)).toBeLessThanOrEqual(
      (0.1 * Math.PI) / 180 + 1e-8,
    );
    expect(next.pose.fovDegrees - 50).toBeLessThanOrEqual(0.06 + 1e-8);
  });

  it('preserves pan momentum when a noisy target briefly reverses', () => {
    let pose = { yaw: 0, pitch: 0, fovDegrees: 60 };
    let velocity = { yaw: 0, pitch: 0, fovDegrees: 0 };
    for (let index = 0; index < 10; index += 1) {
      const next = stepAutoCamera(
        pose,
        { yaw: 0.8, pitch: 0, fovDegrees: 60 },
        velocity,
        0.1,
        DEFAULT_AUTO_CAMERA_CONFIG,
        extent,
      );
      pose = next.pose;
      velocity = next.velocity;
    }
    const reversed = stepAutoCamera(
      pose,
      { yaw: -0.8, pitch: 0, fovDegrees: 60 },
      velocity,
      0.1,
      DEFAULT_AUTO_CAMERA_CONFIG,
      extent,
    );
    expect(reversed.velocity.yaw).toBeGreaterThan(0);
    expect(reversed.pose.yaw).toBeGreaterThan(pose.yaw);
  });

  it('widens FOV enough to hold players while the camera center is still moving', () => {
    const players = [player(1, -0.5, -0.05), player(2, 0.55, 0.08)];
    const liveCenter = { yaw: -0.2, pitch: 0 };
    const liveFov = requiredAutoCameraFov(players, liveCenter, 16 / 9, 0.12, 0.04, 35, 12);
    expect(liveFov).toBeGreaterThan(35);
    for (const item of players) {
      const projected = projectPanoramaPoint(item.predictedPoint, {
        ...liveCenter,
        fovDegrees: liveFov,
        aspect: 16 / 9,
        tilt: 0.12,
        roll: 0.04,
      });
      expect(projected).not.toBeNull();
      expect(projected!.x - item.detection!.bbox.width / 2).toBeGreaterThanOrEqual(0.119);
      expect(projected!.x + item.detection!.bbox.width / 2).toBeLessThanOrEqual(0.881);
      expect(projected!.y - item.detection!.bbox.height / 2).toBeGreaterThanOrEqual(0.119);
      expect(projected!.y + item.detection!.bbox.height / 2).toBeLessThanOrEqual(0.881);
    }
  });
});
