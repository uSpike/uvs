import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { parseMetadataJsonl } from '$lib/metadata';
import { CatalogRepository } from './catalog';
import { openDatabase } from './database';
import { GameTrackingRepository } from './game-tracking';
import { TournamentRepository } from './tournaments';

const metadataJsonl = JSON.stringify({
  kind: 'manifest',
  manifest: {
    schema_version: 3,
    export_mode: 'web_panorama',
    video: { path: 'game.mp4', width: 1920, height: 540, codec: 'h264', quality: 'balanced' },
    roi: { space: 'panorama_yaw_pitch_radians', points: [] },
    panorama_extent: { yaw_min: -1.5, yaw_max: 1.5, pitch_min: -0.4, pitch_max: 0.4 },
    rig_orientation: { space: 'reco_framing_radians', tilt: 0, roll: 0 },
    video_projection: 'angular_rectangular',
    video_y_axis: 'pitch_max_to_pitch_min',
    detection_interval: 5,
    tracking_mode: 'field',
  },
});

let databases: Database.Database[] = [];

afterEach(() => {
  databases.forEach((database) => database.close());
  databases = [];
});

function configuredGame() {
  const database = openDatabase(':memory:');
  databases.push(database);
  const catalog = new CatalogRepository(database);
  const tournaments = new TournamentRepository(database);
  const team = catalog.createTeam('Union', 'team-password');
  const rosterId = tournaments.createSeasonRoster(team.id, '2026');
  const alex = tournaments.addPlayer(rosterId, 'Alex', 'mmp');
  const blair = tournaments.addPlayer(rosterId, 'Blair', 'fmp');
  const casey = tournaments.addPlayer(rosterId, 'Casey', 'mmp');
  const devon = tournaments.addPlayer(rosterId, 'Devon', 'fmp');
  const tournamentId = tournaments.createTournament({
    seasonRosterId: rosterId,
    name: 'Invite',
    startsOn: '2026-06-01',
    endsOn: '2026-06-02',
    playerIds: [alex, blair, casey, devon],
  });
  const lineId = tournaments.createLine(tournamentId, 'Universe', [alex, blair, casey]);
  const metadata = parseMetadataJsonl(metadataJsonl);
  const game = catalog.createGame({
    tournamentId,
    title: 'Union vs. Surge',
    opponentName: 'Surge',
    playedAt: '2026-06-01T10:00',
    playerCount: 3,
    initialOurScore: 0,
    initialOpponentScore: 0,
    videoSource: 'file:///srv/game.mp4',
    metadataJsonl,
    metadata,
  });
  return {
    tracking: new GameTrackingRepository(database),
    tournaments,
    rosterId,
    game,
    lineId,
    players: { alex, blair, casey, devon },
  };
}

describe('GameTrackingRepository', () => {
  it('persists the game starting endzone and point overrides', () => {
    const { tracking, game, lineId, players } = configuredGame();
    expect(tracking.getSnapshot(game.token)!.data.game.initialLineupEndzone).toBe('left');

    const updated = tracking.setInitialLineupEndzone(game.token, 'right');
    expect(updated.data.game.initialLineupEndzone).toBe('right');

    const started = tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: {},
      lineupEndzoneOverride: 'left',
    });
    expect(started.data.points[0].lineupEndzoneOverride).toBe('left');
  });

  it('tracks season strategies through point changes and paper summaries', () => {
    const { tracking, tournaments, rosterId, game, lineId, players } = configuredGame();
    const initial = tracking.getSnapshot(game.token)!;
    const person = initial.data.strategies.find((strategy) => strategy.name === 'Person')!;
    const verticalId = tournaments.addStrategy(rosterId, 'offense', 'Vertical');
    const zoneId = tournaments.addStrategy(rosterId, 'defense', 'Zone', true);

    const started = tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: {},
    });
    expect(started.data.points[0]).toMatchObject({
      initialOffenseStrategyId: null,
      initialDefenseStrategyId: null,
    });
    expect(started.currentPointState).toMatchObject({
      offenseStrategyId: null,
      defenseStrategyId: null,
    });

    const changed = tracking.addEvent(game.token, {
      pointId: started.currentPointId,
      timeMs: 1_500,
      type: 'strategy_set',
      payload: { kind: 'offense', strategyId: verticalId },
    });
    expect(changed.currentPointState).toMatchObject({
      offenseStrategyId: verticalId,
      defenseStrategyId: null,
    });
    expect(() => tracking.addEvent(game.token, {
      pointId: started.currentPointId,
      timeMs: 1_600,
      type: 'strategy_set',
      payload: { kind: 'offense', strategyId: person.id },
    })).toThrow('from this season roster');

    tracking.saveManualSummary(game.token, {
      playerStatistics: [],
      points: [{
        lineId,
        startingPossession: 'defense',
        initialDefenseType: null,
        offenseStrategyId: verticalId,
        defenseStrategyId: zoneId,
        ourTurnovers: 0,
        scoringMethod: 'Callahan',
        scorerPlayerId: players.alex,
        ourScore: 1,
        opponentScore: 0,
      }],
    });
    const paper = tracking.getSnapshot(game.token)!.data.manualPoints[0];
    expect(paper).toMatchObject({
      offenseStrategyId: verticalId,
      defenseStrategyId: zoneId,
      initialDefenseType: 'Zone',
    });
  });

  it('adds, edits, attributes, and validates highlights separately from events', () => {
    const { tracking, game, players } = configuredGame();
    const added = tracking.addHighlight(game.token, {
      startTimeMs: 2_000,
      endTimeMs: 6_500,
      description: 'Layout block into a fast break',
      playerIds: [players.alex, players.blair],
    });
    const highlight = added.data.highlights[0];
    expect(highlight).toMatchObject({
      startTimeMs: 2_000,
      endTimeMs: 6_500,
      description: 'Layout block into a fast break',
      playerIds: [players.alex, players.blair],
    });
    expect(added.data.points).toHaveLength(0);
    expect(added.data.standaloneEvents).toHaveLength(0);

    const updated = tracking.updateHighlight(game.token, highlight.id, {
      startTimeMs: 2_500,
      endTimeMs: 7_000,
      description: 'Layout block and score',
      playerIds: [players.alex],
    });
    expect(updated.data.highlights[0]).toMatchObject({
      startTimeMs: 2_500,
      description: 'Layout block and score',
      playerIds: [players.alex],
    });
    expect(() => tracking.addHighlight(game.token, {
      startTimeMs: 8_000,
      endTimeMs: 7_000,
      description: 'Invalid range',
      playerIds: [],
    })).toThrow('end after it starts');
    expect(() => tracking.addHighlight(game.token, {
      startTimeMs: 8_000,
      endTimeMs: 9_000,
      description: 'Unknown player',
      playerIds: [999],
    })).toThrow('event roster');

    const deleted = tracking.deleteHighlight(game.token, highlight.id);
    expect(deleted.data.highlights).toHaveLength(0);
  });

  it('replaces and validates paper player totals and point summaries', () => {
    const { tracking, game, lineId, players } = configuredGame();
    const saved = tracking.saveManualSummary(game.token, {
      playerStatistics: [
        { playerId: players.alex, pointsPlayed: 3, hockeyAssists: 1, assists: 2, goals: 1, blocks: 2 },
      ],
      points: [
        {
          lineId,
          startingPossession: 'offense',
          initialDefenseType: null,
          ourTurnovers: 1,
          scoringMethod: 'Open side',
          scorerPlayerId: players.alex,
          ourScore: 1,
          opponentScore: 0,
        },
        {
          lineId,
          startingPossession: 'defense',
          initialDefenseType: 'Zone',
          ourTurnovers: 0,
          scoringMethod: null,
          scorerPlayerId: null,
          ourScore: 1,
          opponentScore: 1,
        },
      ],
    });

    expect(saved.data.manualPlayerStatistics).toHaveLength(1);
    expect(saved.data.manualPoints).toMatchObject([
      { sequenceNumber: 1, initialDefenseType: null, scoringMethod: 'Open side' },
      { sequenceNumber: 2, initialDefenseType: 'Zone', scoringMethod: null },
    ]);
    expect(saved.statistics).toMatchObject({ ourScore: 1, opponentScore: 1 });
    expect(saved.statistics.lineStatistics[0]).toMatchObject({ pointsPlayed: 2, turnovers: 1 });

    expect(() => tracking.saveManualSummary(game.token, {
      playerStatistics: [],
      points: [{
        lineId,
        startingPossession: 'offense',
        initialDefenseType: null,
        ourTurnovers: 0,
        scoringMethod: null,
        scorerPlayerId: null,
        ourScore: 2,
        opponentScore: 0,
      }],
    })).toThrow('add exactly one goal');
  });

  it('layers game and point matchup role overrides over roster defaults', () => {
    const { tracking, game, lineId, players } = configuredGame();

    const gameOverride = tracking.setGameMatchupRole(game.token, players.alex, 'fmp');
    expect(
      gameOverride.data.players.find((player) => player.id === players.alex),
    ).toMatchObject({
      defaultMatchupRole: 'mmp',
      gameMatchupRoleOverride: 'fmp',
      matchupRole: 'fmp',
    });

    const point = tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: { [players.alex]: 'mmp' },
    });
    expect(point.data.points[0].matchupRoleOverrides).toEqual({ [players.alex]: 'mmp' });

    const cleared = tracking.setGameMatchupRole(game.token, players.alex, null);
    expect(
      cleared.data.players.find((player) => player.id === players.alex),
    ).toMatchObject({ gameMatchupRoleOverride: null, matchupRole: 'mmp' });
  });

  it('records a point, possession changes, substitutions, and score', () => {
    const { tracking, game, lineId, players } = configuredGame();
    tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: {},
    });
    const possession = tracking.addEvent(game.token, {
      pointId: 1,
      timeMs: 1_500,
      type: 'possession_start',
      payload: { playerId: players.alex },
    });
    expect(possession.currentPointState).toMatchObject({
      possession: 'offense',
      handlerPlayerId: players.alex,
    });
    const completion = tracking.addEvent(game.token, {
      pointId: 1,
      timeMs: 2_000,
      type: 'completion',
      payload: { throwerId: players.alex, receiverId: players.blair },
    });
    expect(completion.currentPointState).toMatchObject({
      possession: 'offense',
      handlerPlayerId: players.blair,
    });
    tracking.addEvent(game.token, {
      pointId: 1,
      timeMs: 3_000,
      type: 'substitution',
      payload: { outgoingPlayerId: players.casey, incomingPlayerId: players.devon },
    });
    tracking.addEvent(game.token, {
      pointId: 1,
      timeMs: 4_000,
      type: 'goal',
      payload: { throwerId: players.blair, receiverId: players.devon, callahan: false },
    });

    const snapshot = tracking.getSnapshot(game.token)!;
    expect(snapshot.currentPointId).toBeNull();
    expect(snapshot.statistics).toMatchObject({ ourScore: 1, opponentScore: 0, warnings: [] });
    expect(
      snapshot.statistics.playerStatistics.find((stats) => stats.playerId === players.casey),
    ).toMatchObject({ timePlayedMs: 2_000, pointsPlayed: 1, plusMinus: 0, oPointsWon: 1 });
    expect(
      snapshot.statistics.playerStatistics.find((stats) => stats.playerId === players.devon),
    ).toMatchObject({ timePlayedMs: 1_000, pointsPlayed: 1, goals: 1, plusMinus: 1, oPointsWon: 1 });
  });

  it('records a positioned defensive action while enforcing player and possession boundaries', () => {
    const { tracking, game, lineId, players } = configuredGame();
    const started = tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'defense',
      startTimeMs: 1_000,
      pullerPlayerId: players.alex,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: {},
    });
    const pointId = started.currentPointId!;

    expect(() => tracking.addEvent(game.token, {
      pointId,
      timeMs: 1_500,
      type: 'possession_start',
      payload: { playerId: players.alex },
    })).toThrow('tracked-team possession');
    expect(() => tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'completion',
      payload: { throwerId: players.alex, receiverId: players.blair },
    })).toThrow('tracked-team possession');
    expect(() => tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'defended',
      payload: { defenderId: players.devon },
    })).toThrow('must be active');

    expect(() => tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'defended',
      payload: { defenderId: null },
    })).toThrow('Select the defender');

    const defended = tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'defended',
      payload: { defenderId: players.alex },
      annotations: [{
        role: 'defender',
        playerId: players.alex,
        timeMs: 2_000,
        frameIndex: 60,
        panoramaYaw: -0.2,
        panoramaPitch: 0.04,
      }],
    });
    expect(defended.currentPointState?.possession).toBe('offense');
    expect(defended.data.points[0].events[0]).toMatchObject({
      type: 'defended',
      payload: { defenderId: players.alex },
      annotations: [{ role: 'defender', playerId: players.alex, panoramaYaw: -0.2 }],
    });
    expect(
      defended.statistics.playerStatistics.find((stats) => stats.playerId === players.alex),
    ).toMatchObject({ blocks: 1 });
  });

  it('requires thrower and receiver attribution for video events', () => {
    const { tracking, game, lineId, players } = configuredGame();
    const pointId = tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: {},
    }).currentPointId!;

    expect(() => tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'possession_start',
      payload: { playerId: null },
    })).toThrow('player starting possession');
    expect(() => tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'completion',
      payload: { throwerId: null, receiverId: players.blair },
    })).toThrow('completion thrower');
    expect(() => tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'completion',
      payload: { throwerId: players.alex, receiverId: null },
    })).toThrow('completion receiver');
    expect(() => tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'turnover',
      payload: { throwerId: null, intendedReceiverId: null, reason: 'throwaway' },
    })).toThrow('turnover thrower');
    expect(() => tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'goal',
      payload: { throwerId: null, receiverId: players.blair, callahan: false },
    })).toThrow('goal thrower');
    expect(() => tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'goal',
      payload: { throwerId: players.alex, receiverId: null, callahan: false },
    })).toThrow('goal scorer');

    const turnover = tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'turnover',
      payload: {
        throwerId: players.alex,
        intendedReceiverId: null,
        reason: 'throwaway',
      },
    });
    expect(turnover.currentPointState?.possession).toBe('defense');
  });

  it('stores manual panorama positions with event roles and preserves them during form edits', () => {
    const { tracking, game, lineId, players } = configuredGame();
    const pointId = tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: {},
    }).currentPointId!;

    const added = tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_400,
      type: 'completion',
      payload: { throwerId: players.alex, receiverId: players.blair },
      annotations: [
        {
          role: 'thrower',
          playerId: players.alex,
          timeMs: 2_000,
          frameIndex: 60,
          panoramaYaw: -0.42,
          panoramaPitch: 0.08,
        },
        {
          role: 'receiver',
          playerId: players.blair,
          timeMs: 2_400,
          frameIndex: 72,
          panoramaYaw: 0.31,
          panoramaPitch: -0.03,
        },
      ],
    });
    const event = added.data.points[0].events[0];
    expect(event.annotations).toMatchObject([
      { role: 'thrower', playerId: players.alex, frameIndex: 60, panoramaYaw: -0.42 },
      { role: 'receiver', playerId: players.blair, frameIndex: 72, panoramaYaw: 0.31 },
    ]);

    const edited = tracking.updateEvent(game.token, event.id, {
      pointId,
      timeMs: 2_400,
      type: 'completion',
      payload: { throwerId: players.alex, receiverId: players.casey },
    });
    expect(edited.data.points[0].events[0].annotations).toHaveLength(2);
  });

  it('edits and deletes historical entries with full recalculation', () => {
    const { tracking, game, lineId, players } = configuredGame();
    const pointId = tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: {},
    }).currentPointId!;
    const withGoal = tracking.addEvent(game.token, {
      pointId,
      timeMs: 5_000,
      type: 'goal',
      payload: { throwerId: players.alex, receiverId: players.blair, callahan: false },
    });
    const goal = withGoal.data.points[0].events[0];
    const edited = tracking.updateEvent(game.token, goal.id, {
      pointId,
      timeMs: 5_000,
      type: 'goal',
      payload: { throwerId: players.alex, receiverId: players.casey, callahan: false },
    });
    expect(edited.statistics).toMatchObject({ ourScore: 1, opponentScore: 0 });
    expect(
      edited.statistics.playerStatistics.find((stats) => stats.playerId === players.casey),
    ).toMatchObject({ goals: 1, receptions: 1 });

    const reopened = tracking.deleteEvent(game.token, goal.id);
    expect(reopened.currentPointId).toBe(pointId);
    expect(reopened.statistics).toMatchObject({ ourScore: 0, opponentScore: 0 });
  });
});
