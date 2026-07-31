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

function createPaperGame(
  catalog: CatalogRepository,
  tournamentId: number,
  title: string,
  playedAt: string | null = null,
) {
  return catalog.createGame({
    ...gameFields(tournamentId),
    title,
    playedAt,
    videoSource: null,
    metadataSource: null,
    metadata: null,
  });
}

describe('CatalogRepository', () => {
  it('creates paper-only games without video placeholders in repository results', () => {
    const catalog = repository();
    const team = catalog.createTeam('Union', 'team-password');
    const game = catalog.createGame({
      ...gameFields(tournamentFor(team.id)),
      title: 'Paper score sheet',
      videoSource: null,
      metadataSource: null,
      metadata: null,
    });

    expect(game).toMatchObject({ hasVideo: false, videoSource: null, metadataSource: null });
    expect(catalog.getGameViewByToken(game.token)).toMatchObject({ hasVideo: false });
    expect(catalog.getGameAdminByToken(game.token)).toMatchObject({
      hasVideo: false,
      videoSource: null,
      metadata: null,
    });
    expect(catalog.getVideoSourceByToken(game.token)).toBeNull();
    expect(catalog.getMetadataLocationByToken(game.token)).toBeNull();
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

  it('stores only a metadata URL and compact manifest with one team-owned game', () => {
    const catalog = repository();
    const team = catalog.createTeam('Union', 'team-password');
    const metadata = parseMetadataJsonl(metadataJsonl);
    const game = catalog.createGame({
      ...gameFields(tournamentFor(team.id)),
      title: 'Union vs. Surge',
      videoSource: 'file:///srv/video/union.mp4',
      metadataSource: 'https://metadata.example.test/union.metadata.jsonl',
      metadata,
    });

    expect(game.token).toHaveLength(24);
    expect(game.teamId).toBe(team.id);
    expect(game.metadataSource).toBe('https://metadata.example.test/union.metadata.jsonl');
    expect(game.settings.rigTiltRadians).toBe(0.1);
    expect(
      databases.at(-1)!
        .prepare(
          `SELECT length(metadata_jsonl) AS jsonl_bytes,
                  length(metadata_json) AS parsed_bytes,
                  metadata_source,
                  json_extract(metadata_manifest_json, '$.schema_version') AS schema_version
             FROM games
            WHERE id = ?`,
        )
        .get(game.id),
    ).toEqual({
      jsonl_bytes: 0,
      parsed_bytes: 2,
      metadata_source: 'https://metadata.example.test/union.metadata.jsonl',
      schema_version: 3,
    });
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
      metadataSource: 'https://metadata.example.test/week-1.metadata.jsonl',
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
      metadataSource: null,
      metadata: null,
    });

    expect(catalog.deleteGame(game.token)).toBe(true);
    expect(catalog.deleteGame(game.token)).toBe(false);
    expect(catalog.getGameViewByToken(game.token)).toBeNull();
    expect(catalog.getTeamBySlug(team.slug)?.games).toHaveLength(0);
    expect(catalog.listTeams()[0].gameCount).toBe(0);
  });

  it('orders games by played date with creation time and id fallbacks', () => {
    const catalog = repository();
    const team = catalog.createTeam('Union', 'team-password');
    const tournamentId = tournamentFor(team.id, 'Invite');
    const late = createPaperGame(catalog, tournamentId, 'Late', '2026-06-03T10:00');
    const undated = createPaperGame(catalog, tournamentId, 'Undated');
    const early = createPaperGame(catalog, tournamentId, 'Early', '2026-06-01T10:00');
    const sameTime = createPaperGame(catalog, tournamentId, 'Same time', '2026-06-01T10:00');
    databases.at(-1)!
      .prepare(
        `UPDATE games
            SET created_at = CASE WHEN id = ? THEN '2026-06-02T10:00:00Z' ELSE created_at END,
                sort_order = CASE id
                  WHEN ? THEN 0
                  WHEN ? THEN 1
                  WHEN ? THEN 2
                  ELSE 3
                END`,
      )
      .run(undated.id, late.id, undated.id, sameTime.id);
    const titles = () =>
      new TournamentRepository(databases.at(-1)!)
        .getTournament(team.slug, tournamentId)!
        .games.map((game) => game.title);

    expect(titles()).toEqual(['Early', 'Same time', 'Undated', 'Late']);
    expect(catalog.getTeamBySlug(team.slug)?.games.map((game) => game.title))
      .toEqual(['Early', 'Same time', 'Undated', 'Late']);
    expect(catalog.listGames().map((game) => game.title))
      .toEqual(['Early', 'Same time', 'Undated', 'Late']);

    expect(catalog.updateGame(late.token, {
      ...gameFields(tournamentId),
      title: late.title,
      playedAt: '2026-05-31T10:00',
      videoSource: null,
      settings: late.settings,
    })).toBe(true);
    expect(titles()).toEqual(['Late', 'Early', 'Same time', 'Undated']);
    expect(early.id).toBeLessThan(sameTime.id);
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
      metadataSource: 'https://metadata.example.test/week-1.metadata.jsonl',
      metadata,
    });

    expect(catalog.getGameAdminByToken(game.token)).toMatchObject({
      videoSource: 'file:///srv/video/week-1.mp4',
      metadataSource: 'https://metadata.example.test/week-1.metadata.jsonl',
      metadata: {
        storage: 'external',
        originalBytes: null,
        schemaVersion: 3,
        sourcePath: 'game.mp4',
        videoWidth: 1920,
        videoHeight: 540,
      },
    });
    expect(catalog.getMetadataLocationByToken(game.token)).toEqual({
      kind: 'external',
      source: 'https://metadata.example.test/week-1.metadata.jsonl',
    });

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
        metadataSource: 'https://metadata.example.test/replacement.metadata.jsonl',
        metadata: replacementMetadata,
      }),
    ).toBe(true);
    expect(catalog.getGameAdminByToken(game.token)).toMatchObject({
      title: 'Union at Wind Chill',
      teamId: secondTeam.id,
      videoSource: 'https://video.example.test/replacement.mp4',
      metadataSource: 'https://metadata.example.test/replacement.metadata.jsonl',
      settings: { fovDegrees: 62, autoCamera: { lookAheadSeconds: 2.2 } },
      metadata: {
        sourcePath: 'replacement.mp4',
        videoWidth: 2560,
        videoHeight: 720,
      },
    });
    expect(catalog.getMetadataLocationByToken(game.token)).toEqual({
      kind: 'external',
      source: 'https://metadata.example.test/replacement.metadata.jsonl',
    });
    expect(
      databases.at(-1)!
        .prepare('SELECT metadata_jsonl, metadata_json FROM games WHERE id = ?')
        .get(game.id),
    ).toEqual({ metadata_jsonl: '', metadata_json: '{}' });
  });

  it('keeps legacy inline metadata readable until an external URL is supplied', () => {
    const catalog = repository();
    const team = catalog.createTeam('Union', 'team-password');
    const tournamentId = tournamentFor(team.id);
    const game = createPaperGame(catalog, tournamentId, 'Legacy video');
    const metadata = parseMetadataJsonl(metadataJsonl);
    databases.at(-1)!
      .prepare(
        `UPDATE games
            SET has_video = 1,
                video_source = 'file:///srv/video/legacy.mp4',
                metadata_jsonl = ?,
                metadata_json = ?
          WHERE id = ?`,
      )
      .run(metadataJsonl, JSON.stringify(metadata), game.id);

    expect(catalog.getMetadataLocationByToken(game.token)).toEqual({
      kind: 'legacy',
      jsonl: metadataJsonl,
    });
    expect(catalog.getGameAdminByToken(game.token)).toMatchObject({
      metadataSource: null,
      metadata: { storage: 'database', originalBytes: Buffer.byteLength(metadataJsonl) },
    });

    expect(catalog.updateGame(game.token, {
      ...gameFields(tournamentId),
      title: game.title,
      videoSource: 'file:///srv/video/legacy.mp4',
      metadataSource: 'https://metadata.example.test/legacy.metadata.jsonl',
      metadata,
      settings: game.settings,
    })).toBe(true);
    expect(catalog.getMetadataLocationByToken(game.token)).toEqual({
      kind: 'external',
      source: 'https://metadata.example.test/legacy.metadata.jsonl',
    });
    expect(
      databases.at(-1)!
        .prepare('SELECT metadata_jsonl, metadata_json FROM games WHERE id = ?')
        .get(game.id),
    ).toEqual({ metadata_jsonl: '', metadata_json: '{}' });
  });
});
