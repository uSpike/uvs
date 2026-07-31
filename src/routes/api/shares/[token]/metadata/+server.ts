import { error } from '@sveltejs/kit';
import { CatalogRepository } from '$lib/server/catalog';
import { metadataSourceResponse } from '$lib/server/metadata-source';
import { ShareLinkRepository } from '$lib/server/share-links';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
  const gameToken = new ShareLinkRepository().resolveGameToken(params.token);
  if (!gameToken) error(404, 'Share link not found or no longer active.');
  const metadata = new CatalogRepository().getMetadataLocationByToken(gameToken);
  if (!metadata) error(404, 'Game not found.');
  if (metadata.kind === 'external') {
    return metadataSourceResponse(metadata.source, request);
  }
  return new Response(metadata.jsonl, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
};
