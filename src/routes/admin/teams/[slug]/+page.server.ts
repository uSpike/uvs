import { error, fail, redirect } from '@sveltejs/kit';
import { parseMetadataJsonl } from '$lib/metadata';
import { parseMatchupRole } from '$lib/matchup';
import { CatalogRepository } from '$lib/server/catalog';
import { TournamentRepository } from '$lib/server/tournaments';
import { validateVideoSource } from '$lib/server/video-source';
import type { Actions, PageServerLoad } from './$types';

const MAX_METADATA_BYTES = 128 * 1024 * 1024;

export const load: PageServerLoad = ({ params, locals, url }) => {
  requireAdmin(locals.role, url.pathname);
  const setup = new TournamentRepository().getTeamSetup(params.slug);
  if (!setup) error(404, 'Team not found.');
  const requestedSeasonId = Number(url.searchParams.get('season'));
  const selectedSeasonId = setup.rosters.some((roster) => roster.id === requestedSeasonId)
    ? requestedSeasonId
    : setup.rosters[0]?.id ?? null;
  const requestedView = url.searchParams.get('view');
  const requestedSection = url.searchParams.get('section');
  const requestedTournamentId = Number(url.searchParams.get('tournament'));
  const requestedTournament = setup.tournaments.find(
    (tournament) =>
      tournament.id === requestedTournamentId &&
      tournament.seasonRosterId === selectedSeasonId,
  );
  const selectedTournamentId = requestedTournament?.id ?? (
    requestedSection === 'events' && requestedView !== 'new-tournament'
      ? setup.tournaments.find((tournament) => tournament.seasonRosterId === selectedSeasonId)?.id ?? null
      : null
  );
  const seasonSection = requestedView === 'new-tournament' || selectedTournamentId !== null
    ? 'events' as const
    : requestedSection === 'strategies'
      ? 'strategies' as const
      : requestedSection === 'events'
        ? 'events' as const
        : 'players' as const;
  const setupView = requestedView === 'new-season' || selectedSeasonId === null
    ? 'new-season' as const
    : requestedView === 'new-tournament'
      ? 'new-tournament' as const
      : selectedTournamentId !== null
        ? 'tournament' as const
        : 'roster' as const;
  return {
    setup,
    activeTab: url.searchParams.get('tab') === 'access' ? 'access' as const : 'setup' as const,
    teamPassword: new CatalogRepository().getTeamPassword(setup.id),
    selectedSeasonId,
    selectedTournamentId,
    seasonSection,
    setupView,
  };
};

export const actions: Actions = {
  updateTeamPassword: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      const password = String(form.get('password') ?? '');
      const setup = new TournamentRepository().getTeamSetup(params.slug);
      if (!setup) error(404, 'Team not found.');
      if (!new CatalogRepository().updateTeamPassword(setup.id, password)) {
        error(404, 'Team not found.');
      }
      return { action: 'updateTeamPassword', success: true };
    } catch (caught) {
      return failure('updateTeamPassword', caught);
    }
  },

  createGame: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    const values = {
      tournamentId: Number(form.get('tournamentId')),
      title: String(form.get('title') ?? ''),
      opponentName: String(form.get('opponentName') ?? ''),
      playedAt: String(form.get('playedAt') ?? '') || null,
      playerCount: Number(form.get('playerCount')),
      initialOurScore: Number(form.get('initialOurScore')),
      initialOpponentScore: Number(form.get('initialOpponentScore')),
      hasVideo: form.has('hasVideo'),
      videoSource: String(form.get('videoSource') ?? ''),
    };
    const metadataFile = form.get('metadata');
    if (values.hasVideo && (!(metadataFile instanceof File) || metadataFile.size === 0)) {
      return fail(400, {
        action: 'createGame',
        error: 'Select a Reco metadata JSONL file.',
        values,
      });
    }
    if (values.hasVideo && metadataFile instanceof File && metadataFile.size > MAX_METADATA_BYTES) {
      return fail(413, {
        action: 'createGame',
        error: 'Metadata files must be 128 MiB or smaller.',
        values,
      });
    }

    let gameToken: string;
    try {
      const tournamentId = positiveInteger(form.get('tournamentId'), 'Event');
      if (!new TournamentRepository().getTournament(params.slug, tournamentId)) {
        throw new Error('Select an event from this team.');
      }
      const metadataJsonl = values.hasVideo ? await (metadataFile as File).text() : null;
      const metadata = metadataJsonl ? parseMetadataJsonl(metadataJsonl) : null;
      const videoSource = values.hasVideo ? await validateVideoSource(values.videoSource) : null;
      const game = new CatalogRepository().createGame({
        tournamentId,
        title: values.title,
        opponentName: values.opponentName,
        playedAt: values.playedAt,
        playerCount: values.playerCount,
        initialOurScore: values.initialOurScore,
        initialOpponentScore: values.initialOpponentScore,
        videoSource,
        metadataJsonl,
        metadata,
      });
      gameToken = game.token;
    } catch (caught) {
      return fail(400, {
        action: 'createGame',
        error: caught instanceof Error ? caught.message : 'The game could not be created.',
        values,
      });
    }
    redirect(303, `/games/${gameToken}`);
  },

  deleteGame: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      const token = String(form.get('gameToken') ?? '');
      const catalog = new CatalogRepository();
      const game = catalog.getGameViewByToken(token);
      if (!game || game.teamSlug !== params.slug) throw new Error('Game not found for this team.');
      if (!catalog.deleteGame(token)) throw new Error('Game could not be deleted.');
      return { action: 'deleteGame', success: true };
    } catch (caught) {
      return failure('deleteGame', caught);
    }
  },

  createRoster: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    let rosterId: number;
    try {
      rosterId = new TournamentRepository().createSeasonRoster(
        positiveInteger(form.get('teamId'), 'Team'),
        String(form.get('name') ?? ''),
      );
    } catch (caught) {
      return failure('createRoster', caught);
    }
    redirect(303, `/admin/teams/${params.slug}?season=${rosterId}`);
  },

  renameRoster: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().renameSeasonRoster(
        positiveInteger(form.get('seasonRosterId'), 'Season roster'),
        String(form.get('name') ?? ''),
      );
      return { action: 'renameRoster', success: true };
    } catch (caught) {
      return failure('renameRoster', caught);
    }
  },

  deleteRoster: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().deleteSeasonRoster(
        positiveInteger(form.get('seasonRosterId'), 'Season roster'),
      );
      return { action: 'deleteRoster', success: true };
    } catch (caught) {
      return failure('deleteRoster', caught);
    }
  },

  addPlayer: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().addPlayer(
        positiveInteger(form.get('seasonRosterId'), 'Season roster'),
        String(form.get('name') ?? ''),
        parseMatchupRole(form.get('matchupRole')),
      );
      return { action: 'addPlayer', success: true };
    } catch (caught) {
      return failure('addPlayer', caught);
    }
  },

  renamePlayer: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().updatePlayer(
        positiveInteger(form.get('playerId'), 'Player'),
        String(form.get('name') ?? ''),
        parseMatchupRole(form.get('matchupRole')),
      );
      return { action: 'renamePlayer', success: true };
    } catch (caught) {
      return failure('renamePlayer', caught);
    }
  },

  deletePlayer: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().deletePlayer(positiveInteger(form.get('playerId'), 'Player'));
      return { action: 'deletePlayer', success: true };
    } catch (caught) {
      return failure('deletePlayer', caught);
    }
  },

  addStrategy: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().addStrategy(
        positiveInteger(form.get('seasonRosterId'), 'Season roster'),
        strategyKind(form.get('kind')),
        String(form.get('name') ?? ''),
        form.has('makeDefault'),
      );
      return { action: 'addStrategy', success: true };
    } catch (caught) {
      return failure('addStrategy', caught);
    }
  },

  updateStrategy: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().updateStrategy(
        positiveInteger(form.get('strategyId'), 'Strategy'),
        String(form.get('name') ?? ''),
        form.has('makeDefault'),
      );
      return { action: 'updateStrategy', success: true };
    } catch (caught) {
      return failure('updateStrategy', caught);
    }
  },

  deleteStrategy: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().deleteStrategy(
        positiveInteger(form.get('strategyId'), 'Strategy'),
      );
      return { action: 'deleteStrategy', success: true };
    } catch (caught) {
      return failure('deleteStrategy', caught);
    }
  },

  createTournament: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    let seasonRosterId: number;
    let tournamentId: number;
    try {
      const repository = new TournamentRepository();
      seasonRosterId = positiveInteger(form.get('seasonRosterId'), 'Season roster');
      const seasonRoster = repository
        .getTeamSetup(params.slug)
        ?.rosters.find((roster) => roster.id === seasonRosterId);
      if (!seasonRoster) throw new Error('Select a season roster from this team.');

      tournamentId = repository.createTournament({
        seasonRosterId,
        name: String(form.get('name') ?? ''),
        startsOn: optionalString(form.get('startsOn')),
        endsOn: optionalString(form.get('endsOn')),
        playerIds: seasonRoster.players.map((player) => player.id),
      });
    } catch (caught) {
      return failure('createTournament', caught);
    }
    redirect(303, `/admin/teams/${params.slug}?season=${seasonRosterId}&tournament=${tournamentId}`);
  },

  renameTournament: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().renameTournament(
        positiveInteger(form.get('tournamentId'), 'Event'),
        String(form.get('name') ?? ''),
      );
      return { action: 'renameTournament', success: true };
    } catch (caught) {
      return failure('renameTournament', caught);
    }
  },

  deleteTournament: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().deleteTournament(
        positiveInteger(form.get('tournamentId'), 'Event'),
      );
      return { action: 'deleteTournament', success: true };
    } catch (caught) {
      return failure('deleteTournament', caught);
    }
  },

  saveTournamentRoster: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().updateTournamentPlayers(
        positiveInteger(form.get('tournamentId'), 'Event'),
        selectedIds(form, 'playerId'),
      );
      return { action: 'saveTournamentRoster', success: true };
    } catch (caught) {
      return failure('saveTournamentRoster', caught);
    }
  },

  createLine: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().createLine(
        positiveInteger(form.get('tournamentId'), 'Event'),
        String(form.get('name') ?? ''),
        selectedIds(form, 'playerId'),
      );
      return { action: 'createLine', success: true };
    } catch (caught) {
      return failure('createLine', caught);
    }
  },

  updateLine: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().updateLine(
        positiveInteger(form.get('lineId'), 'Line'),
        String(form.get('name') ?? ''),
        selectedIds(form, 'playerId'),
      );
      return { action: 'updateLine', success: true };
    } catch (caught) {
      return failure('updateLine', caught);
    }
  },

  deleteLine: async ({ request, locals, params }) => {
    requireAdmin(locals.role, `/admin/teams/${params.slug}`);
    const form = await request.formData();
    try {
      new TournamentRepository().deleteLine(positiveInteger(form.get('lineId'), 'Line'));
      return { action: 'deleteLine', success: true };
    } catch (caught) {
      return failure('deleteLine', caught);
    }
  },
};

function selectedIds(form: FormData, name: string): number[] {
  return form.getAll(name).map((value) => positiveInteger(value, 'Player'));
}

function positiveInteger(value: FormDataEntryValue | null, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Select a valid ${name.toLowerCase()}.`);
  return parsed;
}

function strategyKind(value: FormDataEntryValue | null): 'offense' | 'defense' {
  if (value !== 'offense' && value !== 'defense') {
    throw new Error('Select offense or defense.');
  }
  return value;
}

function optionalString(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function failure(action: string, caught: unknown) {
  return fail(400, {
    action,
    error: caught instanceof Error ? caught.message : 'The request could not be completed.',
  });
}

function requireAdmin(role: App.Locals['role'], next: string): void {
  if (role !== 'admin') redirect(303, `/login?next=${encodeURIComponent(next)}`);
}
