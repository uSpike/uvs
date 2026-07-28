const DOUBLE_TAP_MAX_DELAY_MS = 350;
const DOUBLE_TAP_MAX_DISTANCE_PX = 48;

/** Client-space point reported by a viewer pointer event. */
export interface ViewerPointerPoint {
  clientX: number;
  clientY: number;
}

/** Touch tap retained while waiting to determine whether a second tap follows. */
export interface ViewportTouchTap extends ViewerPointerPoint {
  timestamp: number;
  side: 'left' | 'right';
}

/** Calculate the Euclidean distance between two client-space pointer positions. */
export function pointerDistance(
  a: ViewerPointerPoint,
  b: ViewerPointerPoint,
): number {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

/** Calculate the client-space midpoint between two pointer positions. */
export function pointerMidpoint(
  a: ViewerPointerPoint,
  b: ViewerPointerPoint,
): ViewerPointerPoint {
  return {
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2,
  };
}

/**
 * Resolve a qualifying same-side touch double tap to a five-second seek.
 *
 * A first tap, reversed timestamps, non-finite input, taps on opposite sides,
 * and taps outside the timing or movement tolerance do not seek.
 */
export function doubleTapSeekSeconds(
  previous: ViewportTouchTap | null,
  current: ViewportTouchTap,
): -5 | 5 | null {
  if (!previous || !touchTapIsFinite(previous) || !touchTapIsFinite(current)) {
    return null;
  }

  const elapsedMs = current.timestamp - previous.timestamp;
  if (
    elapsedMs < 0 ||
    elapsedMs > DOUBLE_TAP_MAX_DELAY_MS ||
    previous.side !== current.side ||
    pointerDistance(previous, current) > DOUBLE_TAP_MAX_DISTANCE_PX
  ) {
    return null;
  }

  return current.side === 'left' ? -5 : 5;
}

/** Map a viewer zoom key to its direction, including legacy symbol aliases. */
export function zoomDirectionForKey(key: string): 'in' | 'out' | null {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === 'w' || key === '+' || key === '=') {
    return 'in';
  }
  if (normalizedKey === 'x' || key === '-') {
    return 'out';
  }
  return null;
}

function touchTapIsFinite(tap: ViewportTouchTap): boolean {
  return (
    Number.isFinite(tap.timestamp) &&
    Number.isFinite(tap.clientX) &&
    Number.isFinite(tap.clientY)
  );
}
