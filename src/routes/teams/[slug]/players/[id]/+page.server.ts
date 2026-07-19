import { error } from '@sveltejs/kit';
import { calculateGameStatistics, mergeGameStatistics } from '$lib/game-stats';
import { GameTrackingRepository } from '$lib/server/game-tracking';
import { TournamentRepository } from '$lib/server/tournaments';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
  const playerId = Number(params.id);
  if (!Number.isSafeInteger(playerId) || playerId <= 0) error(404, 'Player not found.');
  const setup = new TournamentRepository().getTeamSetup(params.slug);
  if (!setup) error(404, 'Team not found.');
  const roster = setup.rosters.find((candidate) => candidate.players.some((player) => player.id === playerId));
  const player = roster?.players.find((candidate) => candidate.id === playerId);
  if (!roster || !player) error(404, 'Player not found.');

  const tracking = new GameTrackingRepository();
  const seasonGames = tracking
    .listSeasonGameData(roster.id)
    .filter((game) => game.players.some((candidate) => candidate.id === player.id));
  const calculated = seasonGames.map(calculateGameStatistics);
  const seasonStatistics = mergeGameStatistics(calculated, [player], []);
  const total = seasonStatistics.playerStatistics[0];
  const tournaments = setup.tournaments
    .filter((tournament) => tournament.seasonRosterId === roster.id)
    .map((tournament) => {
      const indexes = seasonGames
        .map((game, index) => game.game.tournamentId === tournament.id ? index : -1)
        .filter((index) => index >= 0);
      const statistics = mergeGameStatistics(
        indexes.map((index) => calculated[index]),
        [player],
        [],
      ).playerStatistics[0];
      return { id: tournament.id, name: tournament.name, statistics };
    });
  const games = seasonGames.map((game, index) => ({
    ...game.game,
    statistics: calculated[index].playerStatistics.find((stats) => stats.playerId === player.id)!,
    ourScore: calculated[index].ourScore,
    opponentScore: calculated[index].opponentScore,
  }));
  return {
    team: { name: setup.name, slug: setup.slug },
    roster,
    player,
    total,
    coverage: seasonStatistics.coverage,
    tournaments,
    games,
  };
};
