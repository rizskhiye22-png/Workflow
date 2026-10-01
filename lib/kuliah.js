// Logika jadwal kuliah yang dipakai bersama oleh server (cron/laporan) dan browser.
// Semua tanggal & jam dalam waktu Jepang (JST, UTC+9). Tanggal ditulis 'YYYY-MM-DD'.

export const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const JST = 9 * 3600_000;
const DAY = 86400_000;
const pad = (n) => String(n).padStart(2, '0');

export const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
export const durMin = (start, end) => ((toMin(end) - toMin(start) + 1440) % 1440) || 1440;

/** 'YYYY-MM-DD' (JST) dari timestamp. */
export function jstDate(ts = Date.now()) {
  const d = new Date(ts + JST);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function jstMinutes(ts = Date.now()) {
  const d = new Date(ts + JST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function dayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** Timestamp (ms) untuk tanggal + jam JST. */
export function tsOf(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) + toMin(hhmm) * 60_000 - JST;
}
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY);
}
export const occKey = (date, id) => `${date}|${id}`;

export function inSemester(date, sem) {
  if (!sem) return true;
  if (sem.start && date < sem.start) return false;
  if (sem.end && date > sem.end) return false;
  return true;
}

/**
 * Semua kemunculan kuliah pada satu tanggal: jadwal mingguan + kuliah tambahan,
 * lengkap dengan status ('normal' | 'done' | 'libur') dari catatan per tanggal.
 */
export function occurrencesOn(date, data) {
  const { schedule = [], occ = {}, extras = [], semester } = data;
  const dow = dayOf(date);
  const list = [];
  if (inSemester(date, semester)) {
    for (const c of schedule) {
      if (c.day !== dow) continue;
      const o = occ[occKey(date, c.id)] || {};
      list.push({
        key: occKey(date, c.id), classId: c.id, date, name: c.name, start: c.start, end: c.end,
        kelas: c.kelas, code: c.code, link: c.link, status: o.status || 'normal', note: o.note || '', extra: false,
      });
    }
  }
  for (const x of extras) {
    if (x.date !== date) continue;
    const o = occ[occKey(date, x.id)] || {};
    list.push({
      key: occKey(date, x.id), classId: x.classId || x.id, extraId: x.id, date, name: x.name, start: x.start, end: x.end,
      link: x.link, status: o.status || 'normal', note: x.note || o.note || '', extra: true,
    });
  }
  return list
    .map((o) => ({ ...o, startTs: tsOf(date, o.start), endTs: tsOf(date, o.start) + durMin(o.start, o.end) * 60_000 }))
    .sort((a, b) => a.startTs - b.startTs);
}

/** Kemunculan dalam rentang tanggal [from, from+days). */
export function occurrencesRange(from, days, data) {
  const out = [];
  for (let i = 0; i < days; i++) out.push(...occurrencesOn(addDays(from, i), data));
  return out;
}

/** Kuliah yang sedang berlangsung dan berikutnya (yang libur dilewati). */
export function nowAndNext(data, now = Date.now()) {
  const list = occurrencesRange(addDays(jstDate(now), -1), 15, data).filter((o) => o.status !== 'libur');
  const current = list.find((o) => o.startTs <= now && now < o.endTs) || null;
  const next = list.find((o) => o.startTs > now) || null;
  return { current, next };
}

/** Pertemuan ke berapa (berdasarkan minggu sejak tanggal mulai semester). */
export function sessionInfo(cls, date, data) {
  const sem = data.semester;
  if (!sem?.start) return null;
  const startDow = dayOf(sem.start);
  const first = addDays(sem.start, (cls.day - startDow + 7) % 7);
  if (date < first) return null;
  const n = Math.floor(daysBetween(first, date) / 7) + 1;
  let total = null;
  if (sem.end) total = Math.floor(daysBetween(first, sem.end) / 7) + 1;
  return { n, total };
}

/** Progres satu mata kuliah: jumlah sesi selesai / libur / lewat. */
export function classProgress(cls, data, now = Date.now()) {
  const sem = data.semester;
  if (!sem?.start) return null;
  const today = jstDate(now);
  const startDow = dayOf(sem.start);
  let d = addDays(sem.start, (cls.day - startDow + 7) % 7);
  const end = sem.end || addDays(sem.start, 7 * 16);
  let total = 0, done = 0, libur = 0, past = 0;
  while (d <= end) {
    const o = data.occ?.[occKey(d, cls.id)];
    total++;
    if (o?.status === 'libur') libur++;
    else if (o?.status === 'done') done++;
    if (tsOf(d, cls.start) < now && d <= today) past++;
    d = addDays(d, 7);
  }
  return { total, done, libur, past, active: total - libur };
}

/** Sesi yang sudah lewat tapi belum dicentang selesai (untuk to-do). */
export function pendingSessions(data, days = 14, now = Date.now()) {
  const today = jstDate(now);
  return occurrencesRange(addDays(today, -days), days + 1, data)
    .filter((o) => o.endTs < now && o.status === 'normal')
    .reverse();
}

export function fmtDur(min) {
  min = Math.max(0, Math.round(min));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return [d && `${d} hari`, h && `${h} jam`, `${m} menit`].filter(Boolean).join(' ');
}

/** Tugas: status tenggat relatif sekarang. */
export function taskDueTs(t) {
  if (!t.due) return null;
  return tsOf(t.due, t.dueTime || '23:59');
}
