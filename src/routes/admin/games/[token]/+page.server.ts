import { error, fail, redirect } from '@sveltejs/kit';
import { parseGameViewerSettings } from '$lib/game-settings';
import { parseMetadataJsonl, type MetadataTimeline } from '$lib/metadata';
import { CatalogRepository } from '$lib/server/catalog';
import { TournamentRepository } from '$lib/server/tournaments';
import { validateVideoSource } from '$lib/server/video-source';
import type { Actions, PageServerLoad } from './$types';

const MAX_METADATA_BYTES = 128 * 1024 * 1024;
const RADIANS_PER_DEGREE = Math.PI / 180;

interface SubmittedValues {
  tournamentId: string;
  title: string;
  opponentName: string;
  playedAt: string;
  playerCount: string;
  initialOurScore: string;
  initialOpponentScore: string;
  videoSource: string;
  rigTiltDegrees: string;
  rigRollDegrees: string;
  fovDegrees: string;
  recordingMode: string;
  newAreaDelaySeconds: string;
  actionJoinDistanceDegrees: string;
  lookAheadSeconds: string;
  smoothingSeconds: string;
  maxPanSpeedDegrees: string;
  maxPanAccelerationDegrees: string;
  maxZoomAccelerationDegrees: string;
  minimumFovDegrees: string;
  framePaddingPercent: string;
}

export const load: PageServerLoad = ({ params, locals, url }) => {
  requireAdmin(locals.role, url.pathname);
  const catalog = new CatalogRepository();
  const game = catalog.getGameAdminByToken(params.token);
  if (!game) {
    error(404, 'Game not found.');
  }
  const tournaments = new TournamentRepository().listTournaments();
  return {
    game,
    tournaments,
  };
};

export const actions: Actions = {
  saveGame: async ({ request, params, locals }) => {
    requireAdmin(locals.role, `/admin/games/${params.token}`);
    const form = await request.formData();
    const values = submittedValues(form);

    let metadataJsonl: string | undefined;
    let metadata: MetadataTimeline | undefined;
    let updated = false;
    try {
      const metadataFile = form.get('metadata');
      if (metadataFile instanceof File && metadataFile.size > 0) {
        if (metadataFile.size > MAX_METADATA_BYTES) {
          return fail(413, {
            action: 'saveGame',
            error: 'Metadata files must be 128 MiB or smaller.',
            values,
          });
        }
        metadataJsonl = await metadataFile.text();
        metadata = parseMetadataJsonl(metadataJsonl);
      }

      const tournamentId = requiredInteger(values.tournamentId, 'Event');
      const videoSource = values.videoSource.trim()
        ? await validateVideoSource(values.videoSource)
        : null;
      const settings = parseGameViewerSettings({
        version: 1,
        rigTiltRadians:
          requiredNumber(values.rigTiltDegrees, 'Tilt') * RADIANS_PER_DEGREE,
        rigRollRadians:
          requiredNumber(values.rigRollDegrees, 'Roll') * RADIANS_PER_DEGREE,
        fovDegrees: requiredNumber(values.fovDegrees, 'Field of view'),
        recordingMode: values.recordingMode,
        autoCamera: {
          newAreaDelaySeconds: requiredNumber(
            values.newAreaDelaySeconds,
            'New area delay',
          ),
          actionJoinDistanceDegrees: requiredNumber(
            values.actionJoinDistanceDegrees,
            'Action reach',
          ),
          lookAheadSeconds: requiredNumber(values.lookAheadSeconds, 'Look ahead'),
          smoothingSeconds: requiredNumber(values.smoothingSeconds, 'Smooth time'),
          maxPanSpeedDegrees: requiredNumber(
            values.maxPanSpeedDegrees,
            'Maximum pan speed',
          ),
          maxPanAccelerationDegrees: requiredNumber(
            values.maxPanAccelerationDegrees,
            'Pan acceleration',
          ),
          maxZoomAccelerationDegrees: requiredNumber(
            values.maxZoomAccelerationDegrees,
            'Zoom acceleration',
          ),
          minimumFovDegrees: requiredNumber(values.minimumFovDegrees, 'Minimum FOV'),
          framePaddingPercent: requiredNumber(values.framePaddingPercent, 'Frame padding'),
        },
      });

      updated = new CatalogRepository().updateGame(params.token, {
        tournamentId,
        title: values.title,
        opponentName: values.opponentName,
        playedAt: values.playedAt || null,
        playerCount: requiredInteger(values.playerCount, 'Expected player count'),
        initialOurScore: requiredWholeNumber(values.initialOurScore, 'Initial team score'),
        initialOpponentScore: requiredWholeNumber(
          values.initialOpponentScore,
          'Initial opponent score',
        ),
        videoSource,
        settings,
        ...(metadataJsonl === undefined ? {} : { metadataJsonl, metadata: metadata! }),
      });
    } catch (caught) {
      return fail(400, {
        action: 'saveGame',
        error: errorMessage(caught),
        values,
      });
    }

    if (!updated) {
      error(404, 'Game not found.');
    }

    return { action: 'saveGame', saved: true };
  },

  resetSettings: ({ params, locals }) => {
    requireAdmin(locals.role, `/admin/games/${params.token}`);
    if (!new CatalogRepository().resetGameSettings(params.token)) {
      error(404, 'Game not found.');
    }
    return { action: 'resetSettings', reset: true };
  },

  deleteGame: ({ params, locals }) => {
    requireAdmin(locals.role, `/admin/games/${params.token}`);
    const catalog = new CatalogRepository();
    const game = catalog.getGameViewByToken(params.token);
    if (!game) error(404, 'Game not found.');
    if (!catalog.deleteGame(params.token)) error(404, 'Game not found.');
    redirect(303, `/admin/teams/${game.teamSlug}`);
  },

};

function submittedValues(form: FormData): SubmittedValues {
  return {
    tournamentId: String(form.get('tournamentId') ?? ''),
    title: String(form.get('title') ?? ''),
    opponentName: String(form.get('opponentName') ?? ''),
    playedAt: String(form.get('playedAt') ?? ''),
    playerCount: String(form.get('playerCount') ?? ''),
    initialOurScore: String(form.get('initialOurScore') ?? ''),
    initialOpponentScore: String(form.get('initialOpponentScore') ?? ''),
    videoSource: String(form.get('videoSource') ?? ''),
    rigTiltDegrees: String(form.get('rigTiltDegrees') ?? ''),
    rigRollDegrees: String(form.get('rigRollDegrees') ?? ''),
    fovDegrees: String(form.get('fovDegrees') ?? ''),
    recordingMode: String(form.get('recordingMode') ?? ''),
    newAreaDelaySeconds: String(form.get('newAreaDelaySeconds') ?? ''),
    actionJoinDistanceDegrees: String(form.get('actionJoinDistanceDegrees') ?? ''),
    lookAheadSeconds: String(form.get('lookAheadSeconds') ?? ''),
    smoothingSeconds: String(form.get('smoothingSeconds') ?? ''),
    maxPanSpeedDegrees: String(form.get('maxPanSpeedDegrees') ?? ''),
    maxPanAccelerationDegrees: String(form.get('maxPanAccelerationDegrees') ?? ''),
    maxZoomAccelerationDegrees: String(form.get('maxZoomAccelerationDegrees') ?? ''),
    minimumFovDegrees: String(form.get('minimumFovDegrees') ?? ''),
    framePaddingPercent: String(form.get('framePaddingPercent') ?? ''),
  };
}

function requiredNumber(value: string, name: string): number {
  if (!value.trim()) {
    throw new Error(`${name} is required.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number.`);
  }
  return parsed;
}

function requiredInteger(value: string, name: string): number {
  const parsed = requiredNumber(value, name);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Select a ${name.toLowerCase()}.`);
  }
  return parsed;
}

function requiredWholeNumber(value: string, name: string): number {
  const parsed = requiredNumber(value, name);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative whole number.`);
  }
  return parsed;
}

function requireAdmin(role: App.Locals['role'], next: string): void {
  if (role !== 'admin') {
    redirect(303, `/login?next=${encodeURIComponent(next)}`);
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'The game could not be updated.';
}
