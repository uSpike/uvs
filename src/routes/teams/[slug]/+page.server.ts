import { error } from '@sveltejs/kit';
import { CatalogRepository } from '$lib/server/catalog';
import { GameTrackingRepository } from '$lib/server/game-tracking';
import { TournamentRepository } from '$lib/server/tournaments';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
  const team = new CatalogRepository().getTeamBySlug(params.slug);
  if (!team) {
    error(404, 'Team not found.');
  }
  const setup = new TournamentRepository().getTeamSetup(params.slug);
  const tracking = new GameTrackingRepository();
  return {
    team,
    tournaments: setup?.tournaments ?? [],
    scores: Object.fromEntries(
      team.games.map((game) => {
        const stats = tracking.getSnapshot(game.token)?.statistics;
        return [game.id, stats ? { our: stats.ourScore, opponent: stats.opponentScore } : null];
      }),
    ),
  };
};
