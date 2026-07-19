import { describe, expect, it } from 'vitest';
import { canvasPixelRatio } from './render-resolution';

describe('canvasPixelRatio', () => {
  it('keeps standard-density viewports at native resolution', () => {
    expect(canvasPixelRatio(1280, 720, 1)).toBe(1);
  });

  it('caps high-density displays and a full-HD pixel budget', () => {
    expect(canvasPixelRatio(640, 360, 3)).toBe(1.25);
    const ratio = canvasPixelRatio(1920, 1080, 2);
    expect(ratio).toBe(1);
    expect(1920 * ratio * 1080 * ratio).toBeCloseTo(1920 * 1080);
  });

  it('downscales viewports that already exceed the pixel budget', () => {
    expect(canvasPixelRatio(3840, 2160, 2)).toBeCloseTo(0.5);
  });
});
