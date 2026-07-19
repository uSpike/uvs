import { error } from '@sveltejs/kit';
import { CatalogRepository } from '$lib/server/catalog';
import { requireGameAccess } from '$lib/server/access';
import { videoSourceResponse } from '$lib/server/video-source';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request, locals }) => {
  requireGameAccess(locals, params.token);
  const source = sourceForToken(params.token);
  return videoSourceResponse(source, request);
};

export const HEAD: RequestHandler = async ({ params, request, locals }) => {
  requireGameAccess(locals, params.token);
  const source = sourceForToken(params.token);
  return videoSourceResponse(source, request, true);
};

function sourceForToken(token: string): string {
  const source = new CatalogRepository().getVideoSourceByToken(token);
  if (!source) {
    error(404, 'Game not found.');
  }
  return source;
}
