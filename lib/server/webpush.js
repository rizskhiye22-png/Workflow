// Web Push murni WebCrypto (tanpa library Node) — VAPID (RFC 8292) + enkripsi aes128gcm (RFC 8291).
// Kunci VAPID dibuat otomatis sekali lalu disimpan di KV, jadi tidak perlu secret tambahan.
import { HttpError } from './util.js';

const enc = new TextEncoder();

export function b64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// ---------- kunci VAPID ----------
export async function getVapid(env) {
  const saved = await env.DASH_KV.get('push:vapid', 'json');
  if (saved) return saved;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const v = { publicKey, privateJwk };
  await env.DASH_KV.put('push:vapid', JSON.stringify(v));
  return v;
}

async function vapidAuth(vapid, endpoint, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', { ...vapid.privateJwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`));
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${vapid.publicKey}`;
}

/** Enkripsi payload untuk satu langganan (RFC 8291, aes128gcm, satu record). */
export async function encryptPayload(sub, plaintext) {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new HttpError(400, 'Kunci langganan push tidak valid');

  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const prkKey = await hmac(authSecret, ecdh);
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = (await hmac(prkKey, concat(keyInfo, new Uint8Array([1])))).slice(0, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16);
  const nonce = (await hmac(prk, enc.encode('Content-Encoding: nonce\0\x01'))).slice(0, 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = concat(enc.encode(plaintext), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, body));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** Kirim satu notifikasi. Mengembalikan status HTTP dari layanan push. */
export async function sendPush(env, vapid, sub, message, subject) {
  const body = await encryptPayload(sub, JSON.stringify(message));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(vapid, sub.endpoint, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
    },
    body,
  });
  return res.status;
}

// ---------- daftar perangkat ----------
const SUBS = 'push:subs';
export async function listSubs(env) {
  return (await env.DASH_KV.get(SUBS, 'json')) || [];
}

export async function addSub(env, input, origin) {
  const s = input?.subscription;
  if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000) {
    throw new HttpError(400, 'Langganan push tidak valid');
  }
  if (!s.keys?.p256dh || !s.keys?.auth) throw new HttpError(400, 'Kunci langganan push tidak ada');
  const label = String(input.label || 'Perangkat').slice(0, 60);
  const list = (await listSubs(env)).filter((x) => x.endpoint !== s.endpoint);
  list.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, label, added: Date.now() });
  await env.DASH_KV.put(SUBS, JSON.stringify(list.slice(-10)));
  await env.DASH_KV.put('push:subject', origin);
  return { count: list.length };
}

export async function removeSub(env, endpoint) {
  const list = await listSubs(env);
  await env.DASH_KV.put(SUBS, JSON.stringify(list.filter((x) => x.endpoint !== endpoint)));
}

/** Kirim ke semua perangkat; langganan yang sudah mati (404/410) dibuang otomatis. */
export async function broadcast(env, message) {
  const subs = await listSubs(env);
  if (!subs.length) return { sent: 0, failed: 0, devices: 0 };
  const vapid = await getVapid(env);
  const subject = (await env.DASH_KV.get('push:subject')) || 'https://workers.dev';
  let sent = 0, failed = 0;
  const dead = [];
  await Promise.all(subs.map(async (s) => {
    try {
      const st = await sendPush(env, vapid, s, message, subject);
      if (st >= 200 && st < 300) sent++;
      else { failed++; if (st === 404 || st === 410) dead.push(s.endpoint); else console.warn('push status', st); }
    } catch (e) { failed++; console.warn('push error', e?.message); }
  }));
  if (dead.length) await env.DASH_KV.put(SUBS, JSON.stringify(subs.filter((s) => !dead.includes(s.endpoint))));
  return { sent, failed, devices: subs.length };
}
