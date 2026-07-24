import { describe, expect, it } from 'vitest';
import type {
  GameEventPayload,
  GameEventType,
  TrackingEvent,
  TrackingGameData,
  TrackingPoint,
} from './game-stats';
import { playerGameActions } from './player-game-actions';

let eventId = 1;

function event(
  timeMs: number,
  type: GameEventType,
  payload: GameEventPayload,
): TrackingEvent {
  return {
    id: eventId++,
    pointId: 1,
    timeMs,
    type,
    payload,
    annotations: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function data(events: TrackingEvent[]): TrackingGameData {
  const point: TrackingPoint = {
    id: 1,
    sequenceNumber: 1,
    lineId: 1,
    startingPossession: 'offense',
    startTimeMs: 1_000,
    pullerPlayerId: null,
    lineupEndzoneOverride: null,
    initialOffenseStrategyId: null,
    initialDefenseStrategyId: null,
    startingPlayerIds: [1, 2, 3],
    matchupRoleOverrides: {},
    events,
  };
  return {
    game: {
      id: 1,
      token: 'game',
      title: 'Game',
      teamName: 'UVS',
      teamSlug: 'uvs',
      tournamentId: 1,
      tournamentName: 'Event',
      opponentName: 'Opponent',
      playedAt: null,
      hasVideo: true,
      expectedPlayerCount: 3,
      initialOurScore: 0,
      initialOpponentScore: 0,
      initialLineupEndzone: 'left',
    },
    players: [
      { id: 1, name: 'Alex', defaultMatchupRole: null, gameMatchupRoleOverride: null, matchupRole: null },
      { id: 2, name: 'Blair', defaultMatchupRole: null, gameMatchupRoleOverride: null, matchupRole: null },
      { id: 3, name: 'Casey', defaultMatchupRole: null, gameMatchupRoleOverride: null, matchupRole: null },
    ],
    lines: [{ id: 1, name: 'Line', suggestedPlayerIds: [] }],
    strategies: [],
    points: [point],
    standaloneEvents: [],
    highlights: [{
      id: 1,
      startTimeMs: 1_200,
      endTimeMs: 2_000,
      description: 'Layout catch',
      playerIds: [1],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }],
    manualPlayerStatistics: [],
    manualPoints: [],
  };
}

describe('player game actions', () => {
  it('builds highlights and charged lowlights at their video events', () => {
    eventId = 1;
    const firstPass = event(2_000, 'completion', { throwerId: 1, receiverId: 2 });
    const goal = event(3_000, 'goal', { throwerId: 2, receiverId: 3, callahan: false });
    const drop = event(4_000, 'turnover', {
      throwerId: 2,
      intendedReceiverId: 1,
      reason: 'drop',
    });
    const defended = event(5_000, 'defended', { defenderId: 1 });
    const actions = playerGameActions(data([firstPass, goal, drop, defended]), 1);

    expect(actions).toMatchObject([
      {
        kind: 'saved_highlight',
        label: 'Saved highlight',
        timeMs: 1_200,
        eventId: null,
      },
      {
        kind: 'hockey_assist',
        label: 'Hockey assist',
        timeMs: 2_000,
        eventId: firstPass.id,
      },
      {
        tone: 'lowlight',
        kind: 'turnover',
        label: 'Drop',
        timeMs: 4_000,
        eventId: drop.id,
      },
      {
        tone: 'highlight',
        kind: 'block',
        label: 'D',
        timeMs: 5_000,
        eventId: defended.id,
      },
    ]);
  });

  it('attributes scoring actions and combines a Callahan goal with its D', () => {
    eventId = 20;
    const goal = event(2_000, 'goal', { throwerId: 1, receiverId: 2, callahan: false });
    const callahan = event(3_000, 'goal', { throwerId: null, receiverId: 1, callahan: true });

    expect(playerGameActions(data([goal]), 1)).toMatchObject([
      { kind: 'saved_highlight' },
      { kind: 'assist', label: 'Assist', eventId: goal.id },
    ]);
    expect(playerGameActions(data([callahan]), 1)).toMatchObject([
      { kind: 'saved_highlight' },
      { kind: 'goal', label: 'Callahan goal + D', eventId: callahan.id },
    ]);
  });

  it('shows a stall as a thrower-charged lowlight', () => {
    eventId = 30;
    const stall = event(4_000, 'turnover', {
      throwerId: 1,
      intendedReceiverId: null,
      reason: 'stall',
    });

    expect(playerGameActions(data([stall]), 1)).toContainEqual(expect.objectContaining({
      tone: 'lowlight',
      kind: 'turnover',
      label: 'Stall',
      eventId: stall.id,
    }));
  });

  it('returns no video links for a paper-only game', () => {
    const paper = data([]);
    paper.game.hasVideo = false;

    expect(playerGameActions(paper, 1)).toEqual([]);
  });
});
