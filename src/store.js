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
  let siteUrl = String(input.siteUrl || '').trim();
  if (siteUrl && !/^https:\/\/[^\s"'<>]+$/.test(siteUrl)) throw new HttpError(400, 'URL situs harus diawali https://');
  if (!siteUrl && pagesProject) siteUrl = `https://${pagesProject}.pages.dev`;
  const worker = String(input.worker || '').trim().slice(0, 20) || name.slice(0, 20);
  return { name, worker, owner, repo, branch, pagesProject, siteUrl };
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
