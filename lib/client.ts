'use client';
// Helper sisi browser: panggil API, notifikasi (toast), efek suara 8-bit, jam Jepang.

export async function api(path: string, opts: { method?: string; body?: any } = {}) {
  const { method = 'GET', body } = opts;
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Kantor': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Sesi habis');
  }
  let data: any = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// ---------- toast ----------
export type ToastKind = '' | 'ok' | 'bad' | 'xp';
export function toast(msg: string, kind: ToastKind = '') {
  window.dispatchEvent(new CustomEvent('kb-toast', { detail: { msg, kind, id: Math.random() } }));
  if (kind === 'ok' || kind === 'xp') sfx('success');
  else if (kind === 'bad') sfx('error');
}

// ---------- efek suara (WebAudio, tanpa file) ----------
let ctx: AudioContext | null = null;
export function soundOn() {
  try { return localStorage.getItem('kb_sound') !== '0'; } catch { return true; }
}
export function setSound(on: boolean) {
  try { localStorage.setItem('kb_sound', on ? '1' : '0'); } catch {}
}
function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.05) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime + start);
  g.gain.setValueAtTime(vol, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.02);
}
export function sfx(kind: 'click' | 'open' | 'success' | 'error' | 'coin' | 'tab') {
  if (typeof window === 'undefined' || !soundOn()) return;
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    if (kind === 'click') tone(660, 0, 0.05);
    if (kind === 'tab') { tone(520, 0, 0.04); tone(780, 0.04, 0.05); }
    if (kind === 'open') { tone(392, 0, 0.06); tone(587, 0.06, 0.08); }
    if (kind === 'coin') { tone(988, 0, 0.06); tone(1319, 0.06, 0.18); }
    if (kind === 'success') [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.12));
    if (kind === 'error') { tone(220, 0, 0.12, 'sawtooth', 0.04); tone(165, 0.12, 0.2, 'sawtooth', 0.04); }
  } catch {}
}

// ---------- waktu Jepang & jadwal (logika bersama di lib/kuliah.js) ----------
export { HARI, fmtDur, toMin } from './kuliah.js';
import { HARI as _H, toMin, occKey, addDays, jstDate, dayOf } from './kuliah.js';
export const pad = (n: number) => String(n).padStart(2, '0');
export function jstNow() {
  const d = new Date(Date.now() + 9 * 3600_000);
  return { day: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes(), sec: d.getUTCSeconds(), date: d };
}
export function timeAgo(t?: number) {
  if (!t) return '-';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'baru saja';
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
}
export type Kelas = { id?: string; name: string; day: number; start: string; end: string; code?: string; kelas?: string; link?: string; note?: string };
export const durOf = (c: Kelas) => {
  const t = (x: string) => { const [h, m] = x.split(':').map(Number); return h * 60 + m; };
  return ((t(c.end) - t(c.start) + 1440) % 1440) || 1440;
};
void _H;

// ---------- notifikasi push ----------
function keyToBytes(b64: string) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export async function currentPushSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
export async function enablePush() {
  if (!pushSupported()) throw new Error('Browser ini belum mendukung notifikasi push. Di iPhone: tambahkan ke Layar Utama dulu.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Izin notifikasi ditolak. Aktifkan di pengaturan situs browser.');
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const { publicKey } = await api('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  const ua = navigator.userAgent;
  const label = /Android/i.test(ua) ? 'HP Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'PC Windows' : /Mac/i.test(ua) ? 'Mac' : 'Perangkat';
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), label } });
  return sub;
}
export async function disablePush() {
  const sub = await currentPushSub();
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

/** Buat file .ics: acara mingguan + kuliah tambahan, tanggal libur dikecualikan, alarm 15 menit. */
export function downloadIcs(data: any, until: string) {
  const list: Kelas[] = data.schedule || [];
  const sem = data.semester || {};
  const occ = data.occ || {};
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ymd = (d: string) => d.replace(/-/g, '');
  const hm = (t: string) => t.replace(':', '') + '00';
  const endOf = (date: string, start: string, end: string) => {
    const mins = toMin(start) + (((toMin(end) - toMin(start) + 1440) % 1440) || 1440);
    return `${ymd(addDays(date, Math.floor(mins / 1440)))}T${pad(Math.floor((mins % 1440) / 60))}${pad(mins % 60)}00`;
  };
  const untilDate = until || sem.end || '';
  const e = (s: string) => String(s).replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kantor Bos//Jadwal Kuliah//ID', 'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:JST', 'END:STANDARD', 'END:VTIMEZONE'];
  const alarm = (name: string) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(name)} 15 menit lagi`, 'TRIGGER:-PT15M', 'END:VALARM'];
  const from = sem.start && sem.start > jstDate() ? sem.start : jstDate();
  for (const c of list) {
    const first = addDays(from, (c.day - dayOf(from) + 7) % 7);
    const libur = Object.entries(occ).filter(([k, v]: any) => k.endsWith(`|${c.id}`) && v.status === 'libur').map(([k]) => k.split('|')[0]);
    L.push('BEGIN:VEVENT', `UID:${c.id}-w@kantor-bos`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Tokyo:${ymd(first)}T${hm(c.start)}`, `DTEND;TZID=Asia/Tokyo:${endOf(first, c.start, c.end)}`,
      `RRULE:FREQ=WEEKLY${untilDate ? `;UNTIL=${ymd(untilDate)}T145959Z` : ''}`,
      ...libur.map((d) => `EXDATE;TZID=Asia/Tokyo:${ymd(d)}T${hm(c.start)}`),
      `SUMMARY:${e(c.name)}`,
      `DESCRIPTION:${e([c.kelas && 'Kelas ' + c.kelas, c.code && 'Kode ' + c.code, c.link, c.note].filter(Boolean).join(' · '))}`,
      ...(c.link ? [`URL:${c.link}`] : []), ...alarm(c.name), 'END:VEVENT');
  }
  for (const x of data.extras || []) {
    if (x.date < jstDate() || occ[occKey(x.date, x.id)]?.status === 'libur') continue;
    L.push('BEGIN:VEVENT', `UID:${x.id}@kantor-bos`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Tokyo:${ymd(x.date)}T${hm(x.start)}`, `DTEND;TZID=Asia/Tokyo:${endOf(x.date, x.start, x.end)}`,
      `SUMMARY:${e(x.name + ' (tambahan)')}`, ...(x.link ? [`URL:${x.link}`] : []), ...alarm(x.name), 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([L.join('\r\n')], { type: 'text/calendar' }));
  a.download = 'jadwal-kuliah.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
