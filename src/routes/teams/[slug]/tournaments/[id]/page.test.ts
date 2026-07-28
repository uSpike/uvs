import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import {
  calculateGameStatistics,
  mergeGameStatistics,
  type TrackingGameData,
} from '$lib/game-stats';
import EventStatisticsPage from './+page.svelte';

describe('event statistics page', () => {
  it('renders game selection inside an open collapsible event-total card', () => {
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
    const result = render(EventStatisticsPage, {
      props: {
        data: {
          role: 'player',
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
        },
      },
    });

    expect(result.body).toContain('<details id="event-totals"');
    expect(result.body).toContain('class="event-disclosure');
    expect(result.body).toContain('open=""');
    expect(result.body).toContain('Games included in event totals');
    expect(result.body).toContain(
      'aria-label="Include Pool play versus Surge in event totals"',
    );
    expect(result.body).toContain('1 of 1 included');
  });
});
