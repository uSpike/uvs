import { describe, expect, it } from 'vitest';
import {
  MetadataParseError,
  detectionSamplesInFrameRange,
  detectionsAtFrame,
  frameIndexAtTime,
  panoramaToNormalized,
  parseMetadataJsonl,
  timeAtFrameIndex,
} from './metadata';

const manifest = {
  kind: 'manifest',
  manifest: {
    schema_version: 2,
    export_mode: 'web_panorama',
    video: {
      path: 'match.mp4',
      width: 3840,
      height: 1080,
      codec: 'h264',
      quality: 'balanced',
    },
    roi: {
      space: 'panorama_yaw_pitch_radians',
      points: [],
    },
    panorama_extent: {
      yaw_min: -1,
      yaw_max: 1,
      pitch_min: -0.5,
      pitch_max: 0.5,
    },
    video_projection: 'angular_rectangular',
    video_y_axis: 'pitch_max_to_pitch_min',
    detection_interval: 5,
    tracking_mode: 'field',
  },
};

const detection = {
  camera: 'left',
  class_id: 1,
  confidence: 0.91,
  bbox: { center_x: 0.4, center_y: 0.5, width: 0.1, height: 0.2 },
  panorama: { yaw: 0.25, pitch: 0.1 },
};

const track = {
  id: 17,
  class_id: 1,
  state: 'tracking',
  confidence: 0.88,
  age_frames: 42,
  origin: 'left',
  panorama: { yaw: 0.27, pitch: 0.08 },
};

describe('parseMetadataJsonl', () => {
  it('parses manifest and detection records while tracking the exported frame range', () => {
    const timeline = parseMetadataJsonl(
      [
        JSON.stringify(manifest),
        JSON.stringify({ kind: 'detections', frame_index: 5, detections: [detection] }),
        JSON.stringify({
          kind: 'tracks',
          frame_index: 5,
          timestamp_ms: 166.7,
          players: [track],
          ball: null,
        }),
        JSON.stringify({ kind: 'pose_presented', frame_index: 19, pose: {} }),
      ].join('\n'),
    );

    expect(timeline.manifest.video.width).toBe(3840);
    expect(timeline.manifest.rig_orientation).toEqual({
      space: 'reco_framing_radians',
      tilt: 0,
      roll: 0,
    });
    expect(timeline.detectionSamples).toHaveLength(1);
    expect(timeline.trackSamples).toHaveLength(1);
    expect(timeline.trackSamples[0].players[0]).toMatchObject({ id: 17, age_frames: 42 });
    expect(timeline.detectionSamples[0].detections[0].panorama?.yaw).toBe(0.25);
    expect(timeline.lastFrameIndex).toBe(19);
  });

  it('reports malformed JSON with its line number', () => {
    expect(() => parseMetadataJsonl(`${JSON.stringify(manifest)}\n{nope}`)).toThrowError(
      /Line 2/u,
    );
  });

  it('rejects viewport metadata that cannot align to the panorama video', () => {
    const invalid = structuredClone(manifest);
    invalid.manifest.schema_version = 1;
    expect(() => parseMetadataJsonl(JSON.stringify(invalid))).toThrowError(MetadataParseError);
  });

  it('parses the calibrated rig orientation from schema 3 metadata', () => {
    const oriented = {
      ...manifest,
      manifest: {
        ...manifest.manifest,
        schema_version: 3,
        rig_orientation: {
          space: 'reco_framing_radians',
          tilt: 0.14,
          roll: -0.06,
        },
      },
    };

    const timeline = parseMetadataJsonl(JSON.stringify(oriented));
    expect(timeline.manifest.rig_orientation.tilt).toBe(0.14);
    expect(timeline.manifest.rig_orientation.roll).toBe(-0.06);
  });

  it('requires rig orientation in schema 3 metadata', () => {
    const invalid = structuredClone(manifest);
    invalid.manifest.schema_version = 3;
    expect(() => parseMetadataJsonl(JSON.stringify(invalid))).toThrowError(
      /manifest\.rig_orientation/u,
    );
  });
});

describe('timeline helpers', () => {
  it('maps media time across the exported frame range', () => {
    expect(frameIndexAtTime(0, 10, 299)).toBe(0);
    expect(frameIndexAtTime(5, 10, 299)).toBe(150);
    expect(frameIndexAtTime(10, 10, 299)).toBe(299);
    expect(timeAtFrameIndex(0, 10, 299)).toBeCloseTo(1 / 60);
    expect(timeAtFrameIndex(150, 10, 299)).toBeCloseTo(301 / 60);
    expect(frameIndexAtTime(timeAtFrameIndex(150, 10, 299), 10, 299)).toBe(150);
  });

  it('holds a detection sample until the next configured detector interval', () => {
    const timeline = parseMetadataJsonl(
      [
        JSON.stringify(manifest),
        JSON.stringify({ kind: 'detections', frame_index: 5, detections: [detection] }),
      ].join('\n'),
    );

    expect(detectionsAtFrame(timeline, 4)).toEqual([]);
    expect(detectionsAtFrame(timeline, 10)).toHaveLength(1);
    expect(detectionsAtFrame(timeline, 11)).toEqual([]);
  });

  it('selects only future detection samples inside a frame range', () => {
    const timeline = parseMetadataJsonl(
      [
        JSON.stringify(manifest),
        ...[5, 10, 15, 20].map((frameIndex) =>
          JSON.stringify({ kind: 'detections', frame_index: frameIndex, detections: [detection] }),
        ),
      ].join('\n'),
    );

    expect(
      detectionSamplesInFrameRange(timeline, 7, 15).map((sample) => sample.frameIndex),
    ).toEqual([10, 15]);
    expect(detectionSamplesInFrameRange(timeline, 15, 15)).toEqual([]);
  });

  it('uses the panorama top-down pitch convention', () => {
    const extent = manifest.manifest.panorama_extent;
    expect(panoramaToNormalized({ yaw: 0, pitch: 0.5 }, extent)).toEqual({ x: 0.5, y: 0 });
    expect(panoramaToNormalized({ yaw: 0, pitch: -0.5 }, extent)).toEqual({ x: 0.5, y: 1 });
  });
});
