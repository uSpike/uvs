import { error } from '@sveltejs/kit';
import { CatalogRepository } from '$lib/server/catalog';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals }) => {
  if (locals.role !== 'admin') {
    error(403, 'Administrator access required.');
  }

  const metadataJsonl = new CatalogRepository().getMetadataJsonlByToken(params.token);
  if (metadataJsonl === null) {
    error(404, 'Game not found.');
  }

  return new Response(metadataJsonl, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${params.token}.metadata.jsonl"`,
      'Content-Length': String(Buffer.byteLength(metadataJsonl)),
      'Content-Type': 'application/x-ndjson; charset=utf-8',
    },
  });
};
