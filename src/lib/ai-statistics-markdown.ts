import type { AiStatisticsExport } from './ai-statistics-export';

/** Soft upper bound for the direct-reading Markdown packet. */
export const AI_STATISTICS_MARKDOWN_TARGET_CHARACTERS = 60_000;

const MAX_GAME_ROWS = 200;
const MAX_PLAYER_ROWS = 100;
const MAX_LINE_ROWS = 100;
const MAX_CONNECTION_ROWS = 50;
const MAX_WARNING_ROWS = 50;

type ExportedGame = AiStatisticsExport['games'][number];
type ExportedPoint = ExportedGame['rawSources']['playByPlay']['points'][number];
type ExportedEvent = ExportedPoint['events'][number];
type ResolvedPlayer = ExportedPoint['startingPlayers'][number];

/**
 * Render a compact, self-contained Markdown brief intended to fit directly in
 * an LLM conversation without requiring code execution to understand the data.
 */
export function createAiStatisticsMarkdown(exported: AiStatisticsExport): string {
  const sections = [
    headingSection(exported),
    interpretationSection(),
    scopeSection(exported),
    recordedScoreSection(exported),
    teamSection(exported),
    matchupSection(exported),
    gameTableSection(exported),
    playerSection(exported),
    playerPhaseSection(exported),
    lineSection(exported),
    connectionSection(exported),
    warningSection(exported),
  ];
  const base = sections.filter(Boolean).join('\n\n');
  const pointSection = pointSequenceSection(
    exported,
    Math.max(0, AI_STATISTICS_MARKDOWN_TARGET_CHARACTERS - base.length - 400),
  );
  return `${[base, pointSection, analysisPromptSection()].filter(Boolean).join('\n\n')}\n`;
}

/** Serialize a compact AI brief as a private, non-cacheable Markdown download. */
export function createAiStatisticsMarkdownDownload(
  exported: AiStatisticsExport,
  filenameBase: string,
): Response {
  const safeBase = filenameBase
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'uvs-ai-statistics-brief';
  return new Response(createAiStatisticsMarkdown(exported), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${safeBase}.md"`,
      'cache-control': 'private, no-store',
    },
  });
}

function headingSection(exported: AiStatisticsExport): string {
  const scopeName = exported.scope.game?.title ??
    exported.scope.tournament?.name ??
    exported.scope.season?.name ??
    exported.scope.team.name;
  return [
    `# Ultimate statistics AI brief: ${inline(scopeName)}`,
    '',
    `Tracked team: **${inline(exported.scope.team.name)}**  `,
    `Scope: **${inline(exported.scope.type)}**  `,
    `Exported: ${inline(exported.exportedAt)}`,
    '',
    '> Compact direct-reading report. It can be pasted directly into a chat without parsing code. It includes definitions, calculated totals, source quality, and point sequences. The separate full JSON export retains every supported event field for code-assisted analysis.',
  ].join('\n');
}

function interpretationSection(): string {
  return [
    '## Read this first',
    '',
    '- Sport: Ultimate (flying disc), a possession sport. A point begins with a pull and ends with a goal.',
    '- “Tracked team,” “our,” and “we” mean the team named above. Results and scores use that perspective.',
    '- **O-start / O**: the tracked team began the point receiving on offense. **D-start / D**: it began by pulling on defense.',
    '- Every player field prefixed O or D is grouped by how the point started, not possession when the action occurred.',
    '- **Hold**: win an O-start. **Break**: win a D-start. **Break against**: lose an O-start. **Clean hold**: win an O-start without a tracked-team turnover.',
    '- A completed point needs a first `goal` or `conceded` event. Actions in an open point can still contribute action totals.',
    '- The latest recorded score is not certified as a final result; the database has no game-completed flag.',
    '- `null`, `n/a`, and `?` mean unknown, unavailable, or not estimable. A numeric zero can also mean a paper source did not capture that field.',
    '- Paper player totals replace only points, hockey assists, assists, goals, blocks, and extended plus/minus. Paper extended plus/minus is G+A+blocks and omits negatives.',
    '- Paper point summaries replace team/line point outcomes when present. Never add raw paper and play-by-play records together.',
    '- MMP/FMP are recorded mixed-Ultimate matchup-role labels. Do not infer identity or gender from them.',
    '- Player `+/-` is point results while active at the score. `E+/-` adds goals, assists, and credited blocks and subtracts charged turnovers; paper E+/- has the limitation above.',
    '- A defensive conversion opportunity starts at an opponent turnover; it converts when the tracked team scores before its next turnover. A Callahan is an immediate defensive goal.',
    '- Durations are derived from video-relative milliseconds. Rates should be recomputed from the shown numerator/denominator; use `n/a` for a zero denominator.',
    '- Report sample sizes, warnings, and source limitations. Treat patterns as associations, not proof of causation.',
    '',
    'Metric shorthand: `P` points; `O P/W` O-start points/wins; `D P/W` D-start points/wins; `C/Att` completions/throwing attempts; `Rec/Tgt` receptions/targets; `TO` turnovers; `G/A/HA/B` goals/assists/hockey assists/blocks; `+/-` point plus-minus; `E+/-` event extended plus-minus; `DC` defensive conversions/opportunities.',
  ].join('\n');
}

function scopeSection(exported: AiStatisticsExport): string {
  const coverage = exported.aggregate.derivedStatistics.coverage;
  const quality = exported.aggregate.dataQuality;
  const profiles = quality.sourceProfiles;
  const lines = [
    '## Scope and source quality',
    '',
    `- Included games: **${exported.scope.includedGameIds.length}** of ${exported.scope.availableGameIds.length}`,
    `- Coverage: ${coverage.playByPlayGames} with timed points; ${coverage.paperPlayerGames} with paper player totals; ${coverage.paperPointGames} with paper point summaries. These categories overlap.`,
    `- Source profiles: ${profiles.timedPointOnlyGames} timed-only; ${profiles.paperOnlyGames} paper-only; ${profiles.hybridGames} hybrid; ${profiles.standaloneTimelineOnlyGames} standalone-timeline-only; ${profiles.gamesWithoutStatisticalSource} without a statistical source.`,
    `- Data-quality status: **${inline(quality.status)}**`,
    `- Reducer warnings: **${quality.warningCount}** across ${quality.gamesWithWarnings} games`,
  ];
  if (exported.scope.excludedGames.length > 0) {
    lines.push('', 'Excluded games (not present in totals or point sequences):');
    for (const game of exported.scope.excludedGames) {
      lines.push(
        `- ${inline(game.playedAt ?? 'date unknown')} — ${inline(game.title ?? 'untitled game')} vs ${inline(game.opponentName ?? 'unknown opponent')}`,
      );
    }
  }
  return lines.join('\n');
}

function recordedScoreSection(exported: AiStatisticsExport): string {
  const score = exported.aggregate.recordedScoreSummary;
  return [
    '## Latest recorded score comparison',
    '',
    '> These are not certified wins/losses because game completion is unknown.',
    '',
    table(
      ['Games', 'Tracked team ahead', 'Opponent ahead', 'Level', 'Score total', 'Differential'],
      [[
        score.gamesCompared,
        score.trackedTeamAhead,
        score.opponentAhead,
        score.level,
        `${score.trackedTeamScoreTotal}-${score.opponentScoreTotal}`,
        signed(score.recordedScoreDifferential),
      ]],
    ),
  ].join('\n');
}

function teamSection(exported: AiStatisticsExport): string {
  const stats = exported.aggregate.derivedStatistics.teamStatistics;
  return [
    '## Team point outcomes',
    '',
    table(
      ['P', 'O P/W', 'Hold %', 'D P/W', 'Break %', 'Clean holds', 'DC'],
      [[
        stats.pointsPlayed,
        `${stats.oPointsPlayed}/${stats.oPointsWon}`,
        percentage(stats.oPointsWon, stats.oPointsPlayed),
        `${stats.dPointsPlayed}/${stats.dPointsWon}`,
        percentage(stats.dPointsWon, stats.dPointsPlayed),
        stats.cleanHolds,
        `${stats.defensiveConversions}/${stats.defensiveConversionOpportunities}`,
      ]],
    ),
  ].join('\n');
}

function matchupSection(exported: AiStatisticsExport): string {
  const matchups = exported.aggregate.derivedStatistics.matchupStatistics;
  if (
    matchups.mmp.pointsPlayed === 0 &&
    matchups.fmp.pointsPlayed === 0 &&
    matchups.unclassifiedPoints === 0
  ) return '';
  return [
    '## Pull-lineup matchup outcomes',
    '',
    table(
      ['Matchup', 'P/W', 'O P/W', 'D P/W'],
      [
        [
          'MMP',
          `${matchups.mmp.pointsPlayed}/${matchups.mmp.pointsWon}`,
          `${matchups.mmp.oPointsPlayed}/${matchups.mmp.oPointsWon}`,
          `${matchups.mmp.dPointsPlayed}/${matchups.mmp.dPointsWon}`,
        ],
        [
          'FMP',
          `${matchups.fmp.pointsPlayed}/${matchups.fmp.pointsWon}`,
          `${matchups.fmp.oPointsPlayed}/${matchups.fmp.oPointsWon}`,
          `${matchups.fmp.dPointsPlayed}/${matchups.fmp.dPointsWon}`,
        ],
        ['Unclassified', matchups.unclassifiedPoints, 'n/a', 'n/a'],
      ],
    ),
  ].join('\n');
}

function gameTableSection(exported: AiStatisticsExport): string {
  const games = exported.games.slice(0, MAX_GAME_ROWS);
  const rows = games.map((game) => [
    game.playedAt ?? 'unknown',
    game.title,
    game.tournamentName,
    game.opponentName,
    `${game.score.latestRecorded.trackedTeam}-${game.score.latestRecorded.opponent}`,
    game.derivedStatistics.teamStatistics.pointsPlayed,
    game.sources.timedPointPlayByPlay ? 'yes' : 'no',
    paperLabel(game),
    game.dataQuality.status,
    game.warnings.length,
  ]);
  return [
    '## Games',
    '',
    table(
      ['Date', 'Game', 'Event', 'Opponent', 'Latest score', 'Completed P', 'Timed', 'Paper', 'Quality', 'Warn'],
      rows,
    ),
    truncationNote(exported.games.length, games.length, 'games'),
  ].filter(Boolean).join('\n');
}

function playerSection(exported: AiStatisticsExport): string {
  const statistics = exported.aggregate.derivedStatistics.playerStatistics;
  const recorded = statistics.filter((stats) => stats.gamesPlayed > 0);
  const players = recorded.slice(0, MAX_PLAYER_ROWS);
  const rows = players.map((stats) => [
    stats.playerName,
    stats.gamesPlayed,
    durationMinutes(stats.timePlayedMs),
    stats.pointsPlayed,
    `${stats.oPointsPlayed}/${stats.oPointsWon}`,
    `${stats.dPointsPlayed}/${stats.dPointsWon}`,
    `${stats.completions}/${stats.throwingAttempts}`,
    percentage(stats.completions, stats.throwingAttempts),
    `${stats.receptions}/${stats.receivingTargets}`,
    stats.turnovers,
    `${stats.goals}/${stats.assists}/${stats.hockeyAssists}/${stats.blocks}`,
    signed(stats.plusMinus),
    signed(stats.extendedPlusMinus),
    durationMinutes(stats.timeWithDiscMs),
  ]);
  return [
    '## Players',
    '',
    table(
      ['Player', 'GP', 'Min', 'P', 'O P/W', 'D P/W', 'C/Att', 'C%', 'Rec/Tgt', 'TO', 'G/A/HA/B', '+/-', 'E+/-', 'Disc min'],
      rows,
    ),
    truncationNote(recorded.length, players.length, 'players with recorded statistics'),
    statistics.length > recorded.length
      ? `\n_${statistics.length - recorded.length} roster players with no recorded contribution omitted._`
      : '',
  ].filter(Boolean).join('\n');
}

function playerPhaseSection(exported: AiStatisticsExport): string {
  if (exported.aggregate.derivedStatistics.coverage.playByPlayGames === 0) return '';
  const players = exported.aggregate.derivedStatistics.playerStatistics
    .filter((stats) => stats.gamesPlayed > 0)
    .slice(0, MAX_PLAYER_ROWS);
  const rows = players.map((stats) => [
    stats.playerName,
    `${stats.oCompletions}/${stats.oThrowingAttempts}`,
    `${stats.oReceptions}/${stats.oReceivingTargets}`,
    `${stats.oTouches}/${stats.oTurnovers}`,
    `${stats.oGoals}/${stats.oAssists}/${stats.oHockeyAssists}/${stats.oBlocks}`,
    `${stats.dCompletions}/${stats.dThrowingAttempts}`,
    `${stats.dReceptions}/${stats.dReceivingTargets}`,
    `${stats.dTouches}/${stats.dTurnovers}`,
    `${stats.dGoals}/${stats.dAssists}/${stats.dHockeyAssists}/${stats.dBlocks}`,
  ]);
  return [
    '## Player actions by point start',
    '',
    table(
      ['Player', 'O C/Att', 'O Rec/Tgt', 'O Touch/TO', 'O G/A/HA/B', 'D C/Att', 'D Rec/Tgt', 'D Touch/TO', 'D G/A/HA/B'],
      rows,
    ),
  ].join('\n');
}

function lineSection(exported: AiStatisticsExport): string {
  const statistics = exported.aggregate.derivedStatistics.lineStatistics;
  const recorded = statistics.filter((stats) =>
    stats.pointsPlayed > 0 ||
    stats.completions > 0 ||
    stats.turnovers > 0 ||
    stats.blocks > 0);
  if (recorded.length === 0) return '';
  const references = new Map(exported.references.lines.map((line) => [line.id, line]));
  const tournaments = new Map(
    exported.references.tournaments.map((tournament) => [tournament.id, tournament.name]),
  );
  const lines = recorded.slice(0, MAX_LINE_ROWS);
  const rows = lines.map((stats) => {
    const reference = references.get(stats.lineId);
    const tournament = reference?.tournamentId === null
      ? null
      : tournaments.get(reference?.tournamentId ?? -1);
    return [
      tournament ?? 'event unknown',
      stats.lineName,
      stats.pointsPlayed,
      `${stats.oPointsPlayed}/${stats.oPointsWon}`,
      `${stats.dPointsPlayed}/${stats.dPointsWon}`,
      stats.cleanHolds,
      `${stats.defensiveConversions}/${stats.defensiveConversionOpportunities}`,
      stats.completions,
      stats.turnovers,
      stats.blocks,
      `${stats.goalsFor}-${stats.goalsAgainst}`,
      signed(stats.plusMinus),
    ];
  });
  return [
    '## Lines',
    '',
    table(
      ['Event', 'Line', 'P', 'O P/W', 'D P/W', 'Clean', 'DC', 'C', 'TO', 'B', 'GF-GA', '+/-'],
      rows,
    ),
    truncationNote(recorded.length, lines.length, 'lines with recorded statistics'),
  ].filter(Boolean).join('\n');
}

function connectionSection(exported: AiStatisticsExport): string {
  const statistics = [...exported.aggregate.derivedStatistics.connectionStatistics]
    .sort((left, right) =>
      right.attempts - left.attempts ||
      right.completions - left.completions ||
      left.throwerName.localeCompare(right.throwerName))
    .slice(0, MAX_CONNECTION_ROWS);
  if (statistics.length === 0) return '';
  const rows = statistics.map((stats) => [
    stats.throwerName,
    stats.receiverName,
    stats.attempts,
    stats.completions,
    percentage(stats.completions, stats.attempts),
    stats.goals,
    stats.turnovers,
  ]);
  return [
    `## Most-used known throwing connections (top ${MAX_CONNECTION_ROWS})`,
    '',
    table(['Thrower', 'Receiver', 'Att', 'C', 'C%', 'Goals', 'TO'], rows),
    truncationNote(
      exported.aggregate.derivedStatistics.connectionStatistics.length,
      statistics.length,
      'connections',
    ),
  ].filter(Boolean).join('\n');
}

function warningSection(exported: AiStatisticsExport): string {
  const warnings = exported.games.flatMap((game) =>
    game.warnings.map((warning) => `${game.title} vs ${game.opponentName}: ${warning}`));
  if (warnings.length === 0) {
    return [
      '## Reducer warnings',
      '',
      'No reducer warnings were recorded. This does not prove that recording is complete.',
    ].join('\n');
  }
  const visible = warnings.slice(0, MAX_WARNING_ROWS);
  return [
    '## Reducer warnings',
    '',
    ...visible.map((warning) => `- ${inline(warning)}`),
    truncationNote(warnings.length, visible.length, 'warnings'),
  ].filter(Boolean).join('\n');
}

function pointSequenceSection(exported: AiStatisticsExport, budget: number): string {
  if (budget < 500) {
    return '## Point sequences\n\n_Point sequences omitted to keep this brief within its context-size target._';
  }
  const includeEventSequence = exported.scope.type === 'game';
  const totalRows = exported.games.reduce(
    (total, game) =>
      total +
      game.rawSources.playByPlay.points.length +
      game.rawSources.paper.pointSummaries.length,
    0,
  );
  const intro = [
    '## Point sequences',
    '',
    'Each row is one raw source record. Timed and paper rows can coexist; do not add them together. `TO` is tracked-team turnovers and `oppTO` is opponent turnovers.',
  ];
  const groups = exported.games
    .slice(0, MAX_GAME_ROWS)
    .map((game) => ({
      heading:
        `\n### ${inline(game.title)} vs ${inline(game.opponentName)} (${inline(game.playedAt ?? 'date unknown')})`,
      rows: [
        ...game.rawSources.playByPlay.points.map((point) =>
          timedPointLine(point, includeEventSequence)),
        ...game.rawSources.paper.pointSummaries.map(paperPointLine),
      ],
      selected: [] as string[],
    }))
    .filter((group) => group.rows.length > 0);
  let used = intro.join('\n').length +
    groups.reduce((length, group) => length + group.heading.length + 2, 0);
  let addedRow = true;
  while (addedRow) {
    addedRow = false;
    for (const group of groups) {
      const row = group.rows[group.selected.length];
      if (row === undefined) continue;
      const rendered = `    ${codeText(row)}`;
      if (used + rendered.length + 2 > budget) continue;
      group.selected.push(rendered);
      used += rendered.length + 2;
      addedRow = true;
    }
  }
  const visibleRows = groups.reduce((total, group) => total + group.selected.length, 0);
  const parts = [...intro];
  for (const group of groups) {
    parts.push(group.heading, ...group.selected);
  }
  if (visibleRows < totalRows) {
    parts.push(
      '',
      `_${totalRows - visibleRows} additional point rows omitted to keep this brief near ${AI_STATISTICS_MARKDOWN_TARGET_CHARACTERS.toLocaleString()} characters. Use the full JSON export for exhaustive event-level analysis._`,
    );
  }
  if (totalRows === 0) parts.push('', '_No timed or paper point rows were recorded._');
  return parts.join('\n');
}

function timedPointLine(point: ExportedPoint, includeEvents: boolean): string {
  const includedEvents = point.events.filter((event) => event.includedInDerivedStatistics);
  const turnovers = includedEvents.filter((event) => event.type === 'turnover').length;
  const opponentTurnovers = includedEvents.filter(
    (event) => event.type === 'defended' || event.type === 'opponent_turnover',
  ).length;
  const scoringEvent = includedEvents.find(
    (event) => event.type === 'goal' || event.type === 'conceded',
  );
  const details = [
    `timed P${point.sequenceNumber}`,
    point.startCode,
    point.result,
    point.scoreAfterPoint
      ? `${point.scoreAfterPoint.trackedTeam}-${point.scoreAfterPoint.opponent}`
      : 'score ?',
    point.durationMs === null ? 'duration ?' : durationClock(point.durationMs),
    `line=${point.line.lineName ?? '?'}`,
    `TO=${turnovers}`,
    `oppTO=${opponentTurnovers}`,
    `score=${scoringSummary(scoringEvent)}`,
    `O-strategy=${point.initialStrategies.offense?.strategyName ?? '?'}`,
    `D-strategy=${point.initialStrategies.defense?.strategyName ?? '?'}`,
    `lineup=${point.startingPlayers.map(playerName).join(', ') || '?'}`,
  ];
  if (includeEvents) {
    details.push(`events=${includedEvents.map(eventSummary).join('; ') || 'none'}`);
  }
  return details.join(' | ');
}

function paperPointLine(
  point: ExportedGame['rawSources']['paper']['pointSummaries'][number],
): string {
  return [
    `paper P${point.sequenceNumber}`,
    point.startCode,
    point.result,
    `${point.scoreAfterPoint.trackedTeam}-${point.scoreAfterPoint.opponent}`,
    `line=${point.line.lineName ?? '?'}`,
    `TO=${point.ourTurnovers}`,
    `score=${connectionName(point.thrower, point.receiver)}`,
    `method=${point.scoringMethod ?? '?'}`,
    `initial-defense=${point.initialDefenseType ?? '?'}`,
    `O-strategy=${point.initialStrategies.offense?.strategyName ?? '?'}`,
    `D-strategy=${point.initialStrategies.defense?.strategyName ?? '?'}`,
  ].join(' | ');
}

function eventSummary(event: ExportedEvent): string {
  switch (event.type) {
    case 'possession_start':
      return `possession ${playerName(event.actors.handler)}`;
    case 'completion':
      return connectionName(event.actors.thrower, event.actors.receiver);
    case 'turnover':
      return `TO(${String(event.payload.reason ?? '?')}) ${playerName(event.actors.chargedPlayer)}`;
    case 'defended':
      return `block ${playerName(event.actors.defender)}`;
    case 'opponent_turnover':
      return `oppTO(${String(event.payload.reason ?? '?')})`;
    case 'goal':
      return event.payload.callahan === true
        ? `CALLAHAN ${playerName(event.actors.scorer)}`
        : `GOAL ${connectionName(event.actors.thrower, event.actors.scorer)}`;
    case 'conceded':
      return event.payload.callahan === true ? 'conceded Callahan' : 'conceded';
    case 'substitution':
      return `sub ${playerName(event.actors.outgoingPlayer)}→${playerName(event.actors.incomingPlayer)}`;
    case 'stoppage':
      return `stoppage ${String(event.payload.kind ?? '?')}`;
    case 'score_set':
      return `score set ${String(event.payload.ourScore ?? '?')}-${String(event.payload.opponentScore ?? '?')}`;
    case 'strategy_set':
      return `strategy ${event.strategy?.strategyName ?? '?'}`;
  }
}

function scoringSummary(event: ExportedEvent | undefined): string {
  if (!event) return '?';
  if (event.type === 'conceded') {
    return event.payload.callahan === true ? 'opponent Callahan' : 'opponent';
  }
  if (event.type !== 'goal') return '?';
  return event.payload.callahan === true
    ? `Callahan ${playerName(event.actors.scorer)}`
    : connectionName(event.actors.thrower, event.actors.scorer);
}

function analysisPromptSection(): string {
  return [
    '## Suggested analysis instructions',
    '',
    'Using only this brief and without running code, identify meaningful patterns, strengths, weaknesses, lineup/connection tendencies, and changes across games. Separate O-start and D-start findings, cite the supporting sample size, account for paper/hybrid coverage, mention reducer warnings, and avoid causal claims that the data cannot support.',
  ].join('\n');
}

function table(headers: Array<string | number>, rows: Array<Array<string | number>>): string {
  if (rows.length === 0) return '_No rows._';
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

function cell(value: string | number): string {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\r\n]+/gu, ' ')
    .trim();
}

function inline(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replace(/([`*_[\]<>#])/gu, '\\$1')
    .replace(/[\r\n]+/gu, ' ')
    .trim();
}

function codeText(value: string): string {
  return value.replace(/[\r\n\t]+/gu, ' ').trim();
}

function percentage(numerator: number, denominator: number): string {
  if (denominator === 0) return 'n/a';
  return `${(numerator / denominator * 100).toFixed(1)}%`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function durationMinutes(milliseconds: number): string {
  return (milliseconds / 60_000).toFixed(1);
}

function durationClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function playerName(player: ResolvedPlayer | null | undefined): string {
  return player?.playerName ?? '?';
}

function connectionName(
  thrower: ResolvedPlayer | null | undefined,
  receiver: ResolvedPlayer | null | undefined,
): string {
  if (!thrower && !receiver) return '?';
  return `${playerName(thrower)}→${playerName(receiver)}`;
}

function paperLabel(game: ExportedGame): string {
  if (game.sources.paperPlayerTotals && game.sources.paperPointSummaries) return 'player+point';
  if (game.sources.paperPlayerTotals) return 'player';
  if (game.sources.paperPointSummaries) return 'point';
  return 'none';
}

function truncationNote(total: number, visible: number, label: string): string {
  return total > visible ? `\n_${total - visible} additional ${label} omitted._` : '';
}
