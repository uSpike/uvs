import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import {
  calculateGameStatistics,
  type GameEventPayload,
  type GameEventType,
  type GameTrackingSnapshot,
  type TrackingEvent,
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

function videoEvent(
  id: number,
  timeMs: number,
  type: GameEventType,
  payload: GameEventPayload,
): TrackingEvent {
  return {
    id,
    pointId: 10,
    timeMs,
    type,
    payload,
    annotations: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function completedVideoSnapshot(): GameTrackingSnapshot {
  const data: TrackingGameData = {
    game: {
      id: 1,
      token: 'video-game-token',
      title: 'Union vs. Surge',
      teamName: 'Union',
      teamSlug: 'union',
      tournamentId: 2,
      tournamentName: 'Invite',
      opponentName: 'Surge',
      playedAt: '2026-01-01T18:00:00Z',
      hasVideo: true,
      expectedPlayerCount: 2,
      initialOurScore: 0,
      initialOpponentScore: 0,
      initialLineupEndzone: 'left',
    },
    players: [{
      id: 7,
      name: 'Alex',
      defaultMatchupRole: null,
      gameMatchupRoleOverride: null,
      matchupRole: null,
    }, {
      id: 8,
      name: 'Blair',
      defaultMatchupRole: null,
      gameMatchupRoleOverride: null,
      matchupRole: null,
    }],
    lines: [{ id: 3, name: 'Universe', suggestedPlayerIds: [7, 8] }],
    strategies: [],
    points: [{
      id: 10,
      sequenceNumber: 1,
      lineId: 3,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      lineupEndzoneOverride: null,
      initialOffenseStrategyId: null,
      initialDefenseStrategyId: null,
      startingPlayerIds: [7, 8],
      matchupRoleOverrides: {},
      events: [
        videoEvent(13, 4_000, 'goal', {
          throwerId: 8,
          receiverId: 7,
          callahan: false,
        }),
        videoEvent(11, 2_000, 'possession_start', { playerId: 7 }),
        videoEvent(12, 3_000, 'completion', {
          throwerId: 7,
          receiverId: 8,
        }),
      ],
    }],
    standaloneEvents: [],
    highlights: [],
    manualPlayerStatistics: [],
    manualPoints: [],
  };
  return {
    data,
    statistics: calculateGameStatistics(data),
    currentPointId: null,
    currentPointState: null,
  };
}

function renderCompletedVideoAt(currentTime: number): string {
  const playback = { currentTime, playing: true, frameIndex: Math.round(currentTime * 30) };
  return render(GameStatsRecorder, {
    props: {
      token: 'video-game-token',
      initialSnapshot: completedVideoSnapshot(),
      playback,
      manageTournamentUrl: null,
      getPlayback: () => playback,
      pausePlayback: () => {},
      playPlayback: () => Promise.resolve(),
      seekPlayback: () => {},
      stepPlaybackFrames: () => {},
      recordingMode: 'forms',
      onSpatialStateChange: () => {},
      onHighlightOverlayChange: () => {},
      onEditingChange: () => {},
      onSnapshotChange: () => {},
      paperOnlyMode: false,
    },
  }).body;
}

function renderedPointTimelineRows(body: string): Array<{
  attributes: string;
  label: string;
}> {
  const timelineStart = body.indexOf('Point 1 timeline');
  if (timelineStart === -1) return [];
  return [...body.slice(timelineStart).matchAll(
    /<button class="recent-row-main[^"]*"([^>]*)>[\s\S]*?<span[^>]*>(?:<!---->)?([^<]+)<\/span>/g,
  )].map((match) => ({
    attributes: match[1],
    label: match[2],
  }));
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

describe('GameStatsRecorder completed point playback', () => {
  it('labels each point row with its line and O/D start', () => {
    const body = renderCompletedVideoAt(2.5);
    const tableStart = body.indexOf('class="point-results-table');
    const pointTable = body.slice(tableStart, body.indexOf('</table>', tableStart));

    expect(pointTable).toContain('Point 1');
    expect(pointTable).toContain('Universe · O');
  });

  it('uses a dedicated action scroller for completed-point playback', () => {
    const body = renderCompletedVideoAt(2.5);

    expect(body).toMatch(/class="panel-content[^"]*timeline-scroll-content[^"]*"/);
    expect(body).toContain('class="point-event-list');
    expect(body).toContain('role="region" aria-label="Point 1 actions"');
    expect(body).toContain('data-timeline-item="event:12"');
  });

  it('shows actions chronologically and highlights the next action', () => {
    const rows = renderedPointTimelineRows(renderCompletedVideoAt(2.5));

    expect(rows.map((row) => row.label)).toEqual([
      'Pull',
      'Start possession',
      'Completion',
      'Goal',
    ]);
    expect(rows.filter((row) => row.attributes.includes('aria-current="time"')))
      .toEqual([expect.objectContaining({ label: 'Completion' })]);
  });

  it.each([
    [1, 'Pull'],
    [1.001, 'Start possession'],
    [2, 'Start possession'],
    [2.001, 'Completion'],
    [3, 'Completion'],
    [3.001, 'Goal'],
    [4, 'Goal'],
  ])('keeps the action at %.3f seconds highlighted until playback passes it', (
    currentTime,
    expectedLabel,
  ) => {
    const rows = renderedPointTimelineRows(renderCompletedVideoAt(currentTime));
    const currentRows = rows.filter((row) => row.attributes.includes('aria-current="time"'));

    expect(currentRows).toEqual([expect.objectContaining({ label: expectedLabel })]);
  });
});
