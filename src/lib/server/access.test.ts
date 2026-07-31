import { describe, expect, it } from 'vitest';
import { requireTeamAccess } from './access';

const locals = (
  role: App.Locals['role'],
  teamId: number | null = null,
): App.Locals => ({
  role,
  teamId,
  teamSlug: role === 'player' ? 'union' : null,
});

describe('team access guard', () => {
  it('allows the owning player and a global administrator', () => {
    expect(() => requireTeamAccess(locals('player', 7), 7)).not.toThrow();
    expect(() => requireTeamAccess(locals('admin'), 7)).not.toThrow();
  });

  it('returns an authentication error for guests', () => {
    expectStatus(() => requireTeamAccess(locals('guest'), 7), 401);
  });

  it('returns a forbidden error for a different team player', () => {
    expectStatus(() => requireTeamAccess(locals('player', 8), 7), 403);
  });
});

function expectStatus(operation: () => void, status: number): void {
  try {
    operation();
  } catch (caught) {
    expect(caught).toMatchObject({ status });
    return;
  }
  throw new Error(`Expected operation to throw status ${status}.`);
}
