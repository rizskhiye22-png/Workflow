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

// ---------- waktu Jepang ----------
export const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
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

// ---------- jadwal ----------
export type Kelas = { id?: string; name: string; day: number; start: string; end: string; code?: string; kelas?: string; link?: string; note?: string };
export const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const durOf = (c: Kelas) => ((toMin(c.end) - toMin(c.start) + 1440) % 1440) || 1440;

export function timeline(list: Kelas[]) {
  const n = jstNow();
  const nowW = n.day * 1440 + n.min + n.sec / 60;
  return list.map((c) => {
    const startW = c.day * 1440 + toMin(c.start);
    const since = (nowW - startW + 10080) % 10080;
    return { ...c, ongoing: since < durOf(c), until: (startW - nowW + 10080) % 10080, left: durOf(c) - since };
  });
}

export function fmtDur(min: number) {
  min = Math.max(0, Math.round(min));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return [d && `${d} hari`, h && `${h} jam`, `${m} menit`].filter(Boolean).join(' ');
}

/** Buat file .ics: acara mingguan + alarm 15 menit sebelum mulai. */
export function downloadIcs(list: Kelas[], until: string) {
  const n = jstNow();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const fmt = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
  const untilRule = until ? `;UNTIL=${until.replace(/-/g, '')}T145959Z` : '';
  const e = (s: string) => String(s).replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kantor Bos//Jadwal Kuliah//ID', 'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:JST', 'END:STANDARD', 'END:VTIMEZONE'];
  for (const c of list) {
    const base = Date.UTC(n.date.getUTCFullYear(), n.date.getUTCMonth(), n.date.getUTCDate());
    const start = new Date(base + ((c.day - n.day + 7) % 7) * 86400_000 + toMin(c.start) * 60_000);
    const end = new Date(start.getTime() + durOf(c) * 60_000);
    L.push('BEGIN:VEVENT', `UID:${c.id}-${c.day}${c.start.replace(':', '')}@kantor-bos`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Tokyo:${fmt(start)}`, `DTEND;TZID=Asia/Tokyo:${fmt(end)}`, `RRULE:FREQ=WEEKLY${untilRule}`,
      `SUMMARY:${e(c.name)}`,
      `DESCRIPTION:${e([c.kelas && 'Kelas ' + c.kelas, c.code && 'Kode ' + c.code, c.link, c.note].filter(Boolean).join(' · '))}`,
      ...(c.link ? [`URL:${c.link}`] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(c.name)} 15 menit lagi`, 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([L.join('\r\n')], { type: 'text/calendar' }));
  a.download = 'jadwal-kuliah.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
