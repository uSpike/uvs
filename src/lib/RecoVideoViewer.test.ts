import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import RecoVideoViewer from './RecoVideoViewer.svelte';

describe('RecoVideoViewer', () => {
  it('renders local file controls only when explicitly enabled', () => {
    const embedded = render(RecoVideoViewer, {
      props: { title: 'Game footage' },
    });
    const standalone = render(RecoVideoViewer, {
      props: { allowLocalFiles: true },
    });

    expect(embedded.body).toContain('Game footage');
    expect(embedded.body).not.toContain('Open video');
    expect(embedded.body).not.toContain('Open metadata');
    expect(standalone.body).toContain('Open video');
    expect(standalone.body).toContain('Open metadata');
  });

  it('renders a parent-managed source without exposing file pickers', () => {
    const result = render(RecoVideoViewer, {
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
    const result = render(RecoVideoViewer);

    expect(result.body).toContain('Back 5 seconds');
    expect(result.body).toContain('Forward 5 seconds');
    expect(result.body).toContain('Turn on automatic camera');
    expect(result.body).toContain('Disable AutoCam on play');
    expect(result.body).toContain('AutoCam will turn on when playback resumes');
  });

  it('hides the diagnostic readout behind a details control', () => {
    const result = render(RecoVideoViewer);

    expect(result.body).toContain('Show video details');
    expect(result.body).toContain('Show frame, detection, and FOV details');
    expect(result.body).not.toContain('viewport-readout');
  });
});
