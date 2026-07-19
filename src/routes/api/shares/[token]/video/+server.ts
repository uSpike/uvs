import { error } from '@sveltejs/kit';
import { CatalogRepository } from '$lib/server/catalog';
import { ShareLinkRepository } from '$lib/server/share-links';
import { videoSourceResponse } from '$lib/server/video-source';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
  return sharedVideoResponse(params.token, request);
};

export const HEAD: RequestHandler = async ({ params, request }) => {
  return sharedVideoResponse(params.token, request, true);
};

async function sharedVideoResponse(shareToken: string, request: Request, headOnly = false): Promise<Response> {
  const gameToken = new ShareLinkRepository().resolveGameToken(shareToken);
  if (!gameToken) error(404, 'Share link not found or no longer active.');
  const source = new CatalogRepository().getVideoSourceByToken(gameToken);
  if (!source) error(404, 'Game not found.');
  const response = await videoSourceResponse(source, request, headOnly);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
