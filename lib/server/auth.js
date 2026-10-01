import { json, error, readJson } from './util.js';

const enc = new TextEncoder();
const COOKIE = 'kb_session';
const SESSION_DAYS = 30;
const MAX_FAILS = 8;

function b64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export async function isAuthed(request, env) {
  if (!env.SESSION_SECRET) return false;
  const c = getCookie(request, COOKIE);
  if (!c) return false;
  const [exp, sig] = c.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(env.SESSION_SECRET, 'session:' + exp));
}

export async function login(request, env) {
  if (!env.DASHBOARD_PASSWORD || !env.SESSION_SECRET) {
    return error(500, 'Secret DASHBOARD_PASSWORD / SESSION_SECRET belum diatur di Cloudflare.');
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const failKey = `loginfail:${ip}`;
  const fails = Number((await env.DASH_KV.get(failKey)) || 0);
  if (fails >= MAX_FAILS) return error(429, 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.');

  const { password = '' } = await readJson(request, 10_000);
  const ok = safeEqual(
    await hmac(env.SESSION_SECRET, 'pw:' + String(password)),
    await hmac(env.SESSION_SECRET, 'pw:' + env.DASHBOARD_PASSWORD),
  );
  if (!ok) {
    await env.DASH_KV.put(failKey, String(fails + 1), { expirationTtl: 900 });
    return error(401, 'Password salah');
  }
  await env.DASH_KV.delete(failKey);

  const exp = String(Date.now() + SESSION_DAYS * 86400_000);
  const token = `${exp}.${await hmac(env.SESSION_SECRET, 'session:' + exp)}`;
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

export function logout() {
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
  });
}

/** Versi untuk Server Component: cek nilai cookie langsung. */
export async function isSessionValid(cookieValue, env) {
  if (!env.SESSION_SECRET || !cookieValue) return false;
  const [exp, sig] = cookieValue.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(env.SESSION_SECRET, 'session:' + exp));
}

export const SESSION_COOKIE = COOKIE;
