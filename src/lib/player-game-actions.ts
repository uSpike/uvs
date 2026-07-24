import type {
  CompletionPayload,
  DefendedPayload,
  GoalPayload,
  TrackingGameData,
  TurnoverPayload,
} from './game-stats';

/** A video-backed positive or negative action attributed to one player. */
export interface PlayerGameAction {
  id: string;
  tone: 'highlight' | 'lowlight';
  kind: 'saved_highlight' | 'goal' | 'assist' | 'hockey_assist' | 'block' | 'turnover';
  label: string;
  detail: string;
  timeMs: number;
  eventId: number | null;
}

/** Build chronological video links using the same attribution rules as game statistics. */
export function playerGameActions(
  data: TrackingGameData,
  playerId: number,
): PlayerGameAction[] {
  if (!data.game.hasVideo) return [];
  const playerNames = new Map(data.players.map((player) => [player.id, player.name]));
  const playerName = (id: number | null): string =>
    id === null ? 'Unknown player' : playerNames.get(id) ?? 'Unknown player';
  const actions: PlayerGameAction[] = [];

  for (const point of [...data.points].sort(
    (left, right) => left.sequenceNumber - right.sequenceNumber || left.id - right.id,
  )) {
    let previousCompletion: {
      eventId: number;
      timeMs: number;
      payload: CompletionPayload;
    } | null = null;
    const pointPrefix = `Point ${point.sequenceNumber}`;

    for (const event of [...point.events].sort(
      (left, right) => left.timeMs - right.timeMs || left.id - right.id,
    )) {
      switch (event.type) {
        case 'completion': {
          const payload = event.payload as CompletionPayload;
          previousCompletion = { eventId: event.id, timeMs: event.timeMs, payload };
          break;
        }
        case 'turnover': {
          const payload = event.payload as TurnoverPayload;
          const chargedPlayerId = payload.reason === 'drop'
            ? payload.intendedReceiverId
            : payload.throwerId;
          if (chargedPlayerId === playerId) {
            actions.push({
              id: `turnover-${event.id}`,
              tone: 'lowlight',
              kind: 'turnover',
              label: turnoverLabel(payload),
              detail: turnoverDetail(payload, pointPrefix, playerName),
              timeMs: event.timeMs,
              eventId: event.id,
            });
          }
          previousCompletion = null;
          break;
        }
        case 'defended': {
          const payload = event.payload as DefendedPayload;
          if (payload.defenderId === playerId) {
            actions.push({
              id: `block-${event.id}`,
              tone: 'highlight',
              kind: 'block',
              label: 'D',
              detail: pointPrefix,
              timeMs: event.timeMs,
              eventId: event.id,
            });
          }
          previousCompletion = null;
          break;
        }
        case 'opponent_turnover':
          previousCompletion = null;
          break;
        case 'goal': {
          const payload = event.payload as GoalPayload;
          if (payload.receiverId === playerId) {
            actions.push({
              id: `goal-${event.id}`,
              tone: 'highlight',
              kind: 'goal',
              label: payload.callahan ? 'Callahan goal + D' : 'Goal',
              detail: payload.callahan
                ? pointPrefix
                : `${pointPrefix} · from ${playerName(payload.throwerId)}`,
              timeMs: event.timeMs,
              eventId: event.id,
            });
          }
          if (!payload.callahan && payload.throwerId === playerId) {
            actions.push({
              id: `assist-${event.id}`,
              tone: 'highlight',
              kind: 'assist',
              label: 'Assist',
              detail: `${pointPrefix} · to ${playerName(payload.receiverId)}`,
              timeMs: event.timeMs,
              eventId: event.id,
            });
          }
          if (
            !payload.callahan &&
            previousCompletion?.payload.throwerId === playerId &&
            previousCompletion.payload.receiverId === payload.throwerId
          ) {
            actions.push({
              id: `hockey-assist-${previousCompletion.eventId}`,
              tone: 'highlight',
              kind: 'hockey_assist',
              label: 'Hockey assist',
              detail: `${pointPrefix} · to ${playerName(payload.throwerId)}`,
              timeMs: previousCompletion.timeMs,
              eventId: previousCompletion.eventId,
            });
          }
          previousCompletion = null;
          break;
        }
        case 'conceded':
          previousCompletion = null;
          break;
        case 'possession_start':
        case 'substitution':
        case 'stoppage':
        case 'score_set':
        case 'strategy_set':
          break;
      }
    }
  }

  for (const highlight of data.highlights) {
    if (!highlight.playerIds.includes(playerId)) continue;
    actions.push({
      id: `saved-highlight-${highlight.id}`,
      tone: 'highlight',
      kind: 'saved_highlight',
      label: 'Saved highlight',
      detail: highlight.description,
      timeMs: highlight.startTimeMs,
      eventId: null,
    });
  }

  return actions.sort(
    (left, right) =>
      left.timeMs - right.timeMs ||
      toneOrder(left.tone) - toneOrder(right.tone) ||
      left.id.localeCompare(right.id),
  );
}

function turnoverLabel(payload: TurnoverPayload): string {
  switch (payload.reason) {
    case 'drop': return 'Drop';
    case 'block': return 'Blocked throw';
    case 'throwaway': return 'Throwaway';
    case 'stall': return 'Stall';
    case 'unknown': return 'Turnover';
  }
}

function turnoverDetail(
  payload: TurnoverPayload,
  pointPrefix: string,
  playerName: (id: number | null) => string,
): string {
  if (payload.reason === 'drop') {
    return `${pointPrefix} · from ${playerName(payload.throwerId)}`;
  }
  if (payload.intendedReceiverId !== null) {
    return `${pointPrefix} · intended for ${playerName(payload.intendedReceiverId)}`;
  }
  return pointPrefix;
}

function toneOrder(tone: PlayerGameAction['tone']): number {
  return tone === 'highlight' ? 0 : 1;
}
