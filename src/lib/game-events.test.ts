import { describe, expect, it } from 'vitest';
import { parseGameEventPayload } from './game-events';

describe('game event payloads', () => {
  it('accepts stalls for tracked-team and opponent turnovers', () => {
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
  });
});
