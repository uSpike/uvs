import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { calculatePointState } from '$lib/game-stats';
import {
  createGameStatisticsExport,
  parseGameStatisticsExport,
} from '$lib/game-stat-transfer';
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
    catalog,
    tracking: new GameTrackingRepository(database),
    tournaments,
    rosterId,
    tournamentId,
    game,
    lineId,
    players: { alex, blair, casey, devon },
  };
}

describe('GameTrackingRepository', () => {
  it('lists tournament and season games chronologically despite stale manual order', () => {
    const { catalog, tracking, rosterId, tournamentId, game } = configuredGame();
    const metadata = parseMetadataJsonl(metadataJsonl);
    const earlierGame = catalog.createGame({
      tournamentId,
      title: 'Union vs. Drift',
      opponentName: 'Drift',
      playedAt: '2026-06-01T08:00',
      playerCount: 3,
      initialOurScore: 0,
      initialOpponentScore: 0,
      videoSource: 'file:///srv/later-game.mp4',
      metadataJsonl,
      metadata,
    });

    databases.at(-1)!
      .prepare(
        `UPDATE games
            SET sort_order = CASE id WHEN ? THEN 0 ELSE 1 END
          WHERE tournament_id = ?`,
      )
      .run(game.id, tournamentId);

    expect(
      tracking.listTournamentGameData(tournamentId).map((data) => data.game.id),
    ).toEqual([earlierGame.id, game.id]);
    expect(
      tracking.listSeasonGameData(rosterId).map((data) => data.game.id),
    ).toEqual([earlierGame.id, game.id]);
  });

  it('exports and atomically restores complete game statistics', () => {
    const { tracking, game, lineId, players } = configuredGame();
    tracking.setInitialLineupEndzone(game.token, 'right');
    tracking.setGameMatchupRole(game.token, players.alex, 'fmp');
    const pointId = tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: { [players.casey]: 'fmp' },
      lineupEndzoneOverride: 'left',
    }).currentPointId!;
    tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'completion',
      payload: { throwerId: players.alex, receiverId: players.blair },
      annotations: [{
        role: 'receiver',
        playerId: players.blair,
        timeMs: 2_000,
        frameIndex: 60,
        panoramaYaw: 0.25,
        panoramaPitch: -0.03,
      }],
    });
    tracking.addEvent(game.token, {
      pointId,
      timeMs: 3_000,
      type: 'goal',
      payload: { throwerId: players.blair, receiverId: players.casey, callahan: false },
    });
    tracking.addEvent(game.token, {
      pointId: null,
      timeMs: 4_000,
      type: 'score_set',
      payload: { ourScore: 3, opponentScore: 2 },
    });
    tracking.addHighlight(game.token, {
      startTimeMs: 1_500,
      endTimeMs: 3_500,
      description: 'Give-and-go score',
      playerIds: [players.alex, players.blair, players.casey],
    });
    tracking.saveManualSummary(game.token, {
      playerStatistics: [{
        playerId: players.alex,
        pointsPlayed: 1,
        hockeyAssists: 1,
        assists: 0,
        goals: 0,
        blocks: 0,
      }],
      points: [],
    });

    const exported = parseGameStatisticsExport(JSON.parse(JSON.stringify(
      createGameStatisticsExport(tracking.getSnapshot(game.token)!.data, '2026-07-23T12:00:00.000Z'),
    )) as unknown);
    const original = tracking.getSnapshot(game.token)!;
    tracking.deletePoint(game.token, pointId);
    tracking.deleteHighlight(game.token, original.data.highlights[0].id);
    tracking.setInitialLineupEndzone(game.token, 'left');
    tracking.setGameMatchupRole(game.token, players.alex, null);
    tracking.saveManualSummary(game.token, { playerStatistics: [], points: [] });

    const restored = tracking.importStatistics(game.token, exported);
    expect(restored.data.game.initialLineupEndzone).toBe('right');
    expect(restored.statistics).toMatchObject({ ourScore: 3, opponentScore: 2 });
    expect(restored.data.players.find((player) => player.id === players.alex))
      .toMatchObject({ gameMatchupRoleOverride: 'fmp' });
    expect(restored.data.points).toHaveLength(1);
    expect(restored.data.points[0]).toMatchObject({
      sequenceNumber: 1,
      lineId,
      lineupEndzoneOverride: 'left',
      matchupRoleOverrides: { [players.casey]: 'fmp' },
    });
    expect(restored.data.points[0].events.map((event) => event.type))
      .toEqual(['completion', 'goal']);
    expect(restored.data.points[0].events[0].annotations[0]).toMatchObject({
      role: 'receiver',
      playerId: players.blair,
      frameIndex: 60,
      panoramaYaw: 0.25,
    });
    expect(restored.data.standaloneEvents).toHaveLength(1);
    expect(restored.data.highlights[0]).toMatchObject({
      description: 'Give-and-go score',
      playerIds: [players.alex, players.blair, players.casey],
    });
    expect(restored.data.manualPlayerStatistics).toEqual([{
      playerId: players.alex,
      pointsPlayed: 1,
      hockeyAssists: 1,
      assists: 0,
      goals: 0,
      blocks: 0,
    }]);
  });

  it('rolls back a statistics import when an event is invalid', () => {
    const { tracking, game, lineId, players } = configuredGame();
    const pointId = tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: {},
    }).currentPointId!;
    tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'completion',
      payload: { throwerId: players.alex, receiverId: players.blair },
    });
    const before = tracking.getSnapshot(game.token)!;
    const exported = createGameStatisticsExport(before.data);
    exported.statistics.points[0].events[0].payload = {
      throwerId: players.alex,
      receiverId: players.devon,
    };

    expect(() => tracking.importStatistics(game.token, exported))
      .toThrow('active at that timecode');
    const after = tracking.getSnapshot(game.token)!;
    expect(after.data.points[0].id).toBe(before.data.points[0].id);
    expect(after.data.points[0].events[0]).toMatchObject({
      id: before.data.points[0].events[0].id,
      payload: { throwerId: players.alex, receiverId: players.blair },
    });
  });

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
        scoringMethod: 'Break side',
        throwerPlayerId: players.blair,
        receiverPlayerId: players.alex,
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
          throwerPlayerId: players.blair,
          receiverPlayerId: players.alex,
          ourScore: 1,
          opponentScore: 0,
        },
        {
          lineId,
          startingPossession: 'defense',
          initialDefenseType: 'Zone',
          ourTurnovers: 0,
          scoringMethod: null,
          throwerPlayerId: null,
          receiverPlayerId: null,
          ourScore: 1,
          opponentScore: 1,
        },
      ],
    });

    expect(saved.data.manualPlayerStatistics).toHaveLength(1);
    expect(saved.data.manualPoints).toMatchObject([
      {
        sequenceNumber: 1,
        initialDefenseType: null,
        scoringMethod: 'Open side',
        throwerPlayerId: players.blair,
        receiverPlayerId: players.alex,
      },
      {
        sequenceNumber: 2,
        initialDefenseType: 'Zone',
        scoringMethod: null,
        throwerPlayerId: null,
        receiverPlayerId: null,
      },
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
        throwerPlayerId: null,
        receiverPlayerId: null,
        ourScore: 2,
        opponentScore: 0,
      }],
    })).toThrow('add exactly one goal');

    expect(() => tracking.saveManualSummary(game.token, {
      playerStatistics: [],
      points: [{
        lineId,
        startingPossession: 'offense',
        initialDefenseType: null,
        ourTurnovers: 0,
        scoringMethod: null,
        throwerPlayerId: players.alex,
        receiverPlayerId: players.alex,
        ourScore: 1,
        opponentScore: 0,
      }],
    })).toThrow('thrower and receiver must be different players');

    expect(() => tracking.saveManualSummary(game.token, {
      playerStatistics: [],
      points: [{
        lineId,
        startingPossession: 'defense',
        initialDefenseType: null,
        ourTurnovers: 0,
        scoringMethod: null,
        throwerPlayerId: players.alex,
        receiverPlayerId: null,
        ourScore: 0,
        opponentScore: 1,
      }],
    })).toThrow('can only name our thrower, receiver, and scoring method');
  });

  it('round-trips paper goal throwers and receivers through portable statistics', () => {
    const { tracking, game, lineId, players } = configuredGame();
    tracking.saveManualSummary(game.token, {
      playerStatistics: [],
      points: [{
        lineId,
        startingPossession: 'offense',
        initialDefenseType: null,
        ourTurnovers: 0,
        scoringMethod: 'Deep shot',
        throwerPlayerId: players.alex,
        receiverPlayerId: players.blair,
        ourScore: 1,
        opponentScore: 0,
      }],
    });
    const exported = parseGameStatisticsExport(JSON.parse(JSON.stringify(
      createGameStatisticsExport(tracking.getSnapshot(game.token)!.data),
    )) as unknown);

    tracking.saveManualSummary(game.token, { playerStatistics: [], points: [] });
    const restored = tracking.importStatistics(game.token, exported);

    expect(restored.data.manualPoints).toMatchObject([{
      throwerPlayerId: players.alex,
      receiverPlayerId: players.blair,
      scoringMethod: 'Deep shot',
    }]);
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

  it('records a positioned opponent turnover without awarding a player or line block', () => {
    const { tracking, game, lineId, players } = configuredGame();
    const pointId = tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'defense',
      startTimeMs: 1_000,
      pullerPlayerId: players.alex,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: {},
    }).currentPointId!;

    const turnover = tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'opponent_turnover',
      payload: { reason: 'unknown' },
      annotations: [{
        role: 'turnover_location',
        playerId: null,
        timeMs: 2_000,
        frameIndex: 60,
        panoramaYaw: -0.2,
        panoramaPitch: 0.04,
      }],
    });

    expect(turnover.currentPointState?.possession).toBe('offense');
    expect(turnover.data.points[0].events[0]).toMatchObject({
      type: 'opponent_turnover',
      payload: { reason: 'unknown' },
      annotations: [{ role: 'turnover_location', playerId: null }],
    });
    expect(turnover.statistics.playerStatistics.every((stats) => stats.blocks === 0)).toBe(true);
    expect(turnover.statistics.lineStatistics[0]).toMatchObject({ blocks: 0 });
  });

  it('records a positioned concession without attributing an opponent scorer', () => {
    const { tracking, game, lineId, players } = configuredGame();
    const pointId = tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'defense',
      startTimeMs: 1_000,
      pullerPlayerId: players.alex,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: {},
    }).currentPointId!;

    const conceded = tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'conceded',
      payload: { callahan: false },
      annotations: [{
        role: 'scorer',
        playerId: null,
        timeMs: 2_000,
        frameIndex: 60,
        panoramaYaw: 0.3,
        panoramaPitch: 0.04,
      }],
    });

    expect(conceded.currentPointId).toBeNull();
    expect(calculatePointState(conceded.data.points[0])).toMatchObject({
      ended: true,
      outcome: 'conceded',
    });
    expect(conceded.statistics.opponentScore).toBe(1);
    expect(conceded.data.points[0].events[0]).toMatchObject({
      type: 'conceded',
      payload: { callahan: false },
      annotations: [{ role: 'scorer', playerId: null }],
    });
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

  it('edits historical action reasons while protecting the downstream timeline', () => {
    const { tracking, game, lineId, players } = configuredGame();
    const pointId = tracking.startPoint(game.token, {
      lineId,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      playerIds: [players.alex, players.blair, players.casey],
      matchupRoleOverrides: {},
    }).currentPointId!;
    const turnover = tracking.addEvent(game.token, {
      pointId,
      timeMs: 2_000,
      type: 'turnover',
      payload: {
        throwerId: players.alex,
        intendedReceiverId: players.blair,
        reason: 'throwaway',
      },
    }).data.points[0].events[0];
    tracking.addEvent(game.token, {
      pointId,
      timeMs: 3_000,
      type: 'defended',
      payload: { defenderId: players.casey },
    });
    tracking.addEvent(game.token, {
      pointId,
      timeMs: 4_000,
      type: 'goal',
      payload: { throwerId: players.alex, receiverId: players.blair, callahan: false },
    });

    const edited = tracking.updateEvent(game.token, turnover.id, {
      pointId,
      timeMs: 2_100,
      type: 'turnover',
      payload: {
        throwerId: players.alex,
        intendedReceiverId: players.blair,
        reason: 'block',
      },
    });
    expect(edited.data.points[0].events[0]).toMatchObject({
      timeMs: 2_100,
      type: 'turnover',
      payload: { reason: 'block' },
    });
    expect(edited.data.points[0].events.map((event) => event.type))
      .toEqual(['turnover', 'defended', 'goal']);

    expect(() => tracking.updateEvent(game.token, turnover.id, {
      pointId,
      timeMs: 2_100,
      type: 'completion',
      payload: { throwerId: players.alex, receiverId: players.blair },
    })).toThrow('makes defended');
    expect(tracking.getSnapshot(game.token)!.data.points[0].events[0]).toMatchObject({
      timeMs: 2_100,
      type: 'turnover',
      payload: { reason: 'block' },
    });

    expect(() => tracking.updatePoint(game.token, pointId, {
      lineId,
      startingPossession: 'offense',
      startTimeMs: 1_000,
      pullerPlayerId: null,
      playerIds: [players.blair, players.casey, players.devon],
      matchupRoleOverrides: {},
    })).toThrow('makes turnover');
    expect(tracking.getSnapshot(game.token)!.data.points[0].startingPlayerIds)
      .toEqual([players.alex, players.blair, players.casey]);
  });
});
