import { error } from '@sveltejs/kit';
import { CatalogRepository } from '$lib/server/catalog';
import { ShareLinkRepository } from '$lib/server/share-links';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
  const gameToken = new ShareLinkRepository().resolveGameToken(params.token);
  if (!gameToken) error(404, 'Share link not found or no longer active.');
  const metadataJson = new CatalogRepository().getMetadataJsonByToken(gameToken);
  if (!metadataJson) error(404, 'Game not found.');
  return new Response(metadataJson, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
};
