import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import {
  calculateGameStatistics,
  mergeGameStatistics,
  type TrackingGameData,
} from '$lib/game-stats';
import EventStatisticsPage from './+page.svelte';

describe('event statistics page', () => {
  it('renders game selection in the game list before the open event-total card', () => {
    const gameData: TrackingGameData = {
      game: {
        id: 10,
        token: 'game-token',
        title: 'Pool play',
        teamName: 'Union',
        teamSlug: 'union',
        tournamentId: 5,
        tournamentName: 'Invite',
        opponentName: 'Surge',
        playedAt: '2026-06-01T10:00',
        hasVideo: false,
        expectedPlayerCount: 0,
        initialOurScore: 0,
        initialOpponentScore: 0,
        initialLineupEndzone: 'left',
      },
      players: [],
      lines: [],
      strategies: [],
      points: [],
      standaloneEvents: [],
      highlights: [],
      manualPlayerStatistics: [],
      manualPoints: [],
    };
    const gameStatistics = calculateGameStatistics(gameData);
    const aggregate = mergeGameStatistics([gameStatistics], [], []);
    const data = {
      role: 'player' as const,
      teamSlug: 'union',
      fullBleed: false,
      pageScroll: true,
      tournament: {
        id: 5,
        name: 'Invite',
        startsOn: '2026-06-01',
        endsOn: '2026-06-02',
        seasonRosterId: 2,
        seasonRosterName: '2026',
        teamId: 1,
        teamName: 'Union',
        teamSlug: 'union',
        playerIds: [],
        lines: [],
        games: [{
          id: 10,
          token: 'game-token',
          title: 'Pool play',
          opponentName: 'Surge',
          playedAt: '2026-06-01T10:00',
        }],
        gameCount: 1,
      },
      rosterId: 2,
      focusedGameToken: null,
      statistics: aggregate,
      aggregatePlayers: [],
      aggregateLines: [],
      games: [{
        id: 10,
        token: 'game-token',
        title: 'Pool play',
        teamId: 1,
        teamName: 'Union',
        teamSlug: 'union',
        tournamentId: 5,
        tournamentName: 'Invite',
        opponentName: 'Surge',
        playedAt: '2026-06-01T10:00',
        hasVideo: false,
        playerCount: 0,
        initialOurScore: 0,
        initialOpponentScore: 0,
        createdAt: '2026-06-01T09:00:00Z',
        updatedAt: '2026-06-01T09:00:00Z',
        ourScore: 0,
        opponentScore: 0,
        statistics: gameStatistics,
      }],
    };
    const result = render(EventStatisticsPage, {
      props: { data },
    });

    expect(result.body).toContain('<details id="event-totals"');
    expect(result.body).toContain('class="event-disclosure');
    expect(result.body).toContain('open=""');
    expect(result.body).toContain('class="game-list-heading ');
    expect(result.body).toContain('>Include</span>');
    const checkboxIndex = result.body.indexOf(
      'aria-label="Include Pool play versus Surge in event totals"',
    );
    expect(checkboxIndex).toBeGreaterThan(-1);
    expect(checkboxIndex).toBeLessThan(result.body.indexOf('<details id="event-totals"'));
    expect(result.body).not.toContain('Games included in event totals');
    expect(result.body).toContain('1 of 1 included');
    expect(result.body).toContain(
      '/api/teams/union/tournaments/5/analysis-export?games=10&amp;format=markdown',
    );
    expect(result.body).toContain(
      'aria-label="Download compact AI brief Markdown with player names for 1 selected game in Invite"',
    );
    expect(result.body).toContain('>Event AI brief</a>');
    expect(result.body).toContain(
      'aria-label="Download full AI analysis JSON with player names for 1 selected game in Invite"',
    );
    expect(result.body).toContain('>JSON</a>');
    expect(result.body).toContain(
      '/api/teams/union/seasons/2/analysis-export?format=markdown',
    );
    expect(result.body).toContain(
      'aria-label="Download compact AI brief Markdown with player names for 2026"',
    );
    expect(result.body).toContain('>Season AI brief</a>');
    expect(result.body).toContain(
      'aria-label="Download full AI analysis JSON with player names for 2026"',
    );

    const disabledResult = render(EventStatisticsPage, {
      props: {
        data: {
          ...data,
          games: data.games.map((game) => ({ ...game, statistics: null })),
        },
      },
    });
    expect(disabledResult.body).toContain('aria-disabled="true"');
    expect(disabledResult.body).toContain('>Event AI brief</span>');
    expect(disabledResult.body).not.toContain(
      '/api/teams/union/tournaments/5/analysis-export?games=',
    );
  });
});
