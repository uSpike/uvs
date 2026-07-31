import { describe, expect, it } from 'vitest';
import {
  createAiStatisticsExport,
  type AiStatisticsExportInput,
} from './ai-statistics-export';
import {
  AI_STATISTICS_MARKDOWN_TARGET_CHARACTERS,
  createAiStatisticsMarkdown,
  createAiStatisticsMarkdownDownload,
} from './ai-statistics-markdown';
import type { TrackingGameData, TrackingPoint } from './game-stats';

const EXPORTED_AT = '2026-07-29T12:00:00.000Z';

function gameData(id = 1, title = 'Pool play'): TrackingGameData {
  return {
    game: {
      id,
      token: `private-game-token-${id}`,
      title,
      teamName: 'Union',
      teamSlug: 'union',
      tournamentId: 7,
      tournamentName: 'Summer Invite',
      opponentName: `Rivals ${id}`,
      playedAt: `2026-07-${String(id).padStart(2, '0')}T10:00:00.000Z`,
      hasVideo: true,
      expectedPlayerCount: 3,
      initialOurScore: 0,
      initialOpponentScore: 0,
      initialLineupEndzone: 'left',
    },
    players: [
      {
        id: 1,
        name: 'Alex',
        defaultMatchupRole: 'mmp',
        gameMatchupRoleOverride: null,
        matchupRole: 'mmp',
      },
      {
        id: 2,
        name: 'Blair',
        defaultMatchupRole: 'fmp',
        gameMatchupRoleOverride: null,
        matchupRole: 'fmp',
      },
      {
        id: 3,
        name: 'Casey',
        defaultMatchupRole: 'mmp',
        gameMatchupRoleOverride: null,
        matchupRole: 'mmp',
      },
    ],
    lines: [{ id: 4, name: 'O line', suggestedPlayerIds: [1, 2, 3] }],
    strategies: [
      { id: 8, name: 'Hex', kind: 'offense', isDefault: true },
      { id: 9, name: 'Person', kind: 'defense', isDefault: true },
    ],
    points: [point(id * 100)],
    standaloneEvents: [],
    highlights: [],
    manualPlayerStatistics: [],
    manualPoints: [],
  };
}

function point(id: number): TrackingPoint {
  return {
    id,
    sequenceNumber: 1,
    lineId: 4,
    startingPossession: 'offense',
    startTimeMs: 1_000,
    pullerPlayerId: null,
    lineupEndzoneOverride: null,
    initialOffenseStrategyId: 8,
    initialDefenseStrategyId: 9,
    startingPlayerIds: [1, 2, 3],
    matchupRoleOverrides: {},
    events: [{
      id: id + 1,
      pointId: id,
      timeMs: 2_000,
      type: 'completion',
      payload: { throwerId: 1, receiverId: 2 },
      annotations: [],
      createdAt: EXPORTED_AT,
      updatedAt: EXPORTED_AT,
    }, {
      id: id + 2,
      pointId: id,
      timeMs: 3_000,
      type: 'goal',
      payload: { throwerId: 2, receiverId: 3, callahan: false },
      annotations: [],
      createdAt: EXPORTED_AT,
      updatedAt: EXPORTED_AT,
    }],
  };
}

function exportInput(
  games: TrackingGameData[],
  type: AiStatisticsExportInput['scope']['type'] = 'tournament',
): AiStatisticsExportInput {
  const first = games[0] ?? gameData();
  return {
    scope: {
      type,
      team: { id: 5, name: 'Union', slug: 'private-slug' },
      season: { id: 6, name: '2026' },
      tournament: type === 'season'
        ? null
        : {
            id: 7,
            name: 'Summer Invite',
            startsOn: '2026-07-01',
            endsOn: '2026-07-31',
          },
      game: type === 'game'
        ? {
            id: first.game.id,
            title: first.game.title,
            opponentName: first.game.opponentName,
            playedAt: first.game.playedAt,
            token: first.game.token,
          }
        : null,
    },
    games,
    players: first.players,
    lines: first.lines,
    tournaments: [{
      id: 7,
      name: 'Summer Invite',
      startsOn: '2026-07-01',
      endsOn: '2026-07-31',
      lines: [{ id: 4, name: 'O line' }],
    }],
  };
}

describe('AI statistics Markdown brief', () => {
  it('renders a self-contained direct-reading game report with compact event sequence', () => {
    const exported = createAiStatisticsExport(
      exportInput([gameData()], 'game'),
      EXPORTED_AT,
    );
    const markdown = createAiStatisticsMarkdown(exported);

    expect(markdown).toContain('# Ultimate statistics AI brief: Pool play');
    expect(markdown).toContain('pasted directly into a chat without parsing code');
    expect(markdown).toContain('**O-start / O**');
    expect(markdown).toContain('latest recorded score is not certified as a final result');
    expect(markdown).toContain('## Team point outcomes');
    expect(markdown).toContain('## Players');
    expect(markdown).toContain('| Alex |');
    expect(markdown).toContain('## Lines');
    expect(markdown).toContain('## Most-used known throwing connections');
    expect(markdown).toContain('timed P1 | O | won | 1-0');
    expect(markdown).toContain('lineup=Alex, Blair, Casey');
    expect(markdown).toContain('events=Alex→Blair; GOAL Blair→Casey');
    expect(markdown).toContain('## Suggested analysis instructions');
    expect(markdown).not.toContain('private-game-token');
    expect(markdown).not.toContain('panoramaYaw');
  });

  it('is substantially smaller than the full tournament JSON', () => {
    const games = Array.from({ length: 20 }, (_, index) =>
      gameData(index + 1, `Game ${index + 1}`));
    const exported = createAiStatisticsExport(exportInput(games), EXPORTED_AT);
    const json = JSON.stringify(exported, null, 2);
    const markdown = createAiStatisticsMarkdown(exported);

    expect(markdown.length).toBeLessThan(json.length * 0.35);
    expect(markdown.length).toBeLessThan(AI_STATISTICS_MARKDOWN_TARGET_CHARACTERS);
  });

  it('escapes table delimiters and line breaks in user-entered names', () => {
    const game = gameData();
    game.players[0].name = 'Alex | <Captain>\nNorth';
    const exported = createAiStatisticsExport(exportInput([game]), EXPORTED_AT);
    const markdown = createAiStatisticsMarkdown(exported);

    expect(markdown).toContain('Alex \\| &lt;Captain&gt; North');
    expect(markdown).not.toContain('Alex | <Captain>\nNorth');
  });

  it('bounds large point histories and says when rows were omitted', () => {
    const game = gameData();
    game.points = Array.from({ length: 1_200 }, (_, index) => ({
      ...point(10_000 + index * 10),
      sequenceNumber: index + 1,
      startTimeMs: index * 5_000,
      events: [],
    }));
    const exported = createAiStatisticsExport(exportInput([game]), EXPORTED_AT);
    const markdown = createAiStatisticsMarkdown(exported);

    expect(markdown.length).toBeLessThanOrEqual(
      AI_STATISTICS_MARKDOWN_TARGET_CHARACTERS + 1_500,
    );
    expect(markdown).toContain('additional point rows omitted');
    expect(markdown).toContain('Use the full JSON export');
  });

  it('handles an empty season without requiring a data-processing tool', () => {
    const exported = createAiStatisticsExport(exportInput([], 'season'), EXPORTED_AT);
    const markdown = createAiStatisticsMarkdown(exported);

    expect(markdown).toContain('Scope: **season**');
    expect(markdown).toContain('Included games: **0** of 0');
    expect(markdown).toContain('_No timed or paper point rows were recorded._');
  });

  it('creates a safe private Markdown download', async () => {
    const exported = createAiStatisticsExport(exportInput([gameData()]), EXPORTED_AT);
    const response = createAiStatisticsMarkdownDownload(
      exported,
      'Union "Summer Invite"\r\nAI brief',
    );

    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition'))
      .toBe('attachment; filename="Union-Summer-Invite-AI-brief.md"');
    expect(await response.text()).toContain('# Ultimate statistics AI brief');
  });
});
