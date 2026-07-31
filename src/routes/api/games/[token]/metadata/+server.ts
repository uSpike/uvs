import { error } from '@sveltejs/kit';
import { CatalogRepository } from '$lib/server/catalog';
import { requireGameAccess } from '$lib/server/access';
import { metadataSourceResponse } from '$lib/server/metadata-source';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, request }) => {
  requireGameAccess(locals, params.token);
  const metadata = new CatalogRepository().getMetadataLocationByToken(params.token);
  if (!metadata) {
    error(404, 'Game not found.');
  }
  if (metadata.kind === 'external') {
    return metadataSourceResponse(metadata.source, request);
  }
  return new Response(metadata.jsonl, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
    },
  });
};
