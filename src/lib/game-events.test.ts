import { describe, expect, it } from 'vitest';
import { parseGameEventPayload } from './game-events';

describe('game event payloads', () => {
  it('accepts stalls and miscellaneous penalties as turnover reasons', () => {
    expect(parseGameEventPayload('turnover', {
      throwerId: 12,
      intendedReceiverId: null,
      reason: 'stall',
    })).toEqual({
      throwerId: 12,
      intendedReceiverId: null,
      reason: 'stall',
    });
    expect(parseGameEventPayload('opponent_turnover', {
      reason: 'stall',
    })).toEqual({ reason: 'stall' });
    expect(parseGameEventPayload('turnover', {
      throwerId: 12,
      intendedReceiverId: null,
      reason: 'penalty',
    })).toEqual({
      throwerId: 12,
      intendedReceiverId: null,
      reason: 'penalty',
    });
  });
});
