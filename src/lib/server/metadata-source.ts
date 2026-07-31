import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseMetadataJsonl, type MetadataTimeline } from '$lib/metadata';

const MAX_MANIFEST_SEARCH_BYTES = 1024 * 1024;

export interface ValidatedMetadataSource {
  source: string;
  metadata: MetadataTimeline;
}

/** Validate a metadata URL and read only the bounded JSONL prefix needed for its manifest. */
export async function validateMetadataSource(value: string): Promise<ValidatedMetadataSource> {
  const source = await normalizeMetadataSource(value);
  const metadata = await loadMetadataManifest(source);
  return { source, metadata };
}

/** Stream external metadata without loading its large response body into application memory. */
export async function metadataSourceResponse(source: string, request: Request): Promise<Response> {
  const url = new URL(source);
  if (url.protocol === 'file:') {
    const filename = fileURLToPath(url);
    const fileStat = await stat(filename).catch(() => null);
    if (!fileStat?.isFile()) return new Response('Metadata not found.', { status: 404 });
    const body = Readable.toWeb(createReadStream(filename)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: metadataResponseHeaders({ contentLength: fileStat.size }),
    });
  }

  const upstream = await fetch(url, { signal: request.signal }).catch(() => null);
  if (!upstream) return new Response('Metadata source could not be reached.', { status: 502 });
  if (!upstream.ok || !upstream.body) {
    upstream.body?.cancel().catch(() => undefined);
    return new Response('Metadata source could not be loaded.', {
      status: upstream.status === 404 ? 404 : 502,
    });
  }
  return new Response(upstream.body, {
    headers: metadataResponseHeaders({
      etag: upstream.headers.get('etag'),
      lastModified: upstream.headers.get('last-modified'),
    }),
  });
}

async function normalizeMetadataSource(value: string): Promise<string> {
  const normalized = value.trim();
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('Metadata URL must be an absolute file://, http://, or https:// URL.');
  }
  if (url.protocol === 'file:') {
    const fileStat = await stat(fileURLToPath(url)).catch(() => null);
    if (!fileStat?.isFile()) {
      throw new Error('The server-local metadata file does not exist or is not a regular file.');
    }
    return url.href;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Metadata URL must use file://, http://, or https://.');
  }
  if (url.username || url.password) {
    throw new Error('Metadata URLs containing embedded credentials are not supported.');
  }
  url.hash = '';
  return url.href;
}

async function loadMetadataManifest(source: string): Promise<MetadataTimeline> {
  const url = new URL(source);
  if (url.protocol === 'file:') {
    const handle = await open(fileURLToPath(url), 'r');
    try {
      const buffer = Buffer.alloc(MAX_MANIFEST_SEARCH_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return manifestFromPrefix(buffer.toString('utf8', 0, bytesRead), true);
    } finally {
      await handle.close();
    }
  }

  const response = await fetch(url, {
    headers: { Range: `bytes=0-${MAX_MANIFEST_SEARCH_BYTES - 1}` },
  }).catch(() => null);
  if (!response?.ok || !response.body) {
    response?.body?.cancel().catch(() => undefined);
    throw new Error('Metadata URL could not be loaded.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytesRead = 0;
  try {
    while (bytesRead < MAX_MANIFEST_SEARCH_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        return manifestFromPrefix(text, true);
      }
      const remaining = MAX_MANIFEST_SEARCH_BYTES - bytesRead;
      const chunk = value.byteLength <= remaining ? value : value.subarray(0, remaining);
      bytesRead += chunk.byteLength;
      text += decoder.decode(chunk, { stream: bytesRead < MAX_MANIFEST_SEARCH_BYTES });
      const metadata = tryManifestFromPrefix(text, false);
      if (metadata) return metadata;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return manifestFromPrefix(text, true);
}

function manifestFromPrefix(text: string, includeTrailingLine: boolean): MetadataTimeline {
  const metadata = tryManifestFromPrefix(text, includeTrailingLine);
  if (!metadata) {
    throw new Error('Metadata manifest was not found within the first 1 MiB.');
  }
  return metadata;
}

function tryManifestFromPrefix(
  text: string,
  includeTrailingLine: boolean,
): MetadataTimeline | null {
  const lines = text.split(/\r?\n/u);
  if (!includeTrailingLine) lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      throw new Error('Metadata URL does not contain valid JSONL.');
    }
    if (
      typeof record === 'object' &&
      record !== null &&
      !Array.isArray(record) &&
      (record as { kind?: unknown }).kind === 'manifest'
    ) {
      return parseMetadataJsonl(trimmed);
    }
  }
  return null;
}

function metadataResponseHeaders(values: {
  contentLength?: number | null;
  etag?: string | null;
  lastModified?: string | null;
}): Headers {
  const headers = new Headers({
    'Cache-Control': 'private, max-age=300',
    'Content-Type': 'application/x-ndjson; charset=utf-8',
  });
  if (values.contentLength !== undefined && values.contentLength !== null) {
    headers.set('Content-Length', String(values.contentLength));
  }
  if (values.etag) headers.set('ETag', values.etag);
  if (values.lastModified) headers.set('Last-Modified', values.lastModified);
  return headers;
}
