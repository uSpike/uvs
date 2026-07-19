import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

interface ByteRange {
  start: number;
  end: number;
}

/** Validate and normalize a server-local or remote video source URL. */
export async function validateVideoSource(value: string): Promise<string> {
  const normalized = value.trim();
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('Video URL must be an absolute file://, http://, or https:// URL.');
  }

  if (url.protocol === 'file:') {
    const filename = fileURLToPath(url);
    const fileStat = await stat(filename).catch(() => null);
    if (!fileStat?.isFile()) {
      throw new Error('The server-local video file does not exist or is not a regular file.');
    }
    return url.href;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Video URL must use file://, http://, or https://.');
  }
  if (url.username || url.password) {
    throw new Error('Video URLs containing embedded credentials are not supported.');
  }
  url.hash = '';
  return url.href;
}

/** Stream a validated source with browser-compatible byte range handling. */
export async function videoSourceResponse(
  source: string,
  request: Request,
  headOnly = false,
): Promise<Response> {
  const url = new URL(source);
  if (url.protocol === 'file:') {
    return localVideoResponse(url, request, headOnly);
  }
  return remoteVideoResponse(url, request, headOnly);
}

async function localVideoResponse(
  url: URL,
  request: Request,
  headOnly: boolean,
): Promise<Response> {
  const filename = fileURLToPath(url);
  const fileStat = await stat(filename).catch(() => null);
  if (!fileStat?.isFile()) {
    return new Response('Video not found.', { status: 404 });
  }

  const rangeHeader = request.headers.get('range');
  const range = parseRange(rangeHeader, fileStat.size);
  if (rangeHeader && !range) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${fileStat.size}` },
    });
  }

  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Content-Type': videoContentType(url.pathname),
  });
  if (!range) {
    headers.set('Content-Length', String(fileStat.size));
    return new Response(
      headOnly ? null : nodeStreamBody(createReadStream(filename)),
      { status: 200, headers },
    );
  }

  const contentLength = range.end - range.start + 1;
  headers.set('Content-Length', String(contentLength));
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${fileStat.size}`);
  return new Response(
    headOnly
      ? null
      : nodeStreamBody(createReadStream(filename, { start: range.start, end: range.end })),
    { status: 206, headers },
  );
}

async function remoteVideoResponse(
  url: URL,
  request: Request,
  headOnly: boolean,
): Promise<Response> {
  const headers = new Headers();
  const range = request.headers.get('range');
  if (range) {
    headers.set('Range', range);
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: headOnly ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow',
      signal: request.signal,
    });
  } catch {
    return new Response('Remote video is unavailable.', { status: 502 });
  }

  const responseHeaders = new Headers({
    'Cache-Control': 'private, max-age=300',
    'Content-Type': upstream.headers.get('content-type') ?? videoContentType(url.pathname),
  });
  for (const name of ['accept-ranges', 'content-length', 'content-range', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) {
      responseHeaders.set(name, value);
    }
  }
  return new Response(headOnly ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

function parseRange(header: string | null, size: number): ByteRange | null {
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) {
    return null;
  }

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function nodeStreamBody(stream: Readable): ReadableStream<Uint8Array> {
  let settled = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const cleanup = () => {
    stream.off('data', handleData);
    stream.off('end', handleEnd);
    stream.off('error', handleError);
    stream.off('close', handleClose);
  };
  const handleData = (chunk: Buffer) => {
    if (settled || !controller) {
      return;
    }
    controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    if ((controller.desiredSize ?? 1) <= 0) {
      stream.pause();
    }
  };
  const handleEnd = () => {
    if (settled || !controller) {
      return;
    }
    settled = true;
    cleanup();
    controller.close();
  };
  const handleError = (error: Error) => {
    if (settled || !controller) {
      return;
    }
    settled = true;
    cleanup();
    controller.error(error);
  };
  const handleClose = () => {
    if (!settled && !stream.readableEnded) {
      handleError(new Error('Video stream closed before reaching the requested byte range.'));
    }
  };

  return new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
      stream.on('data', handleData);
      stream.once('end', handleEnd);
      stream.once('error', handleError);
      stream.once('close', handleClose);
      stream.pause();
    },
    pull() {
      if (!settled) {
        stream.resume();
      }
    },
    cancel() {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      stream.destroy();
    },
  });
}

function videoContentType(pathname: string): string {
  switch (extname(pathname).toLowerCase()) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.mkv':
      return 'video/x-matroska';
    default:
      return 'application/octet-stream';
  }
}
