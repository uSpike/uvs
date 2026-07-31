import { error } from '@sveltejs/kit';
import { CatalogRepository } from '$lib/server/catalog';
import { metadataSourceResponse } from '$lib/server/metadata-source';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, request }) => {
  if (locals.role !== 'admin') {
    error(403, 'Administrator access required.');
  }

  const metadata = new CatalogRepository().getMetadataLocationByToken(params.token);
  if (metadata === null) {
    error(404, 'Game not found.');
  }
  const response = metadata.kind === 'external'
    ? await metadataSourceResponse(metadata.source, request)
    : new Response(metadata.jsonl, {
      headers: {
        'Content-Length': String(Buffer.byteLength(metadata.jsonl)),
        'Content-Type': 'application/x-ndjson; charset=utf-8',
      },
    });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set(
    'Content-Disposition',
    `attachment; filename="${params.token}.metadata.jsonl"`,
  );
  return response;
};
