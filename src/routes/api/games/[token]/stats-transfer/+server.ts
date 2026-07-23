import { json } from '@sveltejs/kit';
import {
  createGameStatisticsExport,
  MAX_GAME_STATISTICS_EXPORT_BYTES,
  parseGameStatisticsExport,
} from '$lib/game-stat-transfer';
import { requireGameAccess } from '$lib/server/access';
import { requireEditorLock } from '$lib/server/editor-lock';
import { GameTrackingRepository } from '$lib/server/game-tracking';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals }) => {
  requireGameAccess(locals, params.token);
  const snapshot = new GameTrackingRepository().getSnapshot(params.token);
  if (!snapshot) return json({ error: 'Game not found.' }, { status: 404 });
  const exported = createGameStatisticsExport(snapshot.data);
  const body = `${JSON.stringify(exported, null, 2)}\n`;
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFilename(snapshot.data.game.title)}"`,
      'cache-control': 'private, no-store',
    },
  });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
  requireGameAccess(locals, params.token);
  try {
    requireEditorLock(params.token, request.headers.get('x-uvs-edit-token'));
    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_GAME_STATISTICS_EXPORT_BYTES) {
      throw new Error('Statistics file is larger than 25 MB.');
    }
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_GAME_STATISTICS_EXPORT_BYTES) {
      throw new Error('Statistics file is larger than 25 MB.');
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(body) as unknown;
    } catch {
      throw new Error('Statistics file is not valid JSON.');
    }
    const exported = parseGameStatisticsExport(decoded);
    return json(new GameTrackingRepository().importStatistics(params.token, exported));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Statistics could not be imported.';
    const status = message.includes('lock') ? 409 : message.endsWith('not found.') ? 404 : 400;
    return json({ error: message }, { status });
  }
};

function exportFilename(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'game';
  return `${base}-uvs-stats.json`;
}
