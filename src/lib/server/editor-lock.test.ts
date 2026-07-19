import { describe, expect, it, vi } from 'vitest';
import {
  acquireEditorLock,
  observeEditorLock,
  releaseEditorLock,
  requireEditorLock,
} from './editor-lock';

describe('editor lock', () => {
  it('keeps one live editor and immediately revokes it on takeover', () => {
    const game = `game-${crypto.randomUUID()}`;
    const first = acquireEditorLock(game, `owner-${crypto.randomUUID()}`, false);
    expect(first.acquired).toBe(true);
    const revoked = vi.fn();
    const disconnect = observeEditorLock(game, first.token!, revoked);

    expect(acquireEditorLock(game, `owner-${crypto.randomUUID()}`, false)).toEqual({
      acquired: false,
      token: null,
    });
    const second = acquireEditorLock(game, `owner-${crypto.randomUUID()}`, true);
    expect(second.acquired).toBe(true);
    expect(revoked).toHaveBeenCalledOnce();
    expect(() => requireEditorLock(game, first.token)).toThrow('no longer active');
    expect(() => requireEditorLock(game, second.token)).not.toThrow();

    disconnect();
    expect(releaseEditorLock(game, second.token)).toBe(true);
  });

  it('releases a lock when its live connection closes', () => {
    const game = `game-${crypto.randomUUID()}`;
    const first = acquireEditorLock(game, `owner-${crypto.randomUUID()}`, false);
    const disconnect = observeEditorLock(game, first.token!, () => {});
    disconnect();

    const second = acquireEditorLock(game, `owner-${crypto.randomUUID()}`, false);
    expect(second.acquired).toBe(true);
    releaseEditorLock(game, second.token);
  });
});
