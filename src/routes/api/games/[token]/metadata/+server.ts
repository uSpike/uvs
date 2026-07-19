import { error } from '@sveltejs/kit';
import { CatalogRepository } from '$lib/server/catalog';
import { requireGameAccess } from '$lib/server/access';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals }) => {
  requireGameAccess(locals, params.token);
  const metadataJson = new CatalogRepository().getMetadataJsonByToken(params.token);
  if (!metadataJson) {
    error(404, 'Game not found.');
  }
  return new Response(metadataJson, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
    },
  });
};
