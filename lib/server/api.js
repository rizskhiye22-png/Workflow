import { json, error, readJson, HttpError } from './util.js';
import { isAuthed, login, logout } from './auth.js';
import * as gh from './github.js';
import * as cf from './cloudflare.js';
import * as store from './store.js';
import * as push from './webpush.js';
import { buildReport } from './cron.js';

/** Dipanggil dari app/api/[...path]/route.js untuk semua request /api/*. */
export async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (!env.DASH_KV) return error(500, 'Binding KV DASH_KV belum ada');
    if (path === '/api/login' && request.method === 'POST') return await login(request, env);
    if (path === '/api/logout' && request.method === 'POST') return logout();

    if (!(await isAuthed(request, env))) return error(401, 'Belum login');
    // Proteksi CSRF ringan: request yang mengubah data wajib membawa header khusus
    if (request.method !== 'GET' && request.headers.get('X-Kantor') !== '1') return error(403, 'Header tidak valid');
    return await api(request, env, url);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    return error(e.status || 500, e.message || 'Terjadi kesalahan');
  }
}

async function api(req, env, url) {
  const p = url.pathname.slice(4); // buang "/api"
  const m = req.method;
  let mm;

  if (p === '/me' && m === 'GET') {
    return json({
      config: {
        github: !!env.GITHUB_TOKEN,
        cloudflare: !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID),
      },
    });
  }
  if (p === '/stats' && m === 'GET') return json(await store.getStats(env));
  if (p === '/check' && m === 'POST') return json(await checkConnections(env));

  // ----- Proyek -----
  if (p === '/projects' && m === 'GET') return json(await store.listProjects(env));
  if (p === '/projects' && m === 'POST') return json(await store.saveProject(env, await readJson(req, 10_000)));
  if ((mm = p.match(/^\/projects\/([\w-]+)$/)) && m === 'DELETE') {
    await store.deleteProject(env, mm[1]);
    return json({ ok: true });
  }
  if ((mm = p.match(/^\/projects\/([\w-]+)\/history$/)) && m === 'GET') {
    const proj = await store.getProject(env, mm[1]);
    const [pushes, st, commits] = await Promise.all([
      store.getHistory(env, proj.id), projectStatus(env, proj),
      gh.recentCommits(env, proj).catch(() => []),
    ]);
    return json({ project: proj, pushes, commits, ...st });
  }
  if (p === '/rollback' && m === 'POST') {
    const body = await readJson(req, 10_000);
    const proj = await store.getProject(env, body.projectId);
    const r = await gh.rollback(env, proj, body.sha);
    if (!r.unchanged) await store.addHistory(env, proj.id, { sha: r.sha, url: r.url, message: r.message, time: Date.now(), files: 0 });
    return json(r);
  }
  if (p === '/office' && m === 'GET') return json(await office(env));

  // ----- Push zip ke GitHub -----
  if (p === '/push/start' && m === 'POST') {
    const body = await readJson(req, 10_000);
    return json(await gh.pushStart(env, await store.getProject(env, body.projectId)));
  }
  if (p === '/push/blobs' && m === 'POST') {
    const body = await readJson(req);
    return json(await gh.pushBlobs(env, await store.getProject(env, body.projectId), body.files));
  }
  if (p === '/push/finish' && m === 'POST') {
    const body = await readJson(req, 5 * 1024 * 1024);
    const proj = await store.getProject(env, body.projectId);
    const r = await gh.pushFinish(env, proj, body);
    if (!r.unchanged) {
      await store.addHistory(env, proj.id, {
        sha: r.sha, url: r.url, message: r.message, time: Date.now(),
        files: Number(body.changedCount) || 0,
      });
      await store.bumpStats(env);
    }
    return json(r);
  }

  // ----- KV -----
  if (p === '/kv/namespaces' && m === 'GET') return json(await cf.kvNamespaces(env));
  if (p === '/kv/namespaces' && m === 'POST') return json(await cf.kvCreateNamespace(env, (await readJson(req, 10_000)).title));
  if ((mm = p.match(/^\/kv\/([a-f0-9]{32})\/keys$/)) && m === 'GET') {
    return json(await cf.kvKeys(env, mm[1], {
      prefix: url.searchParams.get('prefix') || '',
      cursor: url.searchParams.get('cursor') || '',
    }));
  }
  if ((mm = p.match(/^\/kv\/([a-f0-9]{32})\/value$/))) {
    const key = url.searchParams.get('key') || '';
    if (!key) throw new HttpError(400, 'Parameter key wajib');
    if (m === 'GET') return json({ value: await cf.kvGet(env, mm[1], key) });
    if (m === 'PUT') {
      await cf.kvPut(env, mm[1], key, (await readJson(req, 26 * 1024 * 1024)).value);
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      await cf.kvDelete(env, mm[1], key);
      return json({ ok: true });
    }
  }

  // ----- D1 -----
  if (p === '/d1/databases' && m === 'GET') return json(await cf.d1Databases(env));
  if (p === '/d1/databases' && m === 'POST') return json(await cf.d1Create(env, (await readJson(req, 10_000)).name));
  if ((mm = p.match(/^\/d1\/([0-9a-f-]{36})\/query$/)) && m === 'POST') {
    return json(await cf.d1Query(env, mm[1], (await readJson(req, 200_000)).sql));
  }

  // ----- Jadwal kuliah -----
  if (p === '/schedule' && m === 'GET') return json(await store.getSchedule(env));
  if (p === '/schedule' && m === 'PUT') return json(await store.saveSchedule(env, (await readJson(req, 100_000)).items));

  // ----- Kuliah: semester, pertemuan, kuliah tambahan, tugas -----
  if (p === '/kuliah' && m === 'GET') return json(await store.getKuliahAll(env));
  if (p === '/kuliah/semester' && m === 'PUT') { await store.setSemester(env, await readJson(req, 10_000)); return json(await store.getKuliahAll(env)); }
  if (p === '/kuliah/occ' && m === 'PUT') { await store.setOcc(env, await readJson(req, 10_000)); return json(await store.getKuliahAll(env)); }
  if (p === '/kuliah/occ-bulk' && m === 'PUT') { await store.setOccBulk(env, await readJson(req, 50_000)); return json(await store.getKuliahAll(env)); }
  if (p === '/kuliah/extra' && m === 'POST') { await store.saveExtra(env, await readJson(req, 10_000)); return json(await store.getKuliahAll(env)); }
  if ((mm = p.match(/^\/kuliah\/extra\/([\w-]+)$/)) && m === 'DELETE') { await store.deleteExtra(env, mm[1]); return json(await store.getKuliahAll(env)); }
  if (p === '/kuliah/task' && m === 'POST') { await store.saveTask(env, await readJson(req, 20_000)); return json(await store.getKuliahAll(env)); }
  if ((mm = p.match(/^\/kuliah\/task\/([\w-]+)$/)) && m === 'DELETE') { await store.deleteTask(env, mm[1]); return json(await store.getKuliahAll(env)); }
  if (p === '/report' && m === 'GET') return json(await buildReport(env));

  // ----- Notifikasi push -----
  if (p === '/push/key' && m === 'GET') return json({ publicKey: (await push.getVapid(env)).publicKey });
  if (p === '/push/subscribe' && m === 'POST') return json(await push.addSub(env, await readJson(req, 10_000), url.origin));
  if (p === '/push/unsubscribe' && m === 'POST') { await push.removeSub(env, (await readJson(req, 10_000)).endpoint); return json({ ok: true }); }
  if (p === '/push/devices' && m === 'GET') return json((await push.listSubs(env)).map((s) => ({ endpoint: s.endpoint, label: s.label, added: s.added })));
  if (p === '/push/test' && m === 'POST') {
    const r = await push.broadcast(env, { title: '🔔 Tes dari Kantor Bos', body: 'Notifikasi push sudah aktif. Siap bekerja, Bos!', tag: 'test', url: '/' });
    if (!r.devices) throw new HttpError(400, 'Belum ada perangkat yang mengaktifkan notifikasi');
    return json(r);
  }
  if (p === '/notify' && m === 'GET') return json(await store.getNotify(env));
  if (p === '/notify' && m === 'PUT') return json(await store.setNotify(env, await readJson(req, 10_000)));

  return error(404, 'Endpoint tidak ada');
}

async function checkConnections(env) {
  const run = async (fn) => {
    try { return { ok: true, detail: await fn() }; } catch (e) { return { ok: false, detail: e.message }; }
  };
  const [github, kv, d1] = await Promise.all([
    run(async () => `Login sebagai ${(await gh.whoami(env)).login}`),
    run(async () => `${(await cf.kvNamespaces(env)).length} namespace KV terlihat`),
    run(async () => `${(await cf.d1Databases(env)).length} database D1 terlihat`),
  ]);
  return { github, kv, d1 };
}

async function projectStatus(env, p) {
  const out = { runs: [], deployments: [], error: null };
  const tasks = [];
  if (env.GITHUB_TOKEN) {
    tasks.push(gh.latestRuns(env, p).then((r) => { out.runs = r; }).catch((e) => { out.error = e.message; }));
  }
  if ((p.pagesProject || p.workerName) && env.CF_API_TOKEN && env.CF_ACCOUNT_ID) {
    const job = p.workerName ? cf.workerDeployments(env, p.workerName) : cf.pagesDeployments(env, p.pagesProject);
    tasks.push(job.then((d) => { out.deployments = d; })
      .catch((e) => { out.error = out.error || e.message; }));
  }
  await Promise.all(tasks);
  return out;
}

const DAY = 86400_000;

/** Ringkas status satu proyek jadi "mood" karyawan pixel. */
function summarize(st, lastPush) {
  const events = [];
  const r = st.runs[0];
  if (r) {
    let s = 'building';
    if (r.status === 'completed') s = ['success', 'skipped', 'neutral'].includes(r.conclusion) ? 'success' : 'failed';
    events.push({ time: Date.parse(r.created_at), status: s, message: r.title, url: r.url, source: 'GitHub Actions' });
  }
  const d = st.deployments[0];
  if (d) events.push({ time: Date.parse(d.created_on), status: d.status, message: d.message, url: d.url, source: 'Cloudflare' });
  if (lastPush) events.push({ time: lastPush.time, status: 'pushed', message: lastPush.message, url: lastPush.url, source: 'Kantor Bos' });
  events.sort((a, b) => b.time - a.time);

  const latest = events[0];
  if (!latest) return { status: st.error ? 'unknown' : 'idle', detail: st.error || '' };
  const deploy = events.find((e) => e.status !== 'pushed');
  let pick = deploy || latest;
  let status = pick.status;
  // Baru push dan belum ada deploy yang lebih baru → anggap sedang diproses
  if (latest.status === 'pushed' && Date.now() - latest.time < 5 * 60_000) { pick = latest; status = 'building'; }
  else if (status === 'pushed') status = 'success';
  if (status === 'success' && Date.now() - pick.time > 3 * DAY) status = 'sleep';
  return { status, lastTime: pick.time, message: pick.message, url: pick.url, source: pick.source, detail: st.error || '' };
}

/** Status ringkas satu proyek (dipakai juga oleh cron untuk notifikasi deploy). */
export async function summarizeProject(env, p) {
  const [st, hist] = await Promise.all([projectStatus(env, p), store.getHistory(env, p.id)]);
  return summarize(st, hist[0]);
}

async function office(env) {
  const projects = await store.listProjects(env);
  const workers = await Promise.all(projects.map(async (p) => {
    const [st, hist] = await Promise.all([projectStatus(env, p), store.getHistory(env, p.id)]);
    return {
      id: p.id, name: p.name, worker: p.worker || p.name, siteUrl: p.siteUrl || '',
      repoUrl: `https://github.com/${p.owner}/${p.repo}`,
      ...summarize(st, hist[0]),
    };
  }));
  return { workers, stats: await store.getStats(env) };
}
