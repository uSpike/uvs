import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import TeamPage from './+page.svelte';

describe('team page season exports', () => {
  it('lists every season roster even when there are no events', () => {
    const result = render(TeamPage, {
      props: {
        data: {
          role: 'player',
          teamSlug: 'union',
          fullBleed: false,
          pageScroll: true,
          team: {
            id: 1,
            name: 'Union',
            slug: 'union',
            games: [],
          },
          tournaments: [],
          seasonRosters: [
            { id: 2, name: '2026' },
            { id: 3, name: '2027' },
          ],
          scores: {},
        },
      },
    });

    expect(result.body).toContain('aria-label="Season AI analysis exports"');
    expect(result.body).toContain('Markdown to paste into chat');
    expect(result.body).toContain('full JSON available');
    expect(result.body).toContain(
      '/api/teams/union/seasons/2/analysis-export?format=markdown',
    );
    expect(result.body).toContain(
      'aria-label="Download compact AI brief Markdown with player names for 2026"',
    );
    expect(result.body).toContain(
      '/api/teams/union/seasons/3/analysis-export?format=markdown',
    );
    expect(result.body).toContain(
      'aria-label="Download compact AI brief Markdown with player names for 2027"',
    );
    expect(result.body).toContain(
      '/api/teams/union/seasons/2/analysis-export',
    );
    expect(result.body).toContain(
      'aria-label="Download full AI analysis JSON with player names for 2026"',
    );
  });
});
