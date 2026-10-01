import { HttpError } from './util.js';

// ---------- Proyek (karyawan di kantor) ----------
const PROJECTS = 'projects';

export async function listProjects(env) {
  return (await env.DASH_KV.get(PROJECTS, 'json')) || [];
}

export async function getProject(env, id) {
  const p = (await listProjects(env)).find((x) => x.id === id);
  if (!p) throw new HttpError(404, 'Proyek tidak ditemukan');
  return p;
}

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

function cleanProject(input) {
  const name = String(input.name || '').trim();
  if (!name || name.length > 40) throw new HttpError(400, 'Nama proyek wajib (maks 40 karakter)');
  const owner = String(input.owner || '').trim();
  const repo = String(input.repo || '').trim().replace(/\.git$/, '');
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) throw new HttpError(400, 'Repo GitHub tidak valid (format: pemilik/nama-repo)');
  const branch = String(input.branch || 'main').trim();
  if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(branch) || branch.includes('..')) throw new HttpError(400, 'Nama branch tidak valid');
  const pagesProject = String(input.pagesProject || '').trim();
  if (pagesProject && !/^[a-z0-9-]{1,58}$/.test(pagesProject)) throw new HttpError(400, 'Nama proyek Pages: huruf kecil, angka, tanda -');
  const workerName = String(input.workerName || '').trim();
  if (workerName && !/^[a-z0-9-]{1,63}$/.test(workerName)) throw new HttpError(400, 'Nama Worker: huruf kecil, angka, tanda -');
  if (workerName && pagesProject) throw new HttpError(400, 'Pilih salah satu: proyek Pages ATAU Worker');
  let siteUrl = String(input.siteUrl || '').trim();
  if (siteUrl && !/^https:\/\/[^\s"'<>]+$/.test(siteUrl)) throw new HttpError(400, 'URL situs harus diawali https://');
  if (!siteUrl && pagesProject) siteUrl = `https://${pagesProject}.pages.dev`;
  const worker = String(input.worker || '').trim().slice(0, 20) || name.slice(0, 20);
  return { name, worker, owner, repo, branch, pagesProject, workerName, siteUrl };
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'proyek';
}

export async function saveProject(env, input) {
  const list = await listProjects(env);
  const data = cleanProject(input);
  if (input.id) {
    const i = list.findIndex((x) => x.id === input.id);
    if (i < 0) throw new HttpError(404, 'Proyek tidak ditemukan');
    list[i] = { ...list[i], ...data };
    await env.DASH_KV.put(PROJECTS, JSON.stringify(list));
    return list[i];
  }
  if (list.length >= 30) throw new HttpError(400, 'Kantor penuh (maks 30 proyek)');
  let id = slug(data.name);
  for (let n = 2; list.some((x) => x.id === id); n++) id = `${slug(data.name)}-${n}`;
  const p = { id, ...data, created: Date.now() };
  list.push(p);
  await env.DASH_KV.put(PROJECTS, JSON.stringify(list));
  return p;
}

export async function deleteProject(env, id) {
  const list = await listProjects(env);
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) throw new HttpError(404, 'Proyek tidak ditemukan');
  await env.DASH_KV.put(PROJECTS, JSON.stringify(next));
  await env.DASH_KV.delete(`hist:${id}`);
}

// ---------- Riwayat push ----------
export async function getHistory(env, id) {
  return (await env.DASH_KV.get(`hist:${id}`, 'json')) || [];
}

export async function addHistory(env, id, entry) {
  const list = await getHistory(env, id);
  list.unshift(entry);
  await env.DASH_KV.put(`hist:${id}`, JSON.stringify(list.slice(0, 30)));
}

// ---------- Jadwal kuliah (jam Jepang / JST) ----------
const SCHEDULE = 'schedule';

// Hari: 0=Minggu, 1=Senin, ... 6=Sabtu. Jam dalam JST (WIB + 2 jam).
// Jika jam selesai < jam mulai, kelas berakhir lewat tengah malam.
const DEFAULT_SCHEDULE = [
  { name: 'Sejarah Jepang', code: '26330146', kelas: 'S1BY', day: 3, start: '23:00', end: '00:30' },
  { name: 'Pranata Masyarakat Indonesia', code: '26330143', kelas: 'S1BX', day: 4, start: '18:30', end: '20:20' },
  { name: 'Bahasa Jepang Bisnis', code: '20330209', kelas: 'S7AB', day: 4, start: '20:30', end: '22:20' },
  { name: 'Korespondensi Jepang', code: '20330210', kelas: 'S7AB', day: 4, start: '22:30', end: '00:20' },
  { name: 'Budaya Populer', code: '20350504', kelas: 'S3B', day: 5, start: '22:30', end: '00:20' },
  { name: 'Kewarganegaraan', code: '20510104', kelas: 'S5BX', day: 6, start: '10:00', end: '11:40' },
  { name: 'Pancasila', code: '26510102', kelas: 'S1BX', day: 6, start: '12:00', end: '13:50' },
  { name: 'Penerjemahan Jepang-Indonesia', code: '20330602', kelas: 'S5B', day: 6, start: '15:00', end: '16:50' },
  { name: 'Pengantar Linguistik Umum Bahasa Jepang', code: '26330231', kelas: 'S1B', day: 6, start: '16:50', end: '18:30' },
  { name: 'Komposisi Bahasa Indonesia', code: '20510107', kelas: 'S5BX', day: 6, start: '22:30', end: '00:20' },
].map((c, i) => ({ id: `c${i + 1}`, link: '', note: '', ...c }));

export async function getSchedule(env) {
  const s = await env.DASH_KV.get(SCHEDULE, 'json');
  return s || DEFAULT_SCHEDULE;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveSchedule(env, items) {
  if (!Array.isArray(items) || items.length > 40) throw new HttpError(400, 'Jadwal harus array (maks 40)');
  const clean = items.map((c, i) => {
    const name = String(c.name || '').trim().slice(0, 80);
    const day = Number(c.day);
    if (!name) throw new HttpError(400, `Nama mata kuliah baris ${i + 1} kosong`);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new HttpError(400, `Hari tidak valid: ${name}`);
    if (!TIME_RE.test(c.start) || !TIME_RE.test(c.end)) throw new HttpError(400, `Jam tidak valid: ${name} (format HH:MM)`);
    const link = String(c.link || '').trim();
    if (link && !/^https:\/\/[^\s"'<>]+$/.test(link)) throw new HttpError(400, `Link kelas harus https:// (${name})`);
    return {
      id: String(c.id || `c${Date.now()}${i}`).slice(0, 30),
      name, day, start: c.start, end: c.end, link,
      code: String(c.code || '').slice(0, 20),
      kelas: String(c.kelas || '').slice(0, 20),
      note: String(c.note || '').slice(0, 200),
    };
  });
  await env.DASH_KV.put(SCHEDULE, JSON.stringify(clean));
  return clean;
}

// ---------- Statistik game (XP dari jumlah push) ----------
export async function getStats(env) {
  const s = (await env.DASH_KV.get('stats', 'json')) || { pushes: 0 };
  const level = 1 + Math.floor(Math.sqrt(s.pushes / 3));
  const cur = 3 * (level - 1) ** 2, nxt = 3 * level ** 2;
  return { pushes: s.pushes, level, xp: s.pushes - cur, xpNeed: nxt - cur };
}

export async function bumpStats(env) {
  const s = (await env.DASH_KV.get('stats', 'json')) || { pushes: 0 };
  s.pushes += 1;
  await env.DASH_KV.put('stats', JSON.stringify(s));
}

// ---------- Kuliah: semester, catatan per tanggal, kuliah tambahan, tugas ----------
const KULIAH = 'kuliah';
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ID_RE = /^[\w-]{1,40}$/;
const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function getKuliah(env) {
  const k = (await env.DASH_KV.get(KULIAH, 'json')) || {};
  return { semester: k.semester || {}, occ: k.occ || {}, extras: k.extras || [], tasks: k.tasks || [] };
}
async function saveKuliah(env, k) {
  await env.DASH_KV.put(KULIAH, JSON.stringify(k));
  return k;
}
export async function getKuliahAll(env) {
  const [schedule, k] = await Promise.all([getSchedule(env), getKuliah(env)]);
  return { schedule, ...k };
}

export async function setSemester(env, input) {
  const start = String(input.start || ''), end = String(input.end || '');
  if (start && !DATE_RE.test(start)) throw new HttpError(400, 'Tanggal mulai tidak valid');
  if (end && !DATE_RE.test(end)) throw new HttpError(400, 'Tanggal selesai tidak valid');
  if (start && end && end < start) throw new HttpError(400, 'Tanggal selesai harus setelah tanggal mulai');
  const k = await getKuliah(env);
  k.semester = { start, end };
  return saveKuliah(env, k);
}

/** Tandai satu pertemuan: 'normal' (hapus catatan), 'done' (selesai), 'libur' (tidak ada kuliah). */
export async function setOcc(env, input) {
  const [date, id] = String(input.key || '').split('|');
  if (!DATE_RE.test(date || '') || !ID_RE.test(id || '')) throw new HttpError(400, 'Kunci pertemuan tidak valid');
  const status = String(input.status || 'normal');
  if (!['normal', 'done', 'libur'].includes(status)) throw new HttpError(400, 'Status tidak valid');
  const note = String(input.note || '').slice(0, 200);
  const k = await getKuliah(env);
  const key = `${date}|${id}`;
  if (status === 'normal' && !note) delete k.occ[key];
  else k.occ[key] = { status, ...(note ? { note } : {}), at: Date.now() };
  // buang catatan yang lebih tua dari ±13 bulan supaya data tidak membengkak
  const keys = Object.keys(k.occ);
  if (keys.length > 800) for (const x of keys.sort().slice(0, keys.length - 800)) delete k.occ[x];
  return saveKuliah(env, k);
}

export async function setOccBulk(env, input) {
  const keys = Array.isArray(input.keys) ? input.keys.slice(0, 200) : [];
  const status = String(input.status || '');
  if (!['done', 'libur'].includes(status)) throw new HttpError(400, 'Status tidak valid');
  const k = await getKuliah(env);
  for (const key of keys) {
    const [date, id] = String(key).split('|');
    if (!DATE_RE.test(date || '') || !ID_RE.test(id || '')) continue;
    k.occ[`${date}|${id}`] = { status, at: Date.now() };
  }
  return saveKuliah(env, k);
}

export async function saveExtra(env, input) {
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'Nama kuliah wajib');
  if (!DATE_RE.test(input.date || '')) throw new HttpError(400, 'Tanggal tidak valid');
  if (!TIME_RE.test(input.start || '') || !TIME_RE.test(input.end || '')) throw new HttpError(400, 'Jam tidak valid (HH:MM)');
  const link = String(input.link || '').trim();
  if (link && !/^https:\/\/[^\s"'<>]+$/.test(link)) throw new HttpError(400, 'Link harus https://');
  const k = await getKuliah(env);
  const item = {
    id: input.id && ID_RE.test(input.id) ? input.id : newId('x'), name, date: input.date, start: input.start, end: input.end, link,
    classId: input.classId && ID_RE.test(input.classId) ? input.classId : '', note: String(input.note || '').slice(0, 200),
  };
  const i = k.extras.findIndex((x) => x.id === item.id);
  if (i >= 0) k.extras[i] = item;
  else { if (k.extras.length >= 150) k.extras.sort((a, b) => a.date.localeCompare(b.date)).shift(); k.extras.push(item); }
  return saveKuliah(env, k);
}

export async function deleteExtra(env, id) {
  const k = await getKuliah(env);
  k.extras = k.extras.filter((x) => x.id !== id);
  for (const key of Object.keys(k.occ)) if (key.endsWith(`|${id}`)) delete k.occ[key];
  return saveKuliah(env, k);
}

export async function saveTask(env, input) {
  const title = String(input.title || '').trim().slice(0, 140);
  if (!title) throw new HttpError(400, 'Judul tugas wajib');
  const due = String(input.due || '');
  if (due && !DATE_RE.test(due)) throw new HttpError(400, 'Tanggal tenggat tidak valid');
  const dueTime = String(input.dueTime || '');
  if (dueTime && !TIME_RE.test(dueTime)) throw new HttpError(400, 'Jam tenggat tidak valid');
  const k = await getKuliah(env);
  const old = k.tasks.find((t) => t.id === input.id);
  const done = !!input.done;
  const item = {
    id: old ? old.id : newId('t'), title, due, dueTime,
    classId: input.classId && ID_RE.test(input.classId) ? input.classId : '',
    note: String(input.note || '').slice(0, 500), done,
    doneAt: done ? (old?.doneAt || Date.now()) : null, created: old?.created || Date.now(),
  };
  if (old) k.tasks[k.tasks.indexOf(old)] = item;
  else {
    if (k.tasks.length >= 300) {
      const oldestDone = k.tasks.filter((t) => t.done).sort((a, b) => a.doneAt - b.doneAt)[0];
      if (!oldestDone) throw new HttpError(400, 'Terlalu banyak tugas (maks 300). Hapus beberapa dulu.');
      k.tasks.splice(k.tasks.indexOf(oldestDone), 1);
    }
    k.tasks.push(item);
  }
  await saveKuliah(env, k);
  return item;
}

export async function deleteTask(env, id) {
  const k = await getKuliah(env);
  k.tasks = k.tasks.filter((t) => t.id !== id);
  return saveKuliah(env, k);
}

// ---------- Pengaturan notifikasi ----------
const NOTIFY_DEFAULT = { classLead: 15, taskLead: 60, deploy: true, morning: true, morningTime: '07:00' };
export async function getNotify(env) {
  return { ...NOTIFY_DEFAULT, ...((await env.DASH_KV.get('notify', 'json')) || {}) };
}
export async function setNotify(env, input) {
  const cur = await getNotify(env);
  const n = {
    classLead: [5, 10, 15, 30, 60].includes(Number(input.classLead)) ? Number(input.classLead) : cur.classLead,
    taskLead: [30, 60, 180, 720, 1440].includes(Number(input.taskLead)) ? Number(input.taskLead) : cur.taskLead,
    deploy: input.deploy === undefined ? cur.deploy : !!input.deploy,
    morning: input.morning === undefined ? cur.morning : !!input.morning,
    morningTime: TIME_RE.test(input.morningTime || '') ? input.morningTime : cur.morningTime,
  };
  await env.DASH_KV.put('notify', JSON.stringify(n));
  return n;
}
