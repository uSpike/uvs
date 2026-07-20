import { describe, expect, it } from 'vitest';
import { detectionBoxFovScale } from './detection-overlay';
import { DEFAULT_FOV_DEGREES } from './perspective';

describe('detectionBoxFovScale', () => {
  it('preserves box size at the default perspective FOV', () => {
    expect(detectionBoxFovScale(DEFAULT_FOV_DEGREES)).toBeCloseTo(1);
  });

  it('grows boxes when zooming in and shrinks them when zooming out', () => {
    expect(detectionBoxFovScale(40)).toBeGreaterThan(1);
    expect(detectionBoxFovScale(100)).toBeLessThan(1);
  });

  it('uses perspective projection scaling rather than linear degree scaling', () => {
    const expected = Math.tan((DEFAULT_FOV_DEGREES * Math.PI) / 360) /
      Math.tan((40 * Math.PI) / 360);
    expect(detectionBoxFovScale(40)).toBeCloseTo(expected);
  });
});
