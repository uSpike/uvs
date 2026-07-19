import { json } from '@sveltejs/kit';
import {
  acquireEditorLock,
  releaseEditorLock,
} from '$lib/server/editor-lock';
import { requireGameAccess } from '$lib/server/access';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, params, locals }) => {
  requireGameAccess(locals, params.token);
  try {
    const body = await request.json() as { ownerId?: unknown; takeover?: unknown };
    const result = acquireEditorLock(
      params.token,
      typeof body.ownerId === 'string' ? body.ownerId : '',
      body.takeover === true,
    );
    return json(result, { status: result.acquired ? 200 : 409 });
  } catch (caught) {
    return json({ error: message(caught) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ request, params, locals }) => {
  requireGameAccess(locals, params.token);
  const body = await request.json().catch(() => ({})) as { token?: unknown };
  releaseEditorLock(params.token, typeof body.token === 'string' ? body.token : null);
  return new Response(null, { status: 204 });
};

function message(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'The editing lock could not be acquired.';
}
