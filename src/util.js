export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export const error = (status, message) => json({ error: message }, status);

export async function readJson(request, maxBytes = 60 * 1024 * 1024) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'Data terlalu besar');
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'JSON tidak valid');
  }
}

/** Jalankan fn untuk tiap item dengan batas paralel. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function shortText(t, n = 300) {
  t = String(t || '');
  return t.length > n ? t.slice(0, n) + '…' : t;
}
