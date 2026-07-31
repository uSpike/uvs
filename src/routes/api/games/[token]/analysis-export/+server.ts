import { error } from '@sveltejs/kit';
import {
  createAiStatisticsDownload,
  createAiStatisticsExport,
} from '$lib/ai-statistics-export';
import { createAiStatisticsMarkdownDownload } from '$lib/ai-statistics-markdown';
import { requireGameAccess } from '$lib/server/access';
import { selectAnalysisExportFormat } from '$lib/server/analysis-export-format';
import { GameTrackingRepository } from '$lib/server/game-tracking';
import { TournamentRepository } from '$lib/server/tournaments';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals, url }) => {
  const game = requireGameAccess(locals, params.token);
  const format = requestedFormat(url.searchParams);
  const snapshot = new GameTrackingRepository().getSnapshot(game.token);
  if (!snapshot) error(404, 'Game not found.');

  const tournaments = new TournamentRepository();
  const tournament = tournaments.getTournament(game.teamSlug, game.tournamentId);
  const setup = tournaments.getTeamSetup(game.teamSlug);
  const season = setup?.rosters.find(
    (roster) => roster.id === tournament?.seasonRosterId,
  );
  if (!tournament || !season) error(404, 'Game statistics context was not found.');

  const exported = createAiStatisticsExport({
    scope: {
      type: 'game',
      team: {
        id: game.teamId,
        name: game.teamName,
        slug: game.teamSlug,
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
      game: {
        id: game.id,
        token: game.token,
        title: game.title,
        opponentName: game.opponentName,
        playedAt: game.playedAt,
      },
    },
    games: [snapshot.data],
    players: snapshot.data.players,
    lines: snapshot.data.lines,
    tournaments: [tournament],
  });

  const filename = `${game.teamSlug}-${game.title}-game-ai-stats`;
  return format === 'markdown'
    ? createAiStatisticsMarkdownDownload(exported, filename)
    : createAiStatisticsDownload(exported, filename);
};

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
