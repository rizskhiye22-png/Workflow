import { HttpError } from './util.js';

const BASE = 'https://api.cloudflare.com/client/v4';

function cfRaw(env, path, init = {}) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    throw new HttpError(400, 'CF_API_TOKEN / CF_ACCOUNT_ID belum diatur');
  }
  return fetch(`${BASE}/accounts/${env.CF_ACCOUNT_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, ...(init.headers || {}) },
  });
}

async function cfJson(env, path, init = {}) {
  const res = await cfRaw(env, path, {
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
  });
  let data;
  try { data = await res.json(); } catch { throw new HttpError(502, `Cloudflare HTTP ${res.status}`); }
  if (!res.ok || data.success === false) {
    const msg = (data.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new HttpError(502, `Cloudflare: ${msg}`);
  }
  return data;
}

const nsPath = (id) => `/storage/kv/namespaces/${id}`;

// ---------- KV ----------
export async function kvNamespaces(env) {
  const d = await cfJson(env, '/storage/kv/namespaces?per_page=100');
  return d.result.map((n) => ({ id: n.id, title: n.title }));
}

export async function kvCreateNamespace(env, title) {
  title = String(title || '').trim();
  if (!title || title.length > 60) throw new HttpError(400, 'Nama namespace 1–60 karakter');
  const d = await cfJson(env, '/storage/kv/namespaces', { method: 'POST', body: JSON.stringify({ title }) });
  return { id: d.result.id, title: d.result.title };
}

export async function kvKeys(env, ns, { prefix = '', cursor = '' } = {}) {
  const q = new URLSearchParams({ limit: '100' });
  if (prefix) q.set('prefix', prefix);
  if (cursor) q.set('cursor', cursor);
  const d = await cfJson(env, `${nsPath(ns)}/keys?${q}`);
  return {
    keys: d.result.map((k) => ({ name: k.name, expiration: k.expiration || null })),
    cursor: d.result_info?.cursor || null,
  };
}

export async function kvGet(env, ns, key) {
  const res = await cfRaw(env, `${nsPath(ns)}/values/${encodeURIComponent(key)}`);
  if (res.status === 404) throw new HttpError(404, 'Key tidak ditemukan');
  if (!res.ok) throw new HttpError(502, `Cloudflare HTTP ${res.status}`);
  return res.text();
}

export async function kvPut(env, ns, key, value) {
  if (!key || key.length > 512) throw new HttpError(400, 'Nama key 1–512 karakter');
  const res = await cfRaw(env, `${nsPath(ns)}/values/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: String(value ?? ''),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.success === false) {
    throw new HttpError(502, `Cloudflare: ${(d.errors || []).map((e) => e.message).join('; ') || res.status}`);
  }
}

export async function kvDelete(env, ns, key) {
  await cfJson(env, `${nsPath(ns)}/values/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

// ---------- D1 ----------
export async function d1Databases(env) {
  const d = await cfJson(env, '/d1/database?per_page=100');
  return d.result.map((x) => ({ id: x.uuid, name: x.name }));
}

export async function d1Create(env, name) {
  name = String(name || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,59}$/i.test(name)) throw new HttpError(400, 'Nama database: huruf, angka, - atau _');
  const d = await cfJson(env, '/d1/database', { method: 'POST', body: JSON.stringify({ name }) });
  return { id: d.result.uuid, name: d.result.name };
}

export async function d1Query(env, id, sql) {
  sql = String(sql || '').trim();
  if (!sql) throw new HttpError(400, 'SQL kosong');
  if (sql.length > 100_000) throw new HttpError(400, 'SQL terlalu panjang');
  const d = await cfJson(env, `/d1/database/${id}/query`, { method: 'POST', body: JSON.stringify({ sql }) });
  return d.result;
}

// ---------- Pages ----------
function mapStage(s) {
  if (!s) return 'unknown';
  if (s.status === 'failure' || s.status === 'canceled') return 'failed';
  if (s.name === 'deploy' && s.status === 'success') return 'success';
  return 'building';
}

export async function pagesDeployments(env, project) {
  const d = await cfJson(env, `/pages/projects/${encodeURIComponent(project)}/deployments`);
  return (d.result || []).slice(0, 8).map((x) => ({
    id: x.id,
    created_on: x.created_on,
    url: x.url,
    environment: x.environment,
    message: x.deployment_trigger?.metadata?.commit_message || '',
    stage: x.latest_stage?.name || '',
    status: mapStage(x.latest_stage),
  }));
}
