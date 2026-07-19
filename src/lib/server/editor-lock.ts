import { randomBytes } from 'node:crypto';

interface ActiveEditor {
  ownerId: string;
  token: string;
  revokedListeners: Set<() => void>;
}

/** Result returned when a browser requests exclusive game editing. */
export interface EditorLockResult {
  acquired: boolean;
  token: string | null;
}

const editors = new Map<string, ActiveEditor>();

/** Acquire a live, non-expiring game editor lock or explicitly take it over. */
export function acquireEditorLock(
  gameToken: string,
  ownerIdInput: string,
  takeover: boolean,
): EditorLockResult {
  const ownerId = validatedOwnerId(ownerIdInput);
  const existing = editors.get(gameToken);
  if (existing?.ownerId === ownerId) {
    return { acquired: true, token: existing.token };
  }
  if (existing && !takeover) return { acquired: false, token: null };
  if (existing) {
    for (const listener of existing.revokedListeners) listener();
  }
  const editor: ActiveEditor = {
    ownerId,
    token: randomBytes(24).toString('base64url'),
    revokedListeners: new Set(),
  };
  editors.set(gameToken, editor);
  return { acquired: true, token: editor.token };
}

/** Reject a mutation unless it carries the current game editor token. */
export function requireEditorLock(gameToken: string, token: string | null): void {
  const active = editors.get(gameToken);
  if (!token || !active || active.token !== token) {
    throw new Error('The statistics editing lock is no longer active.');
  }
}

/** Release a lock only when the supplied token still owns it. */
export function releaseEditorLock(gameToken: string, token: string | null): boolean {
  const active = editors.get(gameToken);
  if (!token || !active || active.token !== token) return false;
  editors.delete(gameToken);
  return true;
}

/** Attach a live browser connection and release its lock when the connection closes. */
export function observeEditorLock(
  gameToken: string,
  token: string,
  onRevoked: () => void,
): () => void {
  requireEditorLock(gameToken, token);
  const active = editors.get(gameToken)!;
  active.revokedListeners.add(onRevoked);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    active.revokedListeners.delete(onRevoked);
    releaseEditorLock(gameToken, token);
  };
}

function validatedOwnerId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9_-]{16,100}$/u.test(normalized)) {
    throw new Error('Editor session identifier is invalid.');
  }
  return normalized;
}
