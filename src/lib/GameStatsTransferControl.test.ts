import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import GameStatsTransferControl from './GameStatsTransferControl.svelte';

describe('GameStatsTransferControl', () => {
  it('makes the Markdown AI brief primary while retaining full JSON and backup actions', () => {
    const result = render(GameStatsTransferControl, {
      props: { token: 'pool-play-token' },
    });

    expect(result.body).toContain(
      '/api/games/pool-play-token/analysis-export?format=markdown',
    );
    expect(result.body).toContain('AI brief (.md)');
    expect(result.body).toContain(
      'Compact Markdown to paste directly into chat. Includes player names.',
    );
    expect(result.body).toContain('/api/games/pool-play-token/analysis-export');
    expect(result.body).toContain('Full analysis JSON');
    expect(result.body).toContain(
      'Complete event-level analysis data. Includes player names.',
    );
    expect(result.body).toContain('/api/games/pool-play-token/stats-transfer');
    expect(result.body).toContain('Download backup');
    expect(result.body).toContain('Restore backup');
  });
});
