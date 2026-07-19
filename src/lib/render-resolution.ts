const MAX_CANVAS_PIXEL_RATIO = 1.25;
const MAX_CANVAS_PIXEL_COUNT = 1920 * 1080;

/** Select a canvas scale that preserves detail without exceeding a 1080p render target. */
export function canvasPixelRatio(
  width: number,
  height: number,
  devicePixelRatio: number,
): number {
  const cssPixels = Math.max(1, width) * Math.max(1, height);
  const requestedRatio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const pixelBudgetRatio = Math.sqrt(MAX_CANVAS_PIXEL_COUNT / cssPixels);
  return Math.max(0.25, Math.min(requestedRatio, MAX_CANVAS_PIXEL_RATIO, pixelBudgetRatio));
}
