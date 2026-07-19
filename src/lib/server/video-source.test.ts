import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateVideoSource, videoSourceResponse } from './video-source';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function videoFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'reco-video-source-'));
  temporaryDirectories.push(directory);
  const filename = join(directory, 'game.webm');
  await writeFile(filename, Buffer.from('0123456789'));
  return pathToFileURL(filename).href;
}

async function largeVideoFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'reco-video-source-'));
  temporaryDirectories.push(directory);
  const filename = join(directory, 'game.mp4');
  await writeFile(filename, Buffer.alloc(256 * 1024, 7));
  return pathToFileURL(filename).href;
}

describe('server video sources', () => {
  it('validates a server-local file URL', async () => {
    const url = await videoFixture();
    await expect(validateVideoSource(url)).resolves.toBe(url);
    await expect(validateVideoSource('file:///definitely/missing/video.mp4')).rejects.toThrow(
      /does not exist/u,
    );
  });

  it('serves byte ranges from a local video', async () => {
    const url = await videoFixture();
    const response = await videoSourceResponse(
      url,
      new Request('http://localhost/video', { headers: { Range: 'bytes=2-5' } }),
    );

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(response.headers.get('content-type')).toBe('video/webm');
    expect(await response.text()).toBe('2345');
  });

  it('rejects unsatisfiable byte ranges', async () => {
    const url = await videoFixture();
    const response = await videoSourceResponse(
      url,
      new Request('http://localhost/video', { headers: { Range: 'bytes=100-200' } }),
    );

    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10');
  });

  it('allows a browser to cancel a local range stream', async () => {
    const url = await largeVideoFixture();
    const response = await videoSourceResponse(
      url,
      new Request('http://localhost/video', {
        headers: { Range: 'bytes=0-262143' },
      }),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const firstChunk = await reader!.read();
    expect(firstChunk.done).toBe(false);
    expect(firstChunk.value?.byteLength).toBeGreaterThan(0);
    await reader!.cancel();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
