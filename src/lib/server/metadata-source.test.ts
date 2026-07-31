import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { metadataSourceResponse, validateMetadataSource } from './metadata-source';

const manifestJsonl = `${JSON.stringify({
  kind: 'manifest',
  manifest: {
    schema_version: 3,
    export_mode: 'web_panorama',
    video: {
      path: 'game.mp4',
      width: 1920,
      height: 540,
      codec: 'h264',
      quality: 'balanced',
    },
    roi: { space: 'panorama_yaw_pitch_radians', points: [] },
    panorama_extent: {
      yaw_min: -1.5,
      yaw_max: 1.5,
      pitch_min: -0.4,
      pitch_max: 0.4,
    },
    rig_orientation: {
      space: 'reco_framing_radians',
      tilt: 0.1,
      roll: -0.03,
    },
    video_projection: 'angular_rectangular',
    video_y_axis: 'pitch_max_to_pitch_min',
    detection_interval: 5,
    tracking_mode: 'field',
  },
})}\n${JSON.stringify({ kind: 'detections', frame_index: 5, detections: [] })}\n`;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('metadata sources', () => {
  it('validates a remote JSONL manifest from a bounded range request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(manifestJsonl));
    vi.stubGlobal('fetch', fetchMock);

    const validated = await validateMetadataSource(
      'https://media.example.test/game.metadata.jsonl#ignored',
    );

    expect(validated.source).toBe('https://media.example.test/game.metadata.jsonl');
    expect(validated.metadata.manifest.video.path).toBe('game.mp4');
    expect(validated.metadata.detectionSamples).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://media.example.test/game.metadata.jsonl'),
      { headers: { Range: 'bytes=0-1048575' } },
    );
  });

  it('streams a server-local metadata source without buffering it in the database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uvs-metadata-'));
    temporaryDirectories.push(directory);
    const filename = join(directory, 'game.metadata.jsonl');
    await writeFile(filename, manifestJsonl);
    const source = pathToFileURL(filename).href;

    const validated = await validateMetadataSource(source);
    const response = await metadataSourceResponse(source, new Request('http://uvs.test/metadata'));

    expect(validated.metadata.manifest.schema_version).toBe(3);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(await response.text()).toBe(manifestJsonl);
  });

  it('rejects unsupported URLs and JSONL without a manifest', async () => {
    await expect(validateMetadataSource('relative.metadata.jsonl')).rejects.toThrow(
      'Metadata URL must be an absolute',
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      `${JSON.stringify({ kind: 'detections', frame_index: 1, detections: [] })}\n`,
    )));
    await expect(
      validateMetadataSource('https://media.example.test/no-manifest.jsonl'),
    ).rejects.toThrow('Metadata manifest was not found');
  });
});
