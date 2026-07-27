import { describe, expect, it, vi } from 'vitest';
import { uploadVideoTextureFrame } from './perspective-renderer';

describe('uploadVideoTextureFrame', () => {
  it('uses the accelerated video texImage2D upload path', () => {
    const texImage2D = vi.fn();
    const gl = {
      TEXTURE_2D: 0x0de1,
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      texImage2D,
    } as unknown as WebGL2RenderingContext;
    const video = {} as HTMLVideoElement;

    uploadVideoTextureFrame(gl, video);

    expect(texImage2D).toHaveBeenCalledOnce();
    expect(texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      video,
    );
  });
});
