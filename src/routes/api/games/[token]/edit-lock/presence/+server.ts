import { observeEditorLock } from '$lib/server/editor-lock';
import { requireGameAccess } from '$lib/server/access';
import type { RequestHandler } from './$types';

const KEEPALIVE_MILLISECONDS = 15_000;

export const GET: RequestHandler = ({ request, params, url, locals }) => {
  requireGameAccess(locals, params.token);
  const token = url.searchParams.get('token');
  if (!token) return new Response('Editor token is required.', { status: 400 });

  const encoder = new TextEncoder();
  let cleanup = (): void => {};
  let closed = false;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = (): void => {
        if (closed) return;
        closed = true;
        if (keepalive) clearInterval(keepalive);
        cleanup();
        try {
          controller.close();
        } catch {
          // The client may already have canceled its reader.
        }
      };
      try {
        cleanup = observeEditorLock(params.token, token, () => {
          if (!closed) controller.enqueue(encoder.encode('event: revoked\ndata: {}\n\n'));
          close();
        });
      } catch (caught) {
        controller.error(caught);
        return;
      }
      controller.enqueue(encoder.encode(': connected\n\n'));
      keepalive = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, KEEPALIVE_MILLISECONDS);
      request.signal.addEventListener('abort', close, { once: true });
    },
    cancel() {
      if (keepalive) clearInterval(keepalive);
      cleanup();
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  });
};
