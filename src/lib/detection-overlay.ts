import {
  detectionAreaStatus,
  type ActionRegionDetectionState,
  type DetectionAreaHistoryTimeline,
} from './auto-camera';
import {
  panoramaToNormalized,
  type MetadataTimeline,
  type PanoramaPoint,
  type WebDetection,
} from './metadata';
import {
  DEFAULT_FOV_DEGREES,
  clampFov,
  projectPanoramaPoint,
  type PerspectiveCamera,
} from './perspective';
import { canvasPixelRatio } from './render-resolution';

const INCLUDED_DETECTION_COLOR = '#57d6ff';
const PENDING_DETECTION_COLOR = '#ffb84d';
const EXCLUDED_DETECTION_COLOR = '#8d958b';

/**
 * Scale camera-normalized detection boxes with perspective zoom.
 *
 * Detection centers have panorama coordinates, but current sidecars do not include projected
 * box corners. Preserve their existing size at the default FOV and apply the same tangent-based
 * scale used by the perspective projection as the operator zooms in or out.
 */
export function detectionBoxFovScale(fovDegrees: number): number {
  const referenceTangent = Math.tan((DEFAULT_FOV_DEGREES * Math.PI) / 360);
  const visibleTangent = Math.tan((clampFov(fovDegrees) * Math.PI) / 360);
  return referenceTangent / visibleTangent;
}

/** Drawing state for the visible panorama or perspective camera. */
export interface DetectionOverlayView {
  width: number;
  height: number;
  zoom: number;
  perspectiveMode: boolean;
  visibleCamera: PerspectiveCamera;
}

/** Draw confidence boxes and automatic-camera acceptance state over a video frame. */
export function drawDetectionOverlay(
  canvas: HTMLCanvasElement,
  detections: WebDetection[],
  metadata: MetadataTimeline | null,
  areaHistory: DetectionAreaHistoryTimeline | null,
  minimumAreaHistorySeconds: number,
  actionStateByDetection: Map<WebDetection, ActionRegionDetectionState>,
  view: DetectionOverlayView,
): void {
  const { width, height } = view;
  if (!canvas || width <= 0 || height <= 0) {
    return;
  }
  const pixelRatio = canvasPixelRatio(width, height, window.devicePixelRatio || 1);
  const bitmapWidth = Math.max(1, Math.round(width * pixelRatio));
  const bitmapHeight = Math.max(1, Math.round(height * pixelRatio));
  if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
    canvas.width = bitmapWidth;
    canvas.height = bitmapHeight;
  }

  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!metadata) {
    return;
  }

  const projectPoint = (point: PanoramaPoint) => {
    const normalized = view.perspectiveMode
      ? projectPanoramaPoint(point, view.visibleCamera)
      : panoramaToNormalized(point, metadata.manifest.panorama_extent);
    return normalized ? { x: normalized.x * width, y: normalized.y * height } : null;
  };
  const overlays = detections.flatMap((detection) => {
    if (!detection.panorama) {
      return [];
    }
    const position = projectPoint(detection.panorama);
    if (!position) {
      return [];
    }
    const areaStatus = detectionAreaStatus(
      detection,
      areaHistory,
      minimumAreaHistorySeconds,
    );
    const actionState = actionStateByDetection.get(detection) ?? 'excluded';
    return [{ detection, position, areaStatus, actionState }];
  });
  const boxFovScale = view.perspectiveMode
    ? detectionBoxFovScale(view.visibleCamera.fovDegrees)
    : 1;

  for (const { detection, position, areaStatus, actionState } of overlays) {
    // Exported box sizes remain camera-normalized until projected corners join the sidecar.
    const boxWidth = Math.max(
      10 / view.zoom,
      Math.abs(detection.bbox.width) * width * boxFovScale,
    );
    const boxHeight = Math.max(
      10 / view.zoom,
      Math.abs(detection.bbox.height) * height * boxFovScale,
    );
    const left = position.x - boxWidth / 2;
    const top = position.y - boxHeight / 2;
    const color =
      actionState === 'included'
        ? INCLUDED_DETECTION_COLOR
        : actionState === 'pending'
          ? PENDING_DETECTION_COLOR
          : EXCLUDED_DETECTION_COLOR;

    context.save();
    context.strokeStyle = color;
    context.lineWidth = 2 / view.zoom;
    context.setLineDash(
      actionState === 'included'
        ? []
        : actionState === 'pending'
          ? [6 / view.zoom, 4 / view.zoom]
          : [2 / view.zoom, 4 / view.zoom],
    );
    context.strokeRect(left, top, boxWidth, boxHeight);
    context.restore();

    const confidence = `${Math.round(detection.confidence * 100)}%`;
    const label =
      actionState === 'included'
        ? confidence
        : actionState === 'pending'
          ? `NEW  ${areaStatus.remainingSeconds.toFixed(1)}s  ${confidence}`
          : `OUTSIDE ACTION  ${confidence}`;
    const fontSize = 12 / view.zoom;
    const labelPadding = 5 / view.zoom;
    context.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    const labelWidth = context.measureText(label).width + labelPadding * 2;
    const labelHeight = fontSize + labelPadding * 1.5;
    const labelLeft = Math.min(Math.max(0, width - labelWidth), Math.max(0, left));
    const labelTop = Math.max(0, top - labelHeight);
    context.fillStyle = 'rgba(13, 15, 13, 0.88)';
    context.fillRect(labelLeft, labelTop, labelWidth, labelHeight);
    context.fillStyle = color;
    context.textBaseline = 'middle';
    context.fillText(label, labelLeft + labelPadding, labelTop + labelHeight / 2);
  }
}
