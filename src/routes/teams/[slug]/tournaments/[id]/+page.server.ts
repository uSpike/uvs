import { error } from '@sveltejs/kit';
import { calculateGameStatistics, mergeGameStatistics } from '$lib/game-stats';
import { CatalogRepository } from '$lib/server/catalog';
import { GameTrackingRepository } from '$lib/server/game-tracking';
import { TournamentRepository } from '$lib/server/tournaments';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
  const tournamentId = Number(params.id);
  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) error(404, 'Event not found.');
  const tournaments = new TournamentRepository();
  const tournament = tournaments.getTournament(params.slug, tournamentId);
  if (!tournament) error(404, 'Event not found.');
  const setup = tournaments.getTeamSetup(params.slug);
  const roster = setup?.rosters.find((candidate) => candidate.id === tournament.seasonRosterId);
  if (!setup || !roster) error(404, 'Season roster not found.');
  const players = roster.players.filter((player) => tournament.playerIds.includes(player.id));
  const lines = tournament.lines.map((line) => ({
    id: line.id,
    name: line.name,
    suggestedPlayerIds: line.playerIds,
  }));
  const tracking = new GameTrackingRepository();
  const gameData = tracking.listTournamentGameData(tournament.id);
  const calculated = gameData.map(calculateGameStatistics);
  const statisticsByGameId = new Map(
    gameData.map((data, index) => [data.game.id, calculated[index]]),
  );
  const totals = mergeGameStatistics(calculated, players, lines);
  const team = new CatalogRepository().getTeamBySlug(params.slug);
  const summaries = team?.games.filter((game) => game.tournamentId === tournament.id) ?? [];
  return {
    tournament,
    rosterId: roster.id,
    focusedGameToken: url.searchParams.get('game'),
    statistics: totals,
    games: summaries.map((game) => {
      const stats = statisticsByGameId.get(game.id) ?? null;
      return {
        ...game,
        ourScore: stats?.ourScore ?? game.initialOurScore,
        opponentScore: stats?.opponentScore ?? game.initialOpponentScore,
        statistics: stats,
      };
    }),
  };
};
