import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import {
  defaultGameViewerSettings,
  parseGameViewerSettings,
  parseGameViewerSettingsJson,
  type GameViewerSettings,
} from '$lib/game-settings';
import { parseMetadataJsonl, type MetadataTimeline } from '$lib/metadata';
import { getDatabase } from './database';
import { hashTeamPassword } from './auth';

export interface TeamSummary {
  id: number;
  name: string;
  slug: string;
  gameCount: number;
  createdAt: string;
}

export interface GameSummary {
  id: number;
  token: string;
  title: string;
  teamId: number;
  teamName: string;
  teamSlug: string;
  tournamentId: number;
  tournamentName: string;
  opponentName: string;
  playedAt: string | null;
  hasVideo: boolean;
  playerCount: number;
  initialOurScore: number;
  initialOpponentScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeamWithGames {
  id: number;
  name: string;
  slug: string;
  games: GameSummary[];
}

export interface GameRecord extends GameSummary {
  videoSource: string | null;
  metadataSource: string | null;
  settings: GameViewerSettings;
}

export interface GameViewRecord extends GameSummary {
  settings: GameViewerSettings;
}

export type GameMetadataSummary = ExternalGameMetadataSummary | LegacyGameMetadataSummary;

export interface ExternalGameMetadataSummary {
  storage: 'external';
  originalBytes: null;
  schemaVersion: number;
  sourcePath: string;
  videoWidth: number;
  videoHeight: number;
  videoCodec: string;
  videoQuality: string;
  detectionInterval: number;
  trackingMode: string;
  roiPointCount: number;
}

export interface LegacyGameMetadataSummary {
  storage: 'database';
  originalBytes: number;
}

export interface GameAdminRecord extends GameViewRecord {
  videoSource: string | null;
  metadataSource: string | null;
  metadata: GameMetadataSummary | null;
}

export type GameMetadataLocation =
  | { kind: 'external'; source: string }
  | { kind: 'legacy'; jsonl: string };

export interface CreateGameInput {
  tournamentId: number;
  title: string;
  opponentName: string;
  playedAt: string | null;
  playerCount: number;
  initialOurScore: number;
  initialOpponentScore: number;
  videoSource: string | null;
  metadataSource: string | null;
  metadata: MetadataTimeline | null;
}

export interface UpdateGameInput {
  tournamentId: number;
  title: string;
  opponentName: string;
  playedAt: string | null;
  playerCount: number;
  initialOurScore: number;
  initialOpponentScore: number;
  videoSource: string | null;
  settings: GameViewerSettings;
  metadataSource?: string;
  metadata?: MetadataTimeline;
}

interface TeamRow {
  id: number;
  name: string;
  slug: string;
  game_count: number;
  created_at: string;
}

interface GameRow {
  id: number;
  token: string;
  title: string;
  team_id: number;
  team_name: string;
  team_slug: string;
  tournament_id: number;
  tournament_name: string;
  opponent_name: string;
  played_at: string | null;
  player_count: number;
  initial_our_score: number;
  initial_opponent_score: number;
  created_at: string;
  updated_at: string;
  has_video: number;
  video_source?: string;
  metadata_jsonl?: string;
  metadata_json?: string;
  metadata_source?: string;
  metadata_manifest_json?: string;
  settings_json?: string;
  metadata_bytes?: number;
}

/** SQLite-backed team and game catalog. */
export class CatalogRepository {
  constructor(private readonly database: Database.Database = getDatabase()) {}

  /** List teams and their game counts. */
  listTeams(): TeamSummary[] {
    const rows = this.database
      .prepare(
        `SELECT teams.id, teams.name, teams.slug, teams.created_at,
                COUNT(games.id) AS game_count
           FROM teams
           LEFT JOIN games ON games.team_id = teams.id
          GROUP BY teams.id
          ORDER BY teams.name COLLATE NOCASE`,
      )
      .all() as TeamRow[];
    return rows.map(mapTeamSummary);
  }

  /** Create a team with a stable, URL-safe slug. */
  createTeam(name: string, password: string): TeamSummary {
    const normalizedName = normalizeRequiredText(name, 120, 'Team name');
    const slug = this.availableTeamSlug(normalizedName);
    const result = this.database
      .prepare('INSERT INTO teams (name, slug, password_hash, password_plaintext) VALUES (?, ?, ?, ?)')
      .run(normalizedName, slug, hashTeamPassword(password), password);
    const row = this.database
      .prepare(
        `SELECT id, name, slug, created_at, 0 AS game_count
           FROM teams
          WHERE id = ?`,
      )
      .get(Number(result.lastInsertRowid)) as TeamRow;
    return mapTeamSummary(row);
  }

  /** Set or rotate a team's shared player password. */
  updateTeamPassword(teamId: number, password: string): boolean {
    if (!Number.isSafeInteger(teamId) || teamId <= 0) throw new Error('Selected team does not exist.');
    const result = this.database
      .prepare(
        `UPDATE teams
            SET password_hash = ?, password_plaintext = ?,
                password_version = password_version + 1
          WHERE id = ?`,
      )
      .run(hashTeamPassword(password), password, teamId);
    return result.changes === 1;
  }

  /** Return the displayable shared password when it has been set under the current schema. */
  getTeamPassword(teamId: number): string | null {
    if (!Number.isSafeInteger(teamId) || teamId <= 0) return null;
    const row = this.database
      .prepare('SELECT password_plaintext FROM teams WHERE id = ?')
      .get(teamId) as { password_plaintext: string | null } | undefined;
    return row?.password_plaintext ?? null;
  }

  /** Create a game with optional video and URL-backed metadata. */
  createGame(input: CreateGameInput): GameRecord {
    const title = normalizeRequiredText(input.title, 160, 'Game title');
    const opponentName = normalizeRequiredText(input.opponentName, 160, 'Opponent name');
    const hasVideo =
      input.videoSource !== null || input.metadataSource !== null || input.metadata !== null;
    if (
      hasVideo &&
      (input.videoSource === null || input.metadataSource === null || input.metadata === null)
    ) {
      throw new Error('Video games require both a video URL and metadata URL.');
    }
    const videoSource = hasVideo
      ? normalizeRequiredText(input.videoSource!, 2048, 'Video URL')
      : '';
    const metadataSource = hasVideo
      ? normalizeRequiredText(input.metadataSource!, 4096, 'Metadata URL')
      : '';
    const tournament = this.database
      .prepare(
        `SELECT tournaments.id, season_rosters.team_id
           FROM tournaments
           JOIN season_rosters ON season_rosters.id = tournaments.season_roster_id
          WHERE tournaments.id = ?`,
      )
      .get(input.tournamentId) as { id: number; team_id: number } | undefined;
    if (!tournament) throw new Error('Selected event does not exist.');
    const playedAt = normalizeOptionalDateTime(input.playedAt, 'Game date');
    const playerCount = normalizeCount(input.playerCount, 1, 20, 'Expected player count');
    const initialOurScore = normalizeCount(input.initialOurScore, 0, 999, 'Initial team score');
    const initialOpponentScore = normalizeCount(
      input.initialOpponentScore,
      0,
      999,
      'Initial opponent score',
    );

    const token = randomBytes(18).toString('base64url');
    const settings = defaultGameViewerSettings(input.metadata);
    const result = this.database
      .prepare(
        `INSERT INTO games (
           team_id, tournament_id, token, title, opponent_name, played_at,
           player_count, initial_our_score, initial_opponent_score,
           video_source, metadata_source, metadata_manifest_json,
           metadata_jsonl, metadata_json, settings_json, has_video
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tournament.team_id,
        tournament.id,
        token,
        title,
        opponentName,
        playedAt,
        playerCount,
        initialOurScore,
        initialOpponentScore,
        videoSource,
        metadataSource,
        JSON.stringify(input.metadata?.manifest ?? {}),
        '',
        '{}',
        JSON.stringify(settings),
        hasVideo ? 1 : 0,
      );
    const gameId = Number(result.lastInsertRowid);
    return this.getGameById(gameId);
  }

  /** List every game for administration. */
  listGames(): GameSummary[] {
    const rows = this.database
      .prepare(
        gameSummaryQuery(
          'ORDER BY COALESCE(games.played_at, games.created_at), games.id',
        ),
      )
      .all() as GameRow[];
    return rows.map(mapGameSummary);
  }

  /** Return one team and its games by public slug. */
  getTeamBySlug(slug: string): TeamWithGames | null {
    const team = this.database
      .prepare('SELECT id, name, slug FROM teams WHERE slug = ?')
      .get(slug) as { id: number; name: string; slug: string } | undefined;
    if (!team) {
      return null;
    }
    const games = this.database
      .prepare(
        gameSummaryQuery(
          `WHERE games.team_id = ?
           ORDER BY tournaments.starts_on, tournaments.id,
                    COALESCE(games.played_at, games.created_at), games.id`,
        ),
      )
      .all(team.id) as GameRow[];
    return { ...team, games: games.map(mapGameSummary) };
  }

  /** Return a complete game record by its unguessable token. */
  getGameByToken(token: string): GameRecord | null {
    const row = this.database
      .prepare(fullGameQuery('WHERE games.token = ?'))
      .get(token) as GameRow | undefined;
    return row ? mapGameRecord(row) : null;
  }

  /** Return game page data without loading metadata content. */
  getGameViewByToken(token: string): GameViewRecord | null {
    const row = this.database
      .prepare(gameSummaryQuery('WHERE games.token = ?'))
      .get(token) as GameRow | undefined;
    if (!row) {
      return null;
    }
    const settingsRow = this.database
      .prepare('SELECT settings_json FROM games WHERE token = ?')
      .get(token) as { settings_json: string };
    return {
      ...mapGameSummary(row),
      settings: parseGameViewerSettingsJson(settingsRow.settings_json),
    };
  }

  /** Return editable game fields and a compact metadata summary for administration. */
  getGameAdminByToken(token: string): GameAdminRecord | null {
    const row = this.database
      .prepare(adminGameQuery('WHERE games.token = ?'))
      .get(token) as GameRow | undefined;
    if (
      !row ||
      row.video_source === undefined ||
      row.metadata_source === undefined ||
      row.metadata_manifest_json === undefined ||
      row.settings_json === undefined ||
      row.metadata_bytes === undefined
    ) {
      return null;
    }

    const hasVideo = row.has_video === 1;
    const usesExternalMetadata = hasVideo && row.metadata_source.length > 0;
    return {
      ...mapGameSummary(row),
      videoSource: hasVideo ? row.video_source : null,
      metadataSource: usesExternalMetadata ? row.metadata_source : null,
      settings: parseGameViewerSettingsJson(row.settings_json),
      metadata: !hasVideo
        ? null
        : usesExternalMetadata
          ? summarizeMetadata(metadataFromStoredManifest(row.metadata_manifest_json))
          : { storage: 'database', originalBytes: row.metadata_bytes },
    };
  }

  /** Return the external source, or a legacy inline fallback pending migration. */
  getMetadataLocationByToken(token: string): GameMetadataLocation | null {
    const row = this.database
      .prepare(
        `SELECT metadata_source, metadata_jsonl
           FROM games
          WHERE token = ? AND has_video = 1`,
      )
      .get(token) as { metadata_source: string; metadata_jsonl: string } | undefined;
    if (!row) return null;
    if (row.metadata_source) return { kind: 'external', source: row.metadata_source };
    if (row.metadata_jsonl) return { kind: 'legacy', jsonl: row.metadata_jsonl };
    return null;
  }

  /** Return the private source URL used by the streaming endpoint. */
  getVideoSourceByToken(token: string): string | null {
    const row = this.database
      .prepare('SELECT video_source FROM games WHERE token = ? AND has_video = 1')
      .get(token) as { video_source: string } | undefined;
    return row?.video_source ?? null;
  }

  /** Persist validated viewer settings for a game. */
  updateGameSettings(token: string, settings: GameViewerSettings): boolean {
    const result = this.database
      .prepare(
        `UPDATE games
            SET settings_json = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE token = ?`,
      )
      .run(JSON.stringify(settings), token);
    return result.changes === 1;
  }

  /** Update all administrator-editable game fields, optionally replacing metadata. */
  updateGame(token: string, input: UpdateGameInput): boolean {
    const title = normalizeRequiredText(input.title, 160, 'Game title');
    const opponentName = normalizeRequiredText(input.opponentName, 160, 'Opponent name');
    const videoSource = input.videoSource === null
      ? null
      : normalizeRequiredText(input.videoSource, 2048, 'Video URL');
    const settings = parseGameViewerSettings(input.settings);
    const tournament = this.database
      .prepare(
        `SELECT tournaments.id, season_rosters.team_id
           FROM tournaments
           JOIN season_rosters ON season_rosters.id = tournaments.season_roster_id
          WHERE tournaments.id = ?`,
      )
      .get(input.tournamentId) as { id: number; team_id: number } | undefined;
    if (!tournament) throw new Error('Selected event does not exist.');
    const existing = this.database
      .prepare(
        `SELECT id, tournament_id, has_video, metadata_source, metadata_manifest_json,
                length(CAST(metadata_jsonl AS BLOB)) +
                  length(CAST(metadata_json AS BLOB)) AS legacy_metadata_bytes
           FROM games
          WHERE token = ?`,
      )
      .get(token) as {
        id: number;
        tournament_id: number;
        has_video: number;
        metadata_source: string;
        metadata_manifest_json: string;
        legacy_metadata_bytes: number;
      } | undefined;
    if (!existing) return false;
    if (
      existing.tournament_id !== tournament.id &&
      this.database
        .prepare(
          `SELECT 1 FROM game_points WHERE game_id = ?
           UNION ALL SELECT 1 FROM manual_game_points WHERE game_id = ?
           UNION ALL SELECT 1 FROM manual_player_game_statistics WHERE game_id = ?
           LIMIT 1`,
        )
        .get(existing.id, existing.id, existing.id)
    ) {
      throw new Error('A game with recorded points cannot move to another event.');
    }
    const playedAt = normalizeOptionalDateTime(input.playedAt, 'Game date');
    const playerCount = normalizeCount(input.playerCount, 1, 20, 'Expected player count');
    const initialOurScore = normalizeCount(input.initialOurScore, 0, 999, 'Initial team score');
    const initialOpponentScore = normalizeCount(
      input.initialOpponentScore,
      0,
      999,
      'Initial opponent score',
    );

    const replacesMetadata = input.metadataSource !== undefined || input.metadata !== undefined;
    if (replacesMetadata && (input.metadataSource === undefined || input.metadata === undefined)) {
      throw new Error('Metadata URL and validated manifest must be replaced together.');
    }

    let hasVideo = existing.has_video === 1;
    let metadataSource = existing.metadata_source;
    let metadataManifestJson = existing.metadata_manifest_json;
    let clearsLegacyMetadata = false;
    if (videoSource === null) {
      if (replacesMetadata) throw new Error('A metadata URL requires a video URL.');
      hasVideo = false;
      metadataSource = '';
      metadataManifestJson = '{}';
      clearsLegacyMetadata = true;
    } else if (replacesMetadata) {
      hasVideo = true;
      metadataSource = normalizeRequiredText(input.metadataSource!, 4096, 'Metadata URL');
      metadataManifestJson = JSON.stringify(input.metadata!.manifest);
      // Replacing a legacy record releases both large database copies.
      clearsLegacyMetadata = true;
    } else if (!hasVideo) {
      throw new Error('Enter a metadata URL when adding video to a paper-only game.');
    }

    const result = this.database
      .prepare(
        `UPDATE games
            SET team_id = ?, tournament_id = ?, title = ?, opponent_name = ?, played_at = ?,
                player_count = ?, initial_our_score = ?, initial_opponent_score = ?,
                video_source = ?, metadata_source = ?, metadata_manifest_json = ?,
                metadata_jsonl = CASE WHEN ? = 1 THEN '' ELSE metadata_jsonl END,
                metadata_json = CASE WHEN ? = 1 THEN '{}' ELSE metadata_json END,
                settings_json = ?, has_video = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE token = ?`,
      )
      .run(
        tournament.team_id,
        tournament.id,
        title,
        opponentName,
        playedAt,
        playerCount,
        initialOurScore,
        initialOpponentScore,
        videoSource ?? '',
        metadataSource,
        metadataManifestJson,
        clearsLegacyMetadata ? 1 : 0,
        clearsLegacyMetadata ? 1 : 0,
        JSON.stringify(settings),
        hasVideo ? 1 : 0,
        token,
      );
    if (
      result.changes === 1 &&
      clearsLegacyMetadata &&
      existing.legacy_metadata_bytes > 2 &&
      !this.database.inTransaction
    ) {
      // Clearing the values frees pages; VACUUM returns those pages to the filesystem.
      this.database.exec('VACUUM');
    }
    return result.changes === 1;
  }

  /** Delete a game and its dependent tracking, statistics, and share-link data. */
  deleteGame(token: string): boolean {
    const result = this.database.prepare('DELETE FROM games WHERE token = ?').run(token);
    return result.changes === 1;
  }

  /** Restore viewer settings from metadata calibration and application defaults. */
  resetGameSettings(token: string): GameViewerSettings | null {
    const row = this.database
      .prepare(
        `SELECT metadata_source, metadata_manifest_json, metadata_json, has_video
           FROM games
          WHERE token = ?`,
      )
      .get(token) as {
        metadata_source: string;
        metadata_manifest_json: string;
        metadata_json: string;
        has_video: number;
      } | undefined;
    if (!row) {
      return null;
    }
    const metadata = row.has_video !== 1
      ? null
      : row.metadata_source
        ? metadataFromStoredManifest(row.metadata_manifest_json)
        : JSON.parse(row.metadata_json) as MetadataTimeline;
    const settings = defaultGameViewerSettings(metadata);
    this.updateGameSettings(token, settings);
    return settings;
  }

  private getGameById(id: number): GameRecord {
    const row = this.database
      .prepare(fullGameQuery('WHERE games.id = ?'))
      .get(id) as GameRow | undefined;
    if (!row) {
      throw new Error('Created game could not be loaded.');
    }
    return mapGameRecord(row);
  }

  private availableTeamSlug(name: string): string {
    const base = slugify(name) || 'team';
    const exists = this.database.prepare('SELECT 1 FROM teams WHERE slug = ?');
    if (!exists.get(base)) {
      return base;
    }
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!exists.get(candidate)) {
        return candidate;
      }
    }
    throw new Error('Could not allocate a unique team URL.');
  }
}

function gameSummaryQuery(suffix: string): string {
  return `SELECT games.id, games.token, games.title, games.team_id,
                 teams.name AS team_name, teams.slug AS team_slug,
                 tournaments.id AS tournament_id, tournaments.name AS tournament_name,
                 games.opponent_name, games.played_at, games.player_count,
                 games.initial_our_score, games.initial_opponent_score,
                 games.created_at, games.updated_at, games.has_video
            FROM games
            JOIN teams ON teams.id = games.team_id
            JOIN tournaments ON tournaments.id = games.tournament_id
            ${suffix}`;
}

function fullGameQuery(suffix: string): string {
  return `SELECT games.id, games.token, games.title, games.team_id,
                 teams.name AS team_name, teams.slug AS team_slug,
                 tournaments.id AS tournament_id, tournaments.name AS tournament_name,
                 games.opponent_name, games.played_at, games.player_count,
                 games.initial_our_score, games.initial_opponent_score,
                 games.created_at, games.updated_at, games.video_source,
                 games.metadata_source, games.settings_json,
                 games.has_video
            FROM games
            JOIN teams ON teams.id = games.team_id
            JOIN tournaments ON tournaments.id = games.tournament_id
            ${suffix}`;
}

function adminGameQuery(suffix: string): string {
  return `SELECT games.id, games.token, games.title, games.team_id,
                 teams.name AS team_name, teams.slug AS team_slug,
                 tournaments.id AS tournament_id, tournaments.name AS tournament_name,
                 games.opponent_name, games.played_at, games.player_count,
                 games.initial_our_score, games.initial_opponent_score,
                 games.created_at, games.updated_at, games.video_source,
                 games.metadata_source, games.metadata_manifest_json,
                 games.settings_json,
                 length(CAST(games.metadata_jsonl AS BLOB)) AS metadata_bytes,
                 games.has_video
            FROM games
            JOIN teams ON teams.id = games.team_id
            JOIN tournaments ON tournaments.id = games.tournament_id
            ${suffix}`;
}

function mapTeamSummary(row: TeamRow): TeamSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    gameCount: row.game_count,
    createdAt: row.created_at,
  };
}

function mapGameSummary(row: GameRow): GameSummary {
  return {
    id: row.id,
    token: row.token,
    title: row.title,
    teamId: row.team_id,
    teamName: row.team_name,
    teamSlug: row.team_slug,
    tournamentId: row.tournament_id,
    tournamentName: row.tournament_name,
    opponentName: row.opponent_name,
    playedAt: row.played_at,
    hasVideo: row.has_video === 1,
    playerCount: row.player_count,
    initialOurScore: row.initial_our_score,
    initialOpponentScore: row.initial_opponent_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGameRecord(row: GameRow): GameRecord {
  if (
    row.video_source === undefined ||
    row.metadata_source === undefined ||
    row.settings_json === undefined
  ) {
    throw new Error('Game record is missing required fields.');
  }
  return {
    ...mapGameSummary(row),
    videoSource: row.has_video === 1 ? row.video_source : null,
    metadataSource: row.has_video === 1 && row.metadata_source
      ? row.metadata_source
      : null,
    settings: parseGameViewerSettingsJson(row.settings_json),
  };
}

function summarizeMetadata(
  metadata: MetadataTimeline,
): ExternalGameMetadataSummary {
  const manifest = metadata.manifest;
  return {
    storage: 'external',
    originalBytes: null,
    schemaVersion: manifest.schema_version,
    sourcePath: manifest.video.path,
    videoWidth: manifest.video.width,
    videoHeight: manifest.video.height,
    videoCodec: manifest.video.codec,
    videoQuality: manifest.video.quality,
    detectionInterval: manifest.detection_interval,
    trackingMode: manifest.tracking_mode,
    roiPointCount: manifest.roi.points.length,
  };
}

function metadataFromStoredManifest(value: string): MetadataTimeline {
  let manifest: unknown;
  try {
    manifest = JSON.parse(value);
  } catch {
    throw new Error('Stored metadata manifest is invalid.');
  }
  return parseStoredMetadataManifest(manifest);
}

function parseStoredMetadataManifest(manifest: unknown): MetadataTimeline {
  // Reuse the metadata boundary validator instead of trusting database JSON.
  const line = JSON.stringify({ kind: 'manifest', manifest });
  return parseMetadataJsonl(line);
}

function normalizeRequiredText(value: string, maximumLength: number, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }
  if (normalized.length > maximumLength) {
    throw new Error(`${name} must be ${maximumLength} characters or fewer.`);
  }
  return normalized;
}

function normalizeOptionalDateTime(value: string | null, name: string): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} must be a valid date and time.`);
  return normalized;
}

function normalizeCount(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 120);
}
