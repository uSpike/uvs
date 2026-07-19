import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { CatalogRepository } from './catalog';
import { openDatabase } from './database';
import { TournamentRepository } from './tournaments';

let database: Database.Database | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('TournamentRepository names', () => {
  it('creates editable Hex and Person defaults and safely promotes replacements', () => {
    database = openDatabase(':memory:');
    const team = new CatalogRepository(database).createTeam('Union', 'team-password');
    const tournaments = new TournamentRepository(database);
    const rosterId = tournaments.createSeasonRoster(team.id, '2026');
    expect(tournaments.getTeamSetup('union')?.rosters[0].strategies).toMatchObject([
      { kind: 'defense', name: 'Person', isDefault: true },
      { kind: 'offense', name: 'Hex', isDefault: true },
    ]);

    const zoneId = tournaments.addStrategy(rosterId, 'defense', 'Zone', true);
    tournaments.updateStrategy(zoneId, 'Junk zone', true);
    expect(tournaments.getTeamSetup('union')?.rosters[0].strategies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Person', isDefault: false }),
        expect.objectContaining({ id: zoneId, name: 'Junk zone', isDefault: true }),
      ]),
    );
    tournaments.deleteStrategy(zoneId);
    expect(tournaments.getTeamSetup('union')?.rosters[0].strategies).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Person', isDefault: true })]),
    );
    expect(() => {
      const person = tournaments.getTeamSetup('union')!.rosters[0].strategies.find(
        (strategy) => strategy.kind === 'defense',
      )!;
      tournaments.deleteStrategy(person.id);
    }).toThrow('Keep at least one');
  });

  it('renames rosters, players, and tournaments without changing their identities', () => {
    database = openDatabase(':memory:');
    const team = new CatalogRepository(database).createTeam('Union', 'team-password');
    const tournaments = new TournamentRepository(database);
    const rosterId = tournaments.createSeasonRoster(team.id, 'Old roster');
    const playerId = tournaments.addPlayer(rosterId, 'Old player', 'mmp');
    const tournamentId = tournaments.createTournament({
      seasonRosterId: rosterId,
      name: 'Old tournament',
      startsOn: null,
      endsOn: null,
      playerIds: [playerId],
    });

    tournaments.renameSeasonRoster(rosterId, '  2026 season  ');
    tournaments.updatePlayer(playerId, '  Alex Morgan  ', 'fmp');
    tournaments.renameTournament(tournamentId, '  Summer Invite  ');

    expect(tournaments.getTeamSetup('union')).toMatchObject({
      rosters: [{
        id: rosterId,
        name: '2026 season',
        players: [{ id: playerId, name: 'Alex Morgan', matchupRole: 'fmp' }],
      }],
      tournaments: [{ id: tournamentId, name: 'Summer Invite', seasonRosterName: '2026 season' }],
    });
  });

  it('rejects empty names and unknown records', () => {
    database = openDatabase(':memory:');
    const tournaments = new TournamentRepository(database);

    expect(() => tournaments.renamePlayer(999, 'Alex')).toThrow('does not exist');
    const team = new CatalogRepository(database).createTeam('Union', 'team-password');
    const rosterId = tournaments.createSeasonRoster(team.id, '2026');
    expect(() => tournaments.renameSeasonRoster(rosterId, '   ')).toThrow('required');
  });
});

describe('TournamentRepository roster deletion', () => {
  it('deletes an unused roster and all of its setup data', () => {
    database = openDatabase(':memory:');
    const team = new CatalogRepository(database).createTeam('Union', 'team-password');
    const tournaments = new TournamentRepository(database);
    const rosterId = tournaments.createSeasonRoster(team.id, 'Imported roster');
    const playerId = tournaments.addPlayer(rosterId, 'Alex', 'mmp');
    const tournamentId = tournaments.createTournament({
      seasonRosterId: rosterId,
      name: 'Imported games',
      startsOn: null,
      endsOn: null,
      playerIds: [playerId],
    });
    tournaments.createLine(tournamentId, 'O line', [playerId]);

    tournaments.deleteSeasonRoster(rosterId);

    expect(tournaments.getTeamSetup('union')).toMatchObject({ rosters: [], tournaments: [] });
    expect(database.prepare('SELECT COUNT(*) AS count FROM players').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM tournament_lines').get()).toEqual({ count: 0 });
  });

  it('does not delete a roster that owns a game', () => {
    database = openDatabase(':memory:');
    const team = new CatalogRepository(database).createTeam('Union', 'team-password');
    const tournaments = new TournamentRepository(database);
    const rosterId = tournaments.createSeasonRoster(team.id, 'Imported roster');
    const tournamentId = tournaments.createTournament({
      seasonRosterId: rosterId,
      name: 'Imported games',
      startsOn: null,
      endsOn: null,
      playerIds: [],
    });
    database.prepare(
      `INSERT INTO games (
         team_id, tournament_id, token, title, video_source,
         metadata_jsonl, metadata_json, settings_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(team.id, tournamentId, 'abcdefghijklmnopqrstuvwx', 'Legacy game', 'file:///game.mp4', '{}', '{}', '{}');

    expect(() => tournaments.deleteSeasonRoster(rosterId)).toThrow('with games cannot be deleted');
    expect(tournaments.getTeamSetup('union')?.rosters).toHaveLength(1);
  });
});

describe('TournamentRepository player and tournament deletion', () => {
  it('deletes an unused player from roster, tournament, and line selections', () => {
    database = openDatabase(':memory:');
    const team = new CatalogRepository(database).createTeam('Union', 'team-password');
    const tournaments = new TournamentRepository(database);
    const rosterId = tournaments.createSeasonRoster(team.id, '2026');
    const alex = tournaments.addPlayer(rosterId, 'Alex', 'mmp');
    const blair = tournaments.addPlayer(rosterId, 'Blair', 'fmp');
    const tournamentId = tournaments.createTournament({
      seasonRosterId: rosterId,
      name: 'Invite',
      startsOn: null,
      endsOn: null,
      playerIds: [alex, blair],
    });
    tournaments.createLine(tournamentId, 'O line', [alex, blair]);

    tournaments.deletePlayer(alex);

    expect(tournaments.getTeamSetup('union')).toMatchObject({
      rosters: [{ players: [{ id: blair, name: 'Blair' }] }],
      tournaments: [{ playerIds: [blair], lines: [{ playerIds: [blair] }] }],
    });
  });

  it('protects players referenced by recorded points', () => {
    database = openDatabase(':memory:');
    const team = new CatalogRepository(database).createTeam('Union', 'team-password');
    const tournaments = new TournamentRepository(database);
    const rosterId = tournaments.createSeasonRoster(team.id, '2026');
    const playerId = tournaments.addPlayer(rosterId, 'Alex', 'mmp');
    const tournamentId = tournaments.createTournament({
      seasonRosterId: rosterId,
      name: 'Invite',
      startsOn: null,
      endsOn: null,
      playerIds: [playerId],
    });
    const lineId = tournaments.createLine(tournamentId, 'O line', [playerId]);
    database.prepare(
      `INSERT INTO games (
         team_id, tournament_id, token, title, video_source,
         metadata_jsonl, metadata_json, settings_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(team.id, tournamentId, 'abcdefghijklmnopqrstuvwx', 'Game', 'file:///game.mp4', '{}', '{}', '{}');
    database.prepare(
      `INSERT INTO game_points (
         game_id, sequence_number, line_id, starting_possession, start_time_ms
       ) VALUES (1, 1, ?, 'offense', 0)`,
    ).run(lineId);
    database.prepare('INSERT INTO game_point_players (point_id, player_id) VALUES (1, ?)').run(playerId);

    expect(() => tournaments.deletePlayer(playerId)).toThrow('recorded point data');
    expect(tournaments.getTeamSetup('union')?.rosters[0].players).toHaveLength(1);
  });

  it('deletes an unused tournament but protects one that owns a game', () => {
    database = openDatabase(':memory:');
    const team = new CatalogRepository(database).createTeam('Union', 'team-password');
    const tournaments = new TournamentRepository(database);
    const rosterId = tournaments.createSeasonRoster(team.id, '2026');
    const removableId = tournaments.createTournament({
      seasonRosterId: rosterId,
      name: 'Removable',
      startsOn: null,
      endsOn: null,
      playerIds: [],
    });
    const usedId = tournaments.createTournament({
      seasonRosterId: rosterId,
      name: 'Used',
      startsOn: null,
      endsOn: null,
      playerIds: [],
    });
    database.prepare(
      `INSERT INTO games (
         team_id, tournament_id, token, title, video_source,
         metadata_jsonl, metadata_json, settings_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(team.id, usedId, 'abcdefghijklmnopqrstuvwx', 'Game', 'file:///game.mp4', '{}', '{}', '{}');

    tournaments.deleteTournament(removableId);
    expect(() => tournaments.deleteTournament(usedId)).toThrow('with games cannot be deleted');
    expect(tournaments.getTeamSetup('union')?.tournaments).toMatchObject([{
      id: usedId,
      games: [{ token: 'abcdefghijklmnopqrstuvwx', title: 'Game' }],
    }]);
  });
});
