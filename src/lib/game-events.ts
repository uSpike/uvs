import type {
  CompletionPayload,
  ConcededPayload,
  DefendedPayload,
  GameEventPayload,
  GameEventType,
  GoalPayload,
  OpponentTurnoverPayload,
  OpponentTurnoverReason,
  PossessionStartPayload,
  ScoreSetPayload,
  StoppageKind,
  StoppagePayload,
  StrategyKind,
  StrategySetPayload,
  SubstitutionPayload,
  TurnoverPayload,
  TurnoverReason,
} from './game-stats';

const EVENT_TYPES = new Set<GameEventType>([
  'possession_start',
  'completion',
  'turnover',
  'defended',
  'opponent_turnover',
  'goal',
  'conceded',
  'substitution',
  'stoppage',
  'score_set',
  'strategy_set',
]);
const TURNOVER_REASONS = new Set<TurnoverReason>([
  'drop',
  'block',
  'throwaway',
  'unknown',
]);
const OPPONENT_TURNOVER_REASONS = new Set<OpponentTurnoverReason>([
  'drop',
  'throwaway',
  'unknown',
]);
const STOPPAGE_KINDS = new Set<StoppageKind>(['foul', 'injury', 'timeout', 'other']);
const STRATEGY_KINDS = new Set<StrategyKind>(['offense', 'defense']);

/** Parse and validate an event type supplied at an API boundary. */
export function parseGameEventType(value: unknown): GameEventType {
  if (typeof value !== 'string' || !EVENT_TYPES.has(value as GameEventType)) {
    throw new Error('Select a supported event type.');
  }
  return value as GameEventType;
}

/** Parse a typed event payload while preserving deliberately unknown players as null. */
export function parseGameEventPayload(
  type: GameEventType,
  value: unknown,
): GameEventPayload {
  const payload = record(value, 'Event details');
  switch (type) {
    case 'possession_start':
      return {
        playerId: optionalId(payload.playerId, 'Player with disc'),
      } satisfies PossessionStartPayload;
    case 'completion':
      {
        const throwerId = optionalId(payload.throwerId, 'Thrower');
        const receiverId = optionalId(payload.receiverId, 'Receiver');
        if (throwerId !== null && throwerId === receiverId) {
          throw new Error('Thrower and receiver must be different players.');
        }
        return { throwerId, receiverId } satisfies CompletionPayload;
      }
    case 'turnover':
      return {
        throwerId: optionalId(payload.throwerId, 'Thrower'),
        intendedReceiverId: optionalId(payload.intendedReceiverId, 'Intended receiver'),
        reason: member(payload.reason, TURNOVER_REASONS, 'Turnover reason'),
      } satisfies TurnoverPayload;
    case 'defended':
      return {
        defenderId: optionalId(payload.defenderId, 'Defender'),
      } satisfies DefendedPayload;
    case 'opponent_turnover':
      return {
        reason: member(payload.reason, OPPONENT_TURNOVER_REASONS, 'Turnover reason'),
      } satisfies OpponentTurnoverPayload;
    case 'goal': {
      const callahan = boolean(payload.callahan, 'Callahan');
      const throwerId = optionalId(payload.throwerId, 'Thrower');
      if (callahan && throwerId !== null) {
        throw new Error('A Callahan cannot have a thrower.');
      }
      const receiverId = optionalId(payload.receiverId, 'Receiver');
      if (!callahan && throwerId !== null && throwerId === receiverId) {
        throw new Error('Thrower and scorer must be different players.');
      }
      return {
        throwerId,
        receiverId,
        callahan,
      } satisfies GoalPayload;
    }
    case 'conceded':
      return { callahan: boolean(payload.callahan, 'Callahan') } satisfies ConcededPayload;
    case 'substitution': {
      const outgoingPlayerId = optionalId(payload.outgoingPlayerId, 'Outgoing player');
      const incomingPlayerId = optionalId(payload.incomingPlayerId, 'Incoming player');
      if (outgoingPlayerId !== null && outgoingPlayerId === incomingPlayerId) {
        throw new Error('Select two different players for a substitution.');
      }
      return { outgoingPlayerId, incomingPlayerId } satisfies SubstitutionPayload;
    }
    case 'stoppage': {
      const endTimeMs = optionalTime(payload.endTimeMs, 'Stoppage end time');
      return {
        kind: member(payload.kind, STOPPAGE_KINDS, 'Stoppage type'),
        endTimeMs,
      } satisfies StoppagePayload;
    }
    case 'score_set':
      return {
        ourScore: score(payload.ourScore, 'Our score'),
        opponentScore: score(payload.opponentScore, 'Opponent score'),
      } satisfies ScoreSetPayload;
    case 'strategy_set':
      return {
        kind: member(payload.kind, STRATEGY_KINDS, 'Strategy type'),
        strategyId: positiveId(payload.strategyId, 'Strategy'),
      } satisfies StrategySetPayload;
  }
}

/** Format an event type for timeline controls. */
export function gameEventLabel(type: GameEventType): string {
  switch (type) {
    case 'possession_start': return 'Start possession';
    case 'completion': return 'Completion';
    case 'turnover': return 'Turnover';
    case 'defended': return 'Defended';
    case 'opponent_turnover': return 'Opponent turnover';
    case 'goal': return 'Goal';
    case 'conceded': return 'Conceded';
    case 'substitution': return 'Substitution';
    case 'stoppage': return 'Stoppage';
    case 'score_set': return 'Score set';
    case 'strategy_set': return 'Strategy change';
  }
}

/** Return whether an event is missing player attribution that may be completed later. */
export function gameEventIsIncomplete(type: GameEventType, payload: GameEventPayload): boolean {
  switch (type) {
    case 'possession_start':
      return (payload as PossessionStartPayload).playerId === null;
    case 'completion': {
      const value = payload as CompletionPayload;
      return value.throwerId === null || value.receiverId === null;
    }
    case 'turnover': {
      const value = payload as TurnoverPayload;
      return value.throwerId === null || (value.reason === 'drop' && value.intendedReceiverId === null);
    }
    case 'defended':
      return (payload as DefendedPayload).defenderId === null;
    case 'goal': {
      const value = payload as GoalPayload;
      return value.receiverId === null || (!value.callahan && value.throwerId === null);
    }
    case 'substitution': {
      const value = payload as SubstitutionPayload;
      return value.outgoingPlayerId === null || value.incomingPlayerId === null;
    }
    case 'opponent_turnover':
    case 'conceded':
    case 'stoppage':
    case 'score_set':
    case 'strategy_set':
      return false;
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalId(value: unknown, name: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must reference a player.`);
  }
  return parsed;
}

function optionalTime(value: unknown, name: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative timecode.`);
  }
  return parsed;
}

function positiveId(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} selection is invalid.`);
  }
  return parsed;
}

function score(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 999) {
    throw new Error(`${name} must be a whole number between 0 and 999.`);
  }
  return parsed;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be true or false.`);
  return value;
}

function member<T extends string>(value: unknown, values: Set<T>, name: string): T {
  if (typeof value !== 'string' || !values.has(value as T)) {
    throw new Error(`Select a supported ${name.toLowerCase()}.`);
  }
  return value as T;
}
