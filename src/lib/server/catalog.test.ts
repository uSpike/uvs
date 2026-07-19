import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { parseMetadataJsonl } from '$lib/metadata';
import { CatalogRepository } from './catalog';
import { openDatabase } from './database';
import { TournamentRepository } from './tournaments';

const metadataJsonl = [
  JSON.stringify({
    kind: 'manifest',
    manifest: {
      schema_version: 3,
      export_mode: 'web_panorama',
      video: {
        path: 'game.mp4',
        width: 1920,
        height: 540,
        codec: 'h264',
        quality: 'balanced',
      },
      roi: { space: 'panorama_yaw_pitch_radians', points: [] },
      panorama_extent: {
        yaw_min: -1.5,
        yaw_max: 1.5,
        pitch_min: -0.4,
        pitch_max: 0.4,
      },
      rig_orientation: {
        space: 'reco_framing_radians',
        tilt: 0.1,
        roll: -0.03,
      },
      video_projection: 'angular_rectangular',
      video_y_axis: 'pitch_max_to_pitch_min',
      detection_interval: 5,
      tracking_mode: 'field',
    },
  }),
  JSON.stringify({ kind: 'detections', frame_index: 5, detections: [] }),
].join('\n');

let databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases) {
    database.close();
  }
  databases = [];
});

function repository(): CatalogRepository {
  const database = openDatabase(':memory:');
  databases.push(database);
  return new CatalogRepository(database);
}

function tournamentFor(teamId: number, name = '2026 tournament'): number {
  const database = databases.at(-1);
  if (!database) throw new Error('Test database is not open.');
  const tournaments = new TournamentRepository(database);
  const rosterId = tournaments.createSeasonRoster(teamId, `${name} roster`);
  return tournaments.createTournament({
    seasonRosterId: rosterId,
    name,
    startsOn: null,
    endsOn: null,
    playerIds: [],
  });
}

function gameFields(tournamentId: number) {
  return {
    tournamentId,
    opponentName: 'Opponent',
    playedAt: null,
    playerCount: 7,
    initialOurScore: 0,
    initialOpponentScore: 0,
  };
}

describe('CatalogRepository', () => {
  it('creates paper-only games without video placeholders in repository results', () => {
    const catalog = repository();
    const team = catalog.createTeam('Union', 'team-password');
    const game = catalog.createGame({
      ...gameFields(tournamentFor(team.id)),
      title: 'Paper score sheet',
      videoSource: null,
      metadataJsonl: null,
      metadata: null,
    });

    expect(game).toMatchObject({ hasVideo: false, videoSource: null, metadataJsonl: null });
    expect(catalog.getGameViewByToken(game.token)).toMatchObject({ hasVideo: false });
    expect(catalog.getGameAdminByToken(game.token)).toMatchObject({
      hasVideo: false,
      videoSource: null,
      metadata: null,
    });
    expect(catalog.getVideoSourceByToken(game.token)).toBeNull();
    expect(catalog.getMetadataJsonByToken(game.token)).toBeNull();
    expect(catalog.resetGameSettings(game.token)).toMatchObject({
      rigTiltRadians: 0,
      rigRollRadians: 0,
    });
  });

  it('creates unique team URLs and reports game counts', () => {
    const catalog = repository();
    const first = catalog.createTeam('Madison Radicals', 'team-password');
    const second = catalog.createTeam('Madison Radicals', 'team-password');

    expect(first.slug).toBe('madison-radicals');
    expect(second.slug).toBe('madison-radicals-2');
    expect(catalog.listTeams()).toMatchObject([
      { name: 'Madison Radicals', gameCount: 0 },
      { name: 'Madison Radicals', gameCount: 0 },
    ]);
  });

  it('stores original and parsed metadata with one team-owned game', () => {
    const catalog = repository();
    const team = catalog.createTeam('Union', 'team-password');
    const metadata = parseMetadataJsonl(metadataJsonl);
    const game = catalog.createGame({
      ...gameFields(tournamentFor(team.id)),
      title: 'Union vs. Surge',
      videoSource: 'file:///srv/video/union.mp4',
      metadataJsonl,
      metadata,
    });

    expect(game.token).toHaveLength(24);
    expect(game.teamId).toBe(team.id);
    expect(game.metadataJsonl).toBe(metadataJsonl);
    expect(JSON.parse(game.metadataJson!)).toEqual(metadata);
    expect(game.settings.rigTiltRadians).toBe(0.1);
    expect(catalog.getGameViewByToken(game.token)).toMatchObject({
      title: 'Union vs. Surge',
      settings: { rigTiltRadians: 0.1 },
    });
    expect(catalog.getTeamBySlug(team.slug)?.games).toHaveLength(1);
    expect(catalog.listTeams()[0].gameCount).toBe(1);
  });

  it('updates and resets game settings', () => {
    const catalog = repository();
    const team = catalog.createTeam('Wind Chill', 'team-password');
    const metadata = parseMetadataJsonl(metadataJsonl);
    const game = catalog.createGame({
      ...gameFields(tournamentFor(team.id)),
      title: 'Week 1',
      videoSource: 'https://video.example.test/week-1.mp4',
      metadataJsonl,
      metadata,
    });
    const changed = {
      ...game.settings,
      rigTiltRadians: 0.2,
      fovDegrees: 62,
      autoCamera: { ...game.settings.autoCamera, lookAheadSeconds: 2.2 },
    };

    expect(catalog.updateGameSettings(game.token, changed)).toBe(true);
    expect(catalog.getGameByToken(game.token)?.settings).toEqual(changed);
    expect(catalog.resetGameSettings(game.token)).toMatchObject({
      rigTiltRadians: 0.1,
      rigRollRadians: -0.03,
      fovDegrees: 75,
    });
  });

  it('deletes games and updates their team game count', () => {
    const catalog = repository();
    const team = catalog.createTeam('Wind Chill', 'team-password');
    const game = catalog.createGame({
      ...gameFields(tournamentFor(team.id)),
      title: 'Game to remove',
      videoSource: null,
      metadataJsonl: null,
      metadata: null,
    });

    expect(catalog.deleteGame(game.token)).toBe(true);
    expect(catalog.deleteGame(game.token)).toBe(false);
    expect(catalog.getGameViewByToken(game.token)).toBeNull();
    expect(catalog.getTeamBySlug(team.slug)?.games).toHaveLength(0);
    expect(catalog.listTeams()[0].gameCount).toBe(0);
  });

  it('loads and updates administrator-editable game parameters', () => {
    const catalog = repository();
    const firstTeam = catalog.createTeam('Wind Chill', 'team-password');
    const secondTeam = catalog.createTeam('Union', 'team-password');
    const metadata = parseMetadataJsonl(metadataJsonl);
    const firstTournamentId = tournamentFor(firstTeam.id, 'First tournament');
    const secondTournamentId = tournamentFor(secondTeam.id, 'Second tournament');
    const game = catalog.createGame({
      ...gameFields(firstTournamentId),
      title: 'Week 1',
      videoSource: 'file:///srv/video/week-1.mp4',
      metadataJsonl,
      metadata,
    });

    expect(catalog.getGameAdminByToken(game.token)).toMatchObject({
      videoSource: 'file:///srv/video/week-1.mp4',
      metadata: {
        originalBytes: Buffer.byteLength(metadataJsonl),
        schemaVersion: 3,
        sourcePath: 'game.mp4',
        videoWidth: 1920,
        videoHeight: 540,
        detectionSampleCount: 1,
        trackSampleCount: 0,
        lastFrameIndex: 5,
      },
    });
    expect(catalog.getMetadataJsonlByToken(game.token)).toBe(metadataJsonl);

    const replacementJsonl = metadataJsonl
      .replace('"path":"game.mp4"', '"path":"replacement.mp4"')
      .replace('"width":1920', '"width":2560')
      .replace('"height":540', '"height":720')
      .replace('"frame_index":5', '"frame_index":12');
    const replacementMetadata = parseMetadataJsonl(replacementJsonl);
    const settings = {
      ...game.settings,
      fovDegrees: 62,
      autoCamera: { ...game.settings.autoCamera, lookAheadSeconds: 2.2 },
    };

    expect(
      catalog.updateGame(game.token, {
        ...gameFields(secondTournamentId),
        title: '  Union at Wind Chill  ',
        videoSource: 'https://video.example.test/replacement.mp4',
        settings,
        metadataJsonl: replacementJsonl,
        metadata: replacementMetadata,
      }),
    ).toBe(true);
    expect(catalog.getGameAdminByToken(game.token)).toMatchObject({
      title: 'Union at Wind Chill',
      teamId: secondTeam.id,
      videoSource: 'https://video.example.test/replacement.mp4',
      settings: { fovDegrees: 62, autoCamera: { lookAheadSeconds: 2.2 } },
      metadata: {
        sourcePath: 'replacement.mp4',
        videoWidth: 2560,
        videoHeight: 720,
        lastFrameIndex: 12,
      },
    });
    expect(catalog.getMetadataJsonlByToken(game.token)).toBe(replacementJsonl);
  });
});
