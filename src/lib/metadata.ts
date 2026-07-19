export interface PanoramaExtent {
  yaw_min: number;
  yaw_max: number;
  pitch_min: number;
  pitch_max: number;
}

export interface PanoramaPoint {
  yaw: number;
  pitch: number;
}

export interface RigOrientation {
  space: 'reco_framing_radians';
  tilt: number;
  roll: number;
}

export interface DetectionBox {
  center_x: number;
  center_y: number;
  width: number;
  height: number;
}

export interface WebDetection {
  camera: unknown;
  class_id: number;
  confidence: number;
  bbox: DetectionBox;
  panorama: PanoramaPoint | null;
}

export interface DetectionSample {
  frameIndex: number;
  detections: WebDetection[];
}

export type WebTrackState = 'tracking' | 'coasting' | 'lost';

export interface WebTrack {
  id: number;
  class_id: number;
  state: WebTrackState;
  confidence: number;
  age_frames: number;
  origin: unknown;
  panorama: PanoramaPoint;
}

export interface TrackSample {
  frameIndex: number;
  timestampMs: number;
  players: WebTrack[];
  ball: WebTrack | null;
}

export interface WebManifest {
  schema_version: number;
  export_mode: string;
  video: {
    path: string;
    width: number;
    height: number;
    codec: string;
    quality: string;
  };
  roi: {
    space: string;
    points: Array<[number, number]>;
  };
  panorama_extent: PanoramaExtent;
  rig_orientation: RigOrientation;
  video_projection: string;
  video_y_axis: string;
  detection_interval: number;
  tracking_mode: string;
}

export interface MetadataTimeline {
  manifest: WebManifest;
  detectionSamples: DetectionSample[];
  trackSamples: TrackSample[];
  lastFrameIndex: number;
}

export class MetadataParseError extends Error {
  constructor(message: string, line?: number) {
    super(line === undefined ? message : `Line ${line}: ${message}`);
    this.name = 'MetadataParseError';
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, path: string, line: number): JsonObject {
  if (!isObject(value)) {
    throw new MetadataParseError(`${path} must be an object`, line);
  }
  return value;
}

function numberAt(value: unknown, path: string, line: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MetadataParseError(`${path} must be a finite number`, line);
  }
  return value;
}

function integerAt(value: unknown, path: string, line: number): number {
  const number = numberAt(value, path, line);
  if (!Number.isInteger(number) || number < 0) {
    throw new MetadataParseError(`${path} must be a non-negative integer`, line);
  }
  return number;
}

function positiveIntegerAt(value: unknown, path: string, line: number): number {
  const number = integerAt(value, path, line);
  if (number === 0) {
    throw new MetadataParseError(`${path} must be greater than zero`, line);
  }
  return number;
}

function stringAt(value: unknown, path: string, line: number): string {
  if (typeof value !== 'string') {
    throw new MetadataParseError(`${path} must be a string`, line);
  }
  return value;
}

function parseExtent(value: unknown, line: number): PanoramaExtent {
  const extent = objectAt(value, 'manifest.panorama_extent', line);
  const parsed = {
    yaw_min: numberAt(extent.yaw_min, 'manifest.panorama_extent.yaw_min', line),
    yaw_max: numberAt(extent.yaw_max, 'manifest.panorama_extent.yaw_max', line),
    pitch_min: numberAt(extent.pitch_min, 'manifest.panorama_extent.pitch_min', line),
    pitch_max: numberAt(extent.pitch_max, 'manifest.panorama_extent.pitch_max', line),
  };

  if (parsed.yaw_max <= parsed.yaw_min || parsed.pitch_max <= parsed.pitch_min) {
    throw new MetadataParseError('manifest.panorama_extent must have positive spans', line);
  }
  return parsed;
}

function parseRoi(value: unknown, line: number): WebManifest['roi'] {
  const roi = objectAt(value, 'manifest.roi', line);
  if (!Array.isArray(roi.points)) {
    throw new MetadataParseError('manifest.roi.points must be an array', line);
  }

  const points = roi.points.map((point, index): [number, number] => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new MetadataParseError(`manifest.roi.points[${index}] must be [yaw, pitch]`, line);
    }
    return [
      numberAt(point[0], `manifest.roi.points[${index}][0]`, line),
      numberAt(point[1], `manifest.roi.points[${index}][1]`, line),
    ];
  });

  return {
    space: stringAt(roi.space, 'manifest.roi.space', line),
    points,
  };
}

function parseRigOrientation(
  value: unknown,
  schemaVersion: number,
  line: number,
): RigOrientation {
  if (value === undefined && schemaVersion === 2) {
    return { space: 'reco_framing_radians', tilt: 0, roll: 0 };
  }

  const orientation = objectAt(value, 'manifest.rig_orientation', line);
  const space = stringAt(orientation.space, 'manifest.rig_orientation.space', line);
  if (space !== 'reco_framing_radians') {
    throw new MetadataParseError(`unsupported rig orientation space: ${space}`, line);
  }
  return {
    space,
    tilt: numberAt(orientation.tilt, 'manifest.rig_orientation.tilt', line),
    roll: numberAt(orientation.roll, 'manifest.rig_orientation.roll', line),
  };
}

function parseManifest(value: unknown, line: number): WebManifest {
  const manifest = objectAt(value, 'manifest', line);
  const video = objectAt(manifest.video, 'manifest.video', line);
  const schemaVersion = positiveIntegerAt(manifest.schema_version, 'manifest.schema_version', line);
  const exportMode = stringAt(manifest.export_mode, 'manifest.export_mode', line);
  const projection = stringAt(manifest.video_projection, 'manifest.video_projection', line);
  const yAxis = stringAt(manifest.video_y_axis, 'manifest.video_y_axis', line);

  if (schemaVersion < 2 || exportMode !== 'web_panorama') {
    throw new MetadataParseError('metadata is not a Reco web panorama export (schema 2+)', line);
  }
  if (projection !== 'angular_rectangular' || yAxis !== 'pitch_max_to_pitch_min') {
    throw new MetadataParseError(`unsupported panorama projection: ${projection}/${yAxis}`, line);
  }

  return {
    schema_version: schemaVersion,
    export_mode: exportMode,
    video: {
      path: stringAt(video.path, 'manifest.video.path', line),
      width: positiveIntegerAt(video.width, 'manifest.video.width', line),
      height: positiveIntegerAt(video.height, 'manifest.video.height', line),
      codec: stringAt(video.codec, 'manifest.video.codec', line),
      quality: stringAt(video.quality, 'manifest.video.quality', line),
    },
    roi: parseRoi(manifest.roi, line),
    panorama_extent: parseExtent(manifest.panorama_extent, line),
    rig_orientation: parseRigOrientation(manifest.rig_orientation, schemaVersion, line),
    video_projection: projection,
    video_y_axis: yAxis,
    detection_interval: positiveIntegerAt(
      manifest.detection_interval,
      'manifest.detection_interval',
      line,
    ),
    tracking_mode: stringAt(manifest.tracking_mode, 'manifest.tracking_mode', line),
  };
}

function parsePanorama(value: unknown, path: string, line: number): PanoramaPoint | null {
  if (value === null || value === undefined) {
    return null;
  }
  const point = objectAt(value, path, line);
  return {
    yaw: numberAt(point.yaw, `${path}.yaw`, line),
    pitch: numberAt(point.pitch, `${path}.pitch`, line),
  };
}

function parseDetection(value: unknown, index: number, line: number): WebDetection {
  const path = `detections[${index}]`;
  const detection = objectAt(value, path, line);
  const bbox = objectAt(detection.bbox, `${path}.bbox`, line);

  return {
    camera: detection.camera,
    class_id: integerAt(detection.class_id, `${path}.class_id`, line),
    confidence: numberAt(detection.confidence, `${path}.confidence`, line),
    bbox: {
      center_x: numberAt(bbox.center_x, `${path}.bbox.center_x`, line),
      center_y: numberAt(bbox.center_y, `${path}.bbox.center_y`, line),
      width: numberAt(bbox.width, `${path}.bbox.width`, line),
      height: numberAt(bbox.height, `${path}.bbox.height`, line),
    },
    panorama: parsePanorama(detection.panorama, `${path}.panorama`, line),
  };
}

function parseDetectionRecord(record: JsonObject, line: number): DetectionSample {
  if (!Array.isArray(record.detections)) {
    throw new MetadataParseError('detections must be an array', line);
  }
  return {
    frameIndex: integerAt(record.frame_index, 'frame_index', line),
    detections: record.detections.map((detection, index) => parseDetection(detection, index, line)),
  };
}

function parseTrack(value: unknown, path: string, line: number): WebTrack {
  const track = objectAt(value, path, line);
  const state = stringAt(track.state, `${path}.state`, line);
  if (state !== 'tracking' && state !== 'coasting' && state !== 'lost') {
    throw new MetadataParseError(`${path}.state is unsupported: ${state}`, line);
  }
  const panorama = parsePanorama(track.panorama, `${path}.panorama`, line);
  if (!panorama) {
    throw new MetadataParseError(`${path}.panorama is required`, line);
  }
  return {
    id: integerAt(track.id, `${path}.id`, line),
    class_id: integerAt(track.class_id, `${path}.class_id`, line),
    state,
    confidence: numberAt(track.confidence, `${path}.confidence`, line),
    age_frames: integerAt(track.age_frames, `${path}.age_frames`, line),
    origin: track.origin,
    panorama,
  };
}

function parseTrackRecord(record: JsonObject, line: number): TrackSample {
  if (!Array.isArray(record.players)) {
    throw new MetadataParseError('players must be an array', line);
  }
  return {
    frameIndex: integerAt(record.frame_index, 'frame_index', line),
    timestampMs: numberAt(record.timestamp_ms, 'timestamp_ms', line),
    players: record.players.map((player, index) => parseTrack(player, `players[${index}]`, line)),
    ball:
      record.ball === null || record.ball === undefined
        ? null
        : parseTrack(record.ball, 'ball', line),
  };
}

export function parseMetadataJsonl(text: string): MetadataTimeline {
  let manifest: WebManifest | null = null;
  const detectionSamples: DetectionSample[] = [];
  const trackSamples: TrackSample[] = [];
  let lastFrameIndex = 0;

  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid JSON';
      throw new MetadataParseError(detail, lineNumber);
    }

    const record = objectAt(value, 'record', lineNumber);
    const kind = stringAt(record.kind, 'kind', lineNumber);
    if (kind === 'manifest') {
      if (manifest) {
        throw new MetadataParseError('metadata contains more than one manifest', lineNumber);
      }
      manifest = parseManifest(record.manifest, lineNumber);
      continue;
    }

    if ('frame_index' in record) {
      lastFrameIndex = Math.max(
        lastFrameIndex,
        integerAt(record.frame_index, 'frame_index', lineNumber),
      );
    }
    if (kind === 'detections') {
      detectionSamples.push(parseDetectionRecord(record, lineNumber));
    } else if (kind === 'tracks') {
      trackSamples.push(parseTrackRecord(record, lineNumber));
    }
  }

  if (!manifest) {
    throw new MetadataParseError('metadata manifest is missing');
  }

  detectionSamples.sort((left, right) => left.frameIndex - right.frameIndex);
  trackSamples.sort((left, right) => left.frameIndex - right.frameIndex);
  return { manifest, detectionSamples, trackSamples, lastFrameIndex };
}

export function frameIndexAtTime(
  currentTime: number,
  duration: number,
  lastFrameIndex: number,
): number {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  const frameCount = lastFrameIndex + 1;
  const frame = Math.floor((Math.max(0, currentTime) / duration) * frameCount);
  return Math.min(lastFrameIndex, Math.max(0, frame));
}

/** Return the media time at the center of one metadata frame. */
export function timeAtFrameIndex(
  frameIndex: number,
  duration: number,
  lastFrameIndex: number,
): number {
  if (
    !Number.isFinite(frameIndex) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isInteger(lastFrameIndex) ||
    lastFrameIndex < 0
  ) {
    return 0;
  }
  const frameCount = lastFrameIndex + 1;
  const frame = Math.min(lastFrameIndex, Math.max(0, Math.round(frameIndex)));
  return ((frame + 0.5) / frameCount) * duration;
}

export function detectionsAtFrame(
  timeline: MetadataTimeline,
  frameIndex: number,
): WebDetection[] {
  const samples = timeline.detectionSamples;
  let low = 0;
  let high = samples.length - 1;
  let match = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].frameIndex <= frameIndex) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (match < 0) {
    return [];
  }

  const sample = samples[match];
  if (frameIndex - sample.frameIndex > timeline.manifest.detection_interval) {
    return [];
  }
  return sample.detections;
}

export function detectionSamplesInFrameRange(
  timeline: MetadataTimeline,
  startFrameExclusive: number,
  endFrameInclusive: number,
): DetectionSample[] {
  if (
    !Number.isFinite(startFrameExclusive) ||
    !Number.isFinite(endFrameInclusive) ||
    endFrameInclusive <= startFrameExclusive
  ) {
    return [];
  }

  const samples = timeline.detectionSamples;
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].frameIndex <= startFrameExclusive) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const startIndex = low;

  high = samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].frameIndex <= endFrameInclusive) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return samples.slice(startIndex, low);
}

export function panoramaToNormalized(
  point: PanoramaPoint,
  extent: PanoramaExtent,
): { x: number; y: number } | null {
  const yawSpan = extent.yaw_max - extent.yaw_min;
  const pitchSpan = extent.pitch_max - extent.pitch_min;
  if (yawSpan <= 0 || pitchSpan <= 0) {
    return null;
  }

  const x = (point.yaw - extent.yaw_min) / yawSpan;
  const y = (extent.pitch_max - point.pitch) / pitchSpan;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  return { x, y };
}
