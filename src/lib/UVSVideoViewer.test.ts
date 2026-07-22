import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import UVSVideoViewer from './UVSVideoViewer.svelte';

describe('UVSVideoViewer', () => {
  it('renders local file controls only when explicitly enabled', () => {
    const embedded = render(UVSVideoViewer, {
      props: { title: 'Game footage' },
    });
    const standalone = render(UVSVideoViewer, {
      props: { allowLocalFiles: true },
    });

    expect(embedded.body).toContain('Game footage');
    expect(embedded.body).not.toContain('Open video');
    expect(embedded.body).not.toContain('Open metadata');
    expect(standalone.body).toContain('Open video');
    expect(standalone.body).toContain('Open metadata');
  });

  it('renders a parent-managed source without exposing file pickers', () => {
    const result = render(UVSVideoViewer, {
      props: {
        allowLocalFiles: true,
        source: {
          videoUrl: '/games/game-42-panorama.mp4',
          videoName: 'Game 42 panorama',
        },
      },
    });

    expect(result.body).toContain('/games/game-42-panorama.mp4');
    expect(result.body).toContain('Game 42 panorama');
    expect(result.body).not.toContain('Open video');
    expect(result.body).not.toContain('Open metadata');
  });

  it('offers automatic camera resume as a separate playback preference', () => {
    const result = render(UVSVideoViewer);

    expect(result.body).toContain('Back 5 seconds');
    expect(result.body).toContain('Forward 5 seconds');
    expect(result.body).toContain('Playback speed');
    expect(result.body).toContain('1.25×');
    expect(result.body).toContain('1.5×');
    expect(result.body).toContain('Turn on automatic camera');
    expect(result.body).toContain('Disable AutoCam on play');
    expect(result.body).toContain('AutoCam will turn on when playback resumes');
  });

  it('does not expose internal frame and FOV diagnostics', () => {
    const result = render(UVSVideoViewer);

    expect(result.body).not.toContain('Show video details');
    expect(result.body).not.toContain('Show frame, detection, and FOV details');
    expect(result.body).not.toContain('Vertical field of view');
    expect(result.body).not.toContain('viewport-readout');
  });

  it('keeps camera and persistence controls in the view options menu', () => {
    const result = render(UVSVideoViewer, {
      props: { onSaveSettings: () => undefined },
    });

    expect(result.body).toContain('AutoCam settings');
    expect(result.body).toContain('Camera orientation');
    expect(result.body).toContain('Save settings');
    expect(result.body).not.toContain('aria-label="Camera controls"');
  });
});
