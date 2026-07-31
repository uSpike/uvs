import { error } from '@sveltejs/kit';
import {
  createAiStatisticsDownload,
  createAiStatisticsExport,
} from '$lib/ai-statistics-export';
import { createAiStatisticsMarkdownDownload } from '$lib/ai-statistics-markdown';
import { requireTeamAccess } from '$lib/server/access';
import { selectAnalysisExportFormat } from '$lib/server/analysis-export-format';
import { GameTrackingRepository } from '$lib/server/game-tracking';
import { TournamentRepository } from '$lib/server/tournaments';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals, url }) => {
  const seasonId = positiveId(params.id, 'Season');
  const repository = new TournamentRepository();
  const setup = repository.getTeamSetup(params.slug);
  const season = setup?.rosters.find((roster) => roster.id === seasonId);
  if (!setup || !season) error(404, 'Season not found.');
  requireTeamAccess(locals, season.teamId);
  const format = requestedFormat(url.searchParams);

  const tournaments = setup.tournaments.filter(
    (tournament) => tournament.seasonRosterId === season.id,
  );
  const exported = createAiStatisticsExport({
    scope: {
      type: 'season',
      team: {
        id: setup.id,
        name: setup.name,
        slug: setup.slug,
      },
      season: {
        id: season.id,
        name: season.name,
      },
    },
    games: new GameTrackingRepository().listSeasonGameData(season.id),
    players: season.players,
    lines: tournaments.flatMap((tournament) =>
      tournament.lines.map((line) => ({
        id: line.id,
        name: line.name,
        suggestedPlayerIds: line.playerIds,
      }))
    ),
    tournaments,
  });

  const filename = `${setup.slug}-${season.name}-season-ai-stats`;
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
