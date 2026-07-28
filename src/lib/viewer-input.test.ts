import { describe, expect, it } from 'vitest';
import {
  doubleTapSeekSeconds,
  pointerDistance,
  pointerMidpoint,
  zoomDirectionForKey,
  type ViewportTouchTap,
} from './viewer-input';

function tap(
  timestamp: number,
  clientX: number,
  clientY: number,
  side: ViewportTouchTap['side'],
): ViewportTouchTap {
  return { timestamp, clientX, clientY, side };
}

describe('viewer pointer geometry', () => {
  it('calculates pointer distance in client space', () => {
    expect(pointerDistance(
      { clientX: 2, clientY: -3 },
      { clientX: 5, clientY: 1 },
    )).toBe(5);
  });

  it('is symmetric and returns zero for identical points', () => {
    const first = { clientX: -4.5, clientY: 8 };
    const second = { clientX: 12, clientY: -7.25 };

    expect(pointerDistance(first, second)).toBe(pointerDistance(second, first));
    expect(pointerDistance(first, first)).toBe(0);
  });

  it('calculates the midpoint of positive, negative, and fractional coordinates', () => {
    expect(pointerMidpoint(
      { clientX: -5, clientY: 2.5 },
      { clientX: 8, clientY: -7.5 },
    )).toEqual({ clientX: 1.5, clientY: -2.5 });
  });
});

describe('touch double-tap seeking', () => {
  it('seeks backward for a qualifying double tap on the left', () => {
    expect(doubleTapSeekSeconds(
      tap(1_000, 80, 120, 'left'),
      tap(1_240, 92, 128, 'left'),
    )).toBe(-5);
  });

  it('seeks forward for a qualifying double tap on the right', () => {
    expect(doubleTapSeekSeconds(
      tap(2_000, 720, 100, 'right'),
      tap(2_300, 700, 112, 'right'),
    )).toBe(5);
  });

  it('accepts the exact timing and distance limits', () => {
    expect(doubleTapSeekSeconds(
      tap(1_000, 0, 0, 'left'),
      tap(1_350, 48, 0, 'left'),
    )).toBe(-5);
  });

  it('does not seek for a first tap or taps on opposite sides', () => {
    expect(doubleTapSeekSeconds(null, tap(1_000, 80, 120, 'left'))).toBeNull();
    expect(doubleTapSeekSeconds(
      tap(1_000, 80, 120, 'left'),
      tap(1_200, 720, 120, 'right'),
    )).toBeNull();
  });

  it('rejects taps outside the timing tolerance', () => {
    expect(doubleTapSeekSeconds(
      tap(1_000, 80, 120, 'left'),
      tap(1_351, 80, 120, 'left'),
    )).toBeNull();
    expect(doubleTapSeekSeconds(
      tap(1_000, 80, 120, 'left'),
      tap(999, 80, 120, 'left'),
    )).toBeNull();
  });

  it('rejects taps outside the movement tolerance', () => {
    expect(doubleTapSeekSeconds(
      tap(1_000, 0, 0, 'right'),
      tap(1_200, 48.01, 0, 'right'),
    )).toBeNull();
  });

  it('rejects non-finite tap data', () => {
    expect(doubleTapSeekSeconds(
      tap(1_000, 80, 120, 'left'),
      tap(Number.NaN, 80, 120, 'left'),
    )).toBeNull();
    expect(doubleTapSeekSeconds(
      tap(1_000, 80, 120, 'left'),
      tap(1_200, Number.POSITIVE_INFINITY, 120, 'left'),
    )).toBeNull();
  });
});

describe('viewer zoom keys', () => {
  it.each(['w', 'W', '+', '='])('maps %s to zoom in', (key) => {
    expect(zoomDirectionForKey(key)).toBe('in');
  });

  it.each(['x', 'X', '-'])('maps %s to zoom out', (key) => {
    expect(zoomDirectionForKey(key)).toBe('out');
  });

  it.each(['r', '0', '_', ' ', 'ArrowUp'])('ignores unrelated key %j', (key) => {
    expect(zoomDirectionForKey(key)).toBeNull();
  });
});
