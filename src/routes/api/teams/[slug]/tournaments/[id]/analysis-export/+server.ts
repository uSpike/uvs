import { error } from '@sveltejs/kit';
import {
  createAiStatisticsDownload,
  createAiStatisticsExport,
} from '$lib/ai-statistics-export';
import { createAiStatisticsMarkdownDownload } from '$lib/ai-statistics-markdown';
import { requireTeamAccess } from '$lib/server/access';
import { selectAnalysisExportFormat } from '$lib/server/analysis-export-format';
import { selectAnalysisExportGameIds } from '$lib/server/analysis-export-selection';
import { GameTrackingRepository } from '$lib/server/game-tracking';
import { TournamentRepository } from '$lib/server/tournaments';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals, url }) => {
  const tournamentId = positiveId(params.id, 'Event');
  const tournaments = new TournamentRepository();
  const tournament = tournaments.getTournament(params.slug, tournamentId);
  if (!tournament) error(404, 'Event not found.');
  requireTeamAccess(locals, tournament.teamId);
  const format = requestedFormat(url.searchParams);

  const setup = tournaments.getTeamSetup(params.slug);
  const season = setup?.rosters.find(
    (roster) => roster.id === tournament.seasonRosterId,
  );
  if (!season) error(404, 'Season not found.');

  const availableGames = new GameTrackingRepository().listTournamentGameData(
    tournament.id,
  );
  const availableGameIds = availableGames.map((game) => game.game.id);
  let includedGameIds: number[];
  try {
    includedGameIds = selectAnalysisExportGameIds(url.searchParams, availableGameIds);
  } catch (caught) {
    error(
      400,
      caught instanceof Error ? caught.message : 'Select valid games to export.',
    );
  }
  const includedGameIdSet = new Set(includedGameIds);
  const exported = createAiStatisticsExport({
    scope: {
      type: 'tournament',
      team: {
        id: tournament.teamId,
        name: tournament.teamName,
        slug: tournament.teamSlug,
      },
      season: {
        id: season.id,
        name: season.name,
      },
      tournament: {
        id: tournament.id,
        name: tournament.name,
        startsOn: tournament.startsOn,
        endsOn: tournament.endsOn,
      },
    },
    games: availableGames.filter((game) => includedGameIdSet.has(game.game.id)),
    players: season.players.filter((player) =>
      tournament.playerIds.includes(player.id)
    ),
    lines: tournament.lines.map((line) => ({
      id: line.id,
      name: line.name,
      suggestedPlayerIds: line.playerIds,
    })),
    tournaments: [tournament],
    availableGameIds,
    availableGames: availableGames.map((game) => game.game),
  });

  const filename = `${tournament.teamSlug}-${tournament.name}-event-ai-stats`;
  return format === 'markdown'
    ? createAiStatisticsMarkdownDownload(exported, filename)
    : createAiStatisticsDownload(exported, filename);
};

function positiveId(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) error(404, `${name} not found.`);
  return parsed;
}

function requestedFormat(searchParams: URLSearchParams) {
  try {
    return selectAnalysisExportFormat(searchParams);
  } catch (caught) {
    error(
      400,
      caught instanceof Error ? caught.message : 'Select a valid export format.',
    );
  }
}
