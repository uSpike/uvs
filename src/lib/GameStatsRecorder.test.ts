import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import {
  calculateGameStatistics,
  type GameTrackingSnapshot,
  type TrackingGameData,
} from './game-stats';
import GameStatsRecorder from './GameStatsRecorder.svelte';

function paperSnapshot(): GameTrackingSnapshot {
  const data: TrackingGameData = {
    game: {
      id: 1,
      token: 'paper-game-token',
      title: 'Union vs. Surge',
      teamName: 'Union',
      teamSlug: 'union',
      tournamentId: 2,
      tournamentName: 'Invite',
      opponentName: 'Surge',
      playedAt: null,
      hasVideo: false,
      expectedPlayerCount: 1,
      initialOurScore: 2,
      initialOpponentScore: 1,
      initialLineupEndzone: 'left',
    },
    players: [{
      id: 7,
      name: 'Alex',
      defaultMatchupRole: null,
      gameMatchupRoleOverride: null,
      matchupRole: null,
    }],
    lines: [{ id: 3, name: 'Universe', suggestedPlayerIds: [7] }],
    strategies: [],
    points: [],
    standaloneEvents: [],
    highlights: [],
    manualPlayerStatistics: [{
      playerId: 7,
      pointsPlayed: 0,
      hockeyAssists: 2,
      assists: 0,
      goals: 0,
      blocks: 0,
    }],
    manualPoints: [{
      id: 10,
      sequenceNumber: 1,
      lineId: 3,
      startingPossession: 'offense',
      initialDefenseType: null,
      offenseStrategyId: null,
      defenseStrategyId: null,
      ourTurnovers: 0,
      scoringMethod: null,
      throwerPlayerId: null,
      receiverPlayerId: null,
      ourScore: 3,
      opponentScore: 1,
    }, {
      id: 11,
      sequenceNumber: 2,
      lineId: 3,
      startingPossession: 'defense',
      initialDefenseType: null,
      offenseStrategyId: null,
      defenseStrategyId: null,
      ourTurnovers: 0,
      scoringMethod: null,
      throwerPlayerId: null,
      receiverPlayerId: null,
      ourScore: 3,
      opponentScore: 2,
    }],
  };
  return {
    data,
    statistics: calculateGameStatistics(data),
    currentPointId: null,
    currentPointState: null,
  };
}

function inputWithLabel(body: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.match(new RegExp(`<input[^>]*aria-label="${escaped}"[^>]*>`))?.[0] ?? '';
}

function selectWithLabel(body: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.match(
    new RegExp(`<select[^>]*aria-label="${escaped}"[^>]*>[\\s\\S]*?</select>`),
  )?.[0] ?? '';
}

describe('GameStatsRecorder paper editor', () => {
  it('renders blank zero totals, manual scores, and score-derived O/D starts', () => {
    const result = render(GameStatsRecorder, {
      props: {
        token: 'paper-game-token',
        initialSnapshot: paperSnapshot(),
        playback: { currentTime: 0, playing: false, frameIndex: 0 },
        manageTournamentUrl: null,
        getPlayback: () => ({ currentTime: 0, playing: false, frameIndex: 0 }),
        pausePlayback: () => {},
        playPlayback: () => Promise.resolve(),
        seekPlayback: () => {},
        stepPlaybackFrames: () => {},
        recordingMode: 'forms',
        onSpatialStateChange: () => {},
        onHighlightOverlayChange: () => {},
        onEditingChange: () => {},
        onSnapshotChange: () => {},
        paperOnlyMode: true,
      },
    });

    expect(result.body).toContain(
      'Scores are after each point; point 1 sets O/D, then later starts are automatic unless overridden',
    );
    expect(result.body).not.toContain('Check = us; clear = opponent');
    expect(result.body).not.toContain('paper-score-check');
    expect(inputWithLabel(result.body, 'Alex points played')).not.toContain('value="0"');
    expect(inputWithLabel(result.body, 'Alex hockey assists')).toContain('value="2"');
    expect(inputWithLabel(result.body, 'Point 1 team score')).toContain('value="3"');
    expect(inputWithLabel(result.body, 'Point 1 opponent score')).toContain('value="1"');
    expect(inputWithLabel(result.body, 'Point 2 team score')).toContain('value="3"');
    expect(inputWithLabel(result.body, 'Point 2 opponent score')).toContain('value="2"');
    expect(inputWithLabel(
      result.body,
      'Point 1 scored by our team; clear for opponent',
    )).toBe('');
    expect(result.body).toContain('aria-label="First paper point starting possession"');
    const automaticStart = selectWithLabel(
      result.body,
      'Point 2 starting possession automatic',
    );
    expect(automaticStart).toContain('Auto · D');
    expect(automaticStart).toMatch(/<option value="" selected="">Auto · D<\/option>/);
  });

  it('preserves an explicit later O/D override for possession resets', () => {
    const snapshot = paperSnapshot();
    snapshot.data.manualPoints[1].startingPossession = 'offense';
    const result = render(GameStatsRecorder, {
      props: {
        token: 'paper-game-token',
        initialSnapshot: snapshot,
        playback: { currentTime: 0, playing: false, frameIndex: 0 },
        manageTournamentUrl: null,
        getPlayback: () => ({ currentTime: 0, playing: false, frameIndex: 0 }),
        pausePlayback: () => {},
        playPlayback: () => Promise.resolve(),
        seekPlayback: () => {},
        stepPlaybackFrames: () => {},
        recordingMode: 'forms',
        onSpatialStateChange: () => {},
        onHighlightOverlayChange: () => {},
        onEditingChange: () => {},
        onSnapshotChange: () => {},
        paperOnlyMode: true,
      },
    });

    const overriddenStart = selectWithLabel(
      result.body,
      'Point 2 starting possession override',
    );
    expect(overriddenStart).toMatch(
      /<option value="offense" selected="">O override<\/option>/,
    );
  });
});
