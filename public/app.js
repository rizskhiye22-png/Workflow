import { Office, STATUS_TEXT } from './office.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEMO = new URLSearchParams(location.search).has('demo');
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// ---------------- util ----------------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Kantor': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.reload(); throw new Error('Sesi habis'); }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3500);
}

function timeAgo(t) {
  if (!t) return '-';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'baru saja';
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
}

const errBox = (e) => `<div class="alert">${esc(e.message || e)}</div>`;
const pill = (status) => `<span class="pill st-${esc(status)}">${esc(STATUS_TEXT[status] || status)}</span>`;

function sheet(html) {
  const s = $('#sheet');
  s.innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet-card" role="dialog" aria-modal="true">${html}</div>`;
  s.classList.remove('hidden');
  $('[data-close]', s).onclick = closeSheet;
  return $('.sheet-card', s);
}
function closeSheet() {
  const s = $('#sheet');
  s.classList.add('hidden');
  s.innerHTML = '';
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// Jam Jepang (JST, UTC+9) — dihitung manual supaya benar di HP zona waktu mana pun
function jstNow() {
  const d = new Date(Date.now() + 9 * 3600_000);
  return { day: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes(), sec: d.getUTCSeconds(), date: d };
}
const pad = (n) => String(n).padStart(2, '0');
setInterval(tickClock, 1000);
function tickClock() {
  const n = jstNow();
  $('#clock').textContent = `${HARI[n.day].slice(0, 3)} ${pad(Math.floor(n.min / 60))}:${pad(n.min % 60)} JST`;
}
tickClock();

// ---------------- router ----------------
const state = { projects: null, params: new URLSearchParams() };
let office = null;
let cleanup = [];

const views = { kantor, jadwal, upload, data, riwayat, atur };

function route() {
  const [tab, q] = location.hash.slice(1).split('?');
  const name = views[tab] ? tab : 'kantor';
  state.params = new URLSearchParams(q || '');
  $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  cleanup.forEach((fn) => fn());
  cleanup = [];
  if (office) { office.destroy(); office = null; }
  closeSheet();
  view.innerHTML = '<div class="loading">Memuat…</div>';
  views[name]().catch((e) => { view.innerHTML = errBox(e); });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

async function loadProjects(force) {
  if (!state.projects || force) state.projects = DEMO ? demoWorkers() : await api('/projects');
  return state.projects;
}

function projectSelect(id, selected) {
  return `<select id="${id}">${state.projects.map((p) =>
    `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} — ${esc(p.owner)}/${esc(p.repo)}</option>`).join('')}</select>`;
}

const noProjects = () => `<div class="empty"><p>Belum ada proyek. Tambahkan dulu di menu <b>Atur</b>.</p>
  <a class="btn primary" href="#atur">Tambah proyek</a></div>`;

// ---------------- KANTOR ----------------
function demoWorkers() {
  const now = Date.now();
  return [
    { id: 'toko-online', name: 'Toko Online', worker: 'Budi', status: 'building', lastTime: now - 60e3, message: 'Tambah keranjang', owner: 'demo', repo: 'toko', siteUrl: 'https://example.com' },
    { id: 'portfolio', name: 'Portfolio', worker: 'Sari', status: 'success', lastTime: now - 3600e3, message: 'Update foto', owner: 'demo', repo: 'portfolio' },
    { id: 'api-absen', name: 'API Absen', worker: 'Joko', status: 'failed', lastTime: now - 7200e3, message: 'Fix login', owner: 'demo', repo: 'absen' },
    { id: 'blog', name: 'Blog', worker: 'Rina', status: 'sleep', lastTime: now - 5 * 86400e3, message: 'Post baru', owner: 'demo', repo: 'blog' },
    { id: 'kalkulator', name: 'Kalkulator', worker: 'Dewi', status: 'idle', owner: 'demo', repo: 'kalk' },
  ];
}

async function kantor() {
  view.innerHTML = `
    <section class="office-wrap">
      <div class="next-class" id="nextClass"></div>
      <div class="office-stats" id="ostats">Memanggil karyawan…</div>
      <div class="office" id="office"><canvas id="ocanvas" aria-label="Kantor pixel"></canvas><div class="olayer" id="olayer"></div></div>
      <div id="oempty"></div>
      <p class="hint">Ketuk karyawan untuk lihat proyeknya. Status diperbarui tiap menit.</p>
    </section>`;
  renderNextClassMini();

  const load = async () => {
    let workers = [];
    try {
      workers = DEMO ? demoWorkers() : (await api('/office')).workers;
    } catch (e) {
      $('#ostats').innerHTML = errBox(e);
    }
    const count = (s) => workers.filter((w) => w.status === s).length;
    $('#ostats').innerHTML = `
      <span><b>${workers.length}</b> karyawan</span>
      <span class="c-ok"><b>${count('success')}</b> sukses</span>
      <span class="c-run"><b>${count('building')}</b> kerja</span>
      <span class="c-bad"><b>${count('failed')}</b> gagal</span>
      <span class="c-zzz"><b>${count('sleep')}</b> tidur</span>`;
    $('#oempty').innerHTML = workers.length ? '' : noProjects();
    if (office) office.setWorkers(workers);
    else office = new Office($('#ocanvas'), $('#olayer'), workers, openWorker);
  };
  await load();
  const iv = setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
  cleanup.push(() => clearInterval(iv));
}

function openWorker(w) {
  sheet(`
    <h3>${esc(w.worker)} <span class="muted">· ${esc(w.name)}</span></h3>
    <p>${pill(w.status)}</p>
    ${w.message ? `<p class="muted">Terakhir: “${esc(w.message)}” · ${esc(timeAgo(w.lastTime))}${w.source ? ` · ${esc(w.source)}` : ''}</p>` : ''}
    ${w.detail ? `<div class="alert">${esc(w.detail)}</div>` : ''}
    <div class="row wrap">
      <a class="btn primary" href="#upload?p=${encodeURIComponent(w.id)}">Upload zip</a>
      <a class="btn" href="#riwayat?p=${encodeURIComponent(w.id)}">Riwayat</a>
      ${w.siteUrl ? `<a class="btn" href="${esc(w.siteUrl)}" target="_blank" rel="noopener">Buka situs</a>` : ''}
      ${w.repoUrl ? `<a class="btn ghost" href="${esc(w.repoUrl)}" target="_blank" rel="noopener">GitHub</a>` : ''}
    </div>
    <button class="btn ghost block" data-close2>Tutup</button>`);
  $('[data-close2]').onclick = closeSheet;
}

// ---------------- JADWAL KULIAH ----------------
let scheduleCache = null;
async function loadSchedule(force) {
  if (!scheduleCache || force) scheduleCache = DEMO ? [] : await api('/schedule');
  return scheduleCache;
}
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const dur = (c) => ((toMin(c.end) - toMin(c.start) + 1440) % 1440) || 1440;

/** Status tiap kelas relatif terhadap sekarang (JST). */
function classTimeline(list) {
  const n = jstNow();
  const nowW = n.day * 1440 + n.min + n.sec / 60;
  return list.map((c) => {
    const startW = c.day * 1440 + toMin(c.start);
    const since = (nowW - startW + 10080) % 10080;
    const ongoing = since < dur(c);
    const until = (startW - nowW + 10080) % 10080;
    return { ...c, ongoing, until, left: dur(c) - since };
  });
}

function fmtDur(min) {
  min = Math.max(0, Math.round(min));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return [d && `${d} hari`, h && `${h} jam`, `${m} menit`].filter(Boolean).join(' ');
}

async function renderNextClassMini() {
  const el = $('#nextClass');
  if (!el) return;
  try {
    const tl = classTimeline(await loadSchedule());
    if (!tl.length) { el.innerHTML = ''; return; }
    const now = tl.find((c) => c.ongoing);
    const next = [...tl].sort((a, b) => a.until - b.until)[0];
    el.innerHTML = now
      ? `<a href="#jadwal" class="nc live"><span class="dot"></span><b>Sedang kuliah:</b> ${esc(now.name)} · sisa ${fmtDur(now.left)}</a>`
      : `<a href="#jadwal" class="nc"><b>Kuliah berikutnya:</b> ${esc(next.name)} · ${HARI[next.day]} ${esc(next.start)} · ${fmtDur(next.until)} lagi</a>`;
  } catch { el.innerHTML = ''; }
}

const REMIND_KEY = 'kb_remind';
function remindOn() { try { return localStorage.getItem(REMIND_KEY) === '1'; } catch { return false; } }

async function jadwal() {
  const list = await loadSchedule();
  const render = () => {
    const tl = classTimeline(list);
    const now = tl.find((c) => c.ongoing);
    const upcoming = [...tl].filter((c) => !c.ongoing).sort((a, b) => a.until - b.until);
    const next = upcoming[0];
    const today = jstNow().day;
    const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => list.some((c) => c.day === d));

    $('#jHero').innerHTML = now ? `
      <div class="hero live">
        <div class="hero-label"><span class="dot"></span> SEDANG BERLANGSUNG</div>
        <div class="hero-name">${esc(now.name)}</div>
        <div class="hero-meta">${esc(now.start)}–${esc(now.end)} JST · sisa ${fmtDur(now.left)}</div>
        ${now.link ? `<a class="btn primary" href="${esc(now.link)}" target="_blank" rel="noopener">Masuk kelas</a>` : ''}
      </div>` : next ? `
      <div class="hero">
        <div class="hero-label">KULIAH BERIKUTNYA</div>
        <div class="hero-name">${esc(next.name)}</div>
        <div class="hero-meta">${HARI[next.day]} · ${esc(next.start)}–${esc(next.end)} JST</div>
        <div class="countdown">${fmtDur(next.until)} lagi</div>
        ${next.link ? `<a class="btn" href="${esc(next.link)}" target="_blank" rel="noopener">Link kelas</a>` : ''}
      </div>` : '<div class="empty">Belum ada jadwal.</div>';

    $('#jWeek').innerHTML = days.map((d) => {
      const items = tl.filter((c) => c.day === d).sort((a, b) => toMin(a.start) - toMin(b.start));
      return `<div class="day ${d === today ? 'today' : ''}">
        <h4>${HARI[d]}${d === today ? ' <span class="pill st-building">Hari ini</span>' : ''}</h4>
        ${items.map((c) => `
          <button class="class-row ${c.ongoing ? 'live' : ''}" data-edit="${esc(c.id)}">
            <span class="time">${esc(c.start)}<br><small>${esc(c.end)}${toMin(c.end) < toMin(c.start) ? '<sup>+1</sup>' : ''}</small></span>
            <span class="cname">${esc(c.name)}<small>${esc([c.kelas, c.code].filter(Boolean).join(' · '))}${c.note ? ' · ' + esc(c.note) : ''}</small></span>
          </button>`).join('')}
      </div>`;
    }).join('');
    $$('[data-edit]').forEach((b) => (b.onclick = () => editClass(list.find((c) => c.id === b.dataset.edit))));
  };

  view.innerHTML = `
    <section>
      <div id="jHero"></div>
      <div class="card">
        <h2>Pengingat</h2>
        <label class="switch"><input type="checkbox" id="jNotif" ${remindOn() ? 'checked' : ''}>
          <span>Notifikasi 15 menit sebelum kelas <small class="muted">(saat dashboard terbuka)</small></span></label>
        <p class="muted small">Supaya tetap diingatkan walau dashboard tertutup, pasang ke kalender HP:</p>
        <div class="row wrap">
          <label class="inline">Semester selesai <input type="date" id="jUntil"></label>
          <button class="btn primary" id="jIcs">Tambah ke kalender (.ics)</button>
        </div>
      </div>
      <div class="card">
        <div class="row between"><h2>Seminggu</h2><button class="btn" id="jAdd">+ Kelas</button></div>
        <p class="muted small">Semua jam dalam waktu Jepang (JST). <sup>+1</sup> = selesai besok harinya.</p>
        <div id="jWeek" class="week"></div>
      </div>
    </section>`;
  render();
  const iv = setInterval(render, 30_000);
  cleanup.push(() => clearInterval(iv));

  $('#jNotif').onchange = async (e) => {
    if (e.target.checked) {
      if (!('Notification' in window)) { toast('Browser ini tidak mendukung notifikasi', 'bad'); e.target.checked = false; return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Izin notifikasi ditolak', 'bad'); e.target.checked = false; return; }
    }
    try { localStorage.setItem(REMIND_KEY, e.target.checked ? '1' : '0'); } catch {}
    toast(e.target.checked ? 'Pengingat aktif' : 'Pengingat dimatikan');
  };
  $('#jIcs').onclick = () => downloadIcs(list, $('#jUntil').value);
  $('#jAdd').onclick = () => editClass(null);

  async function persist(next, msg) {
    try {
      scheduleCache = await api('/schedule', { method: 'PUT', body: { items: next } });
      list.splice(0, list.length, ...scheduleCache);
      closeSheet(); render(); toast(msg, 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  }

  function editClass(c) {
    const isNew = !c;
    c = c || { name: '', day: 1, start: '19:00', end: '20:40', code: '', kelas: '', link: '', note: '' };
    const card = sheet(`
      <h3>${isNew ? 'Tambah kelas' : 'Ubah kelas'}</h3>
      <label>Mata kuliah<input id="cName" value="${esc(c.name)}" maxlength="80"></label>
      <div class="grid3">
        <label>Hari<select id="cDay">${HARI.map((h, i) => `<option value="${i}" ${i === c.day ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
        <label>Mulai (JST)<input type="time" id="cStart" value="${esc(c.start)}"></label>
        <label>Selesai (JST)<input type="time" id="cEnd" value="${esc(c.end)}"></label>
      </div>
      <div class="grid2">
        <label>Kelas<input id="cKelas" value="${esc(c.kelas)}"></label>
        <label>Kode<input id="cCode" value="${esc(c.code)}"></label>
      </div>
      <label>Link kelas (Zoom/Meet, opsional)<input id="cLink" value="${esc(c.link)}" placeholder="https://"></label>
      <label>Catatan<input id="cNote" value="${esc(c.note)}" maxlength="200"></label>
      <div class="row wrap">
        <button class="btn primary" id="cSave">Simpan</button>
        ${isNew ? '' : '<button class="btn danger" id="cDel">Hapus</button>'}
        <button class="btn ghost" id="cCancel">Batal</button>
      </div>`);
    $('#cCancel', card).onclick = closeSheet;
    $('#cSave', card).onclick = () => {
      const item = {
        id: c.id, name: $('#cName').value.trim(), day: Number($('#cDay').value),
        start: $('#cStart').value, end: $('#cEnd').value, kelas: $('#cKelas').value.trim(),
        code: $('#cCode').value.trim(), link: $('#cLink').value.trim(), note: $('#cNote').value.trim(),
      };
      const next = isNew ? [...list, item] : list.map((x) => (x.id === c.id ? item : x));
      persist(next, 'Jadwal disimpan');
    };
    if (!isNew) $('#cDel', card).onclick = () => {
      if (confirm(`Hapus ${c.name} dari jadwal?`)) persist(list.filter((x) => x.id !== c.id), 'Kelas dihapus');
    };
  }
}

// Pengingat lokal: cek tiap 30 detik selama dashboard terbuka
const notified = new Set();
setInterval(async () => {
  if (!remindOn() || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    for (const c of classTimeline(await loadSchedule())) {
      const key = `${c.id}-${new Date().toDateString()}`;
      if (!c.ongoing && c.until <= 15 && !notified.has(key)) {
        notified.add(key);
        const reg = await navigator.serviceWorker?.getRegistration();
        const opts = { body: `${HARI[c.day]} ${c.start}–${c.end} JST · mulai ${Math.ceil(c.until)} menit lagi`, icon: '/icons/icon-192.png', tag: key };
        if (reg) reg.showNotification(`📚 ${c.name}`, opts); else new Notification(`📚 ${c.name}`, opts);
      }
    }
  } catch {}
}, 30_000);

/** Buat file kalender (.ics) berisi acara mingguan + alarm 15 menit sebelum. */
function downloadIcs(list, until) {
  if (!list.length) return toast('Jadwal kosong', 'bad');
  const n = jstNow();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const fmt = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
  const untilRule = until ? `;UNTIL=${until.replace(/-/g, '')}T145959Z` : '';
  const esct = (s) => String(s).replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kantor Bos//Jadwal Kuliah//ID', 'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:JST', 'END:STANDARD', 'END:VTIMEZONE',
  ];
  for (const c of list) {
    // tanggal kemunculan pertama (hari ini atau setelahnya), dalam "jam dinding" JST
    const base = new Date(Date.UTC(n.date.getUTCFullYear(), n.date.getUTCMonth(), n.date.getUTCDate()));
    const addDays = (c.day - n.day + 7) % 7;
    const start = new Date(base.getTime() + addDays * 86400_000 + toMin(c.start) * 60_000);
    const end = new Date(start.getTime() + dur(c) * 60_000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${c.id}-${c.day}${c.start.replace(':', '')}@kantor-bos`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Tokyo:${fmt(start)}`,
      `DTEND;TZID=Asia/Tokyo:${fmt(end)}`,
      `RRULE:FREQ=WEEKLY${untilRule}`,
      `SUMMARY:${esct(c.name)}`,
      `DESCRIPTION:${esct([c.kelas && 'Kelas ' + c.kelas, c.code && 'Kode ' + c.code, c.link, c.note].filter(Boolean).join(' · '))}`,
      ...(c.link ? [`URL:${c.link}`] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esct(c.name)} 15 menit lagi`, 'TRIGGER:-PT15M', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'jadwal-kuliah.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(until ? 'File kalender dibuat — buka untuk menambahkan' : 'Dibuat tanpa tanggal akhir (berulang terus)', 'ok');
}

// ---------------- UPLOAD ZIP ----------------
const SKIP_DIRS = new Set(['node_modules', '.git', '__MACOSX', '.wrangler', '.next', '.vercel']);
const SECRET_FILE = /^(\.env(\..+)?|\.dev\.vars)$/;
function skipReason(path) {
  const parts = path.split('/');
  if (parts.some((p) => SKIP_DIRS.has(p))) return 'folder diabaikan';
  const base = parts[parts.length - 1];
  if (base === '.DS_Store' || base === 'Thumbs.db') return 'sampah sistem';
  if (SECRET_FILE.test(base) && !/\.example$|\.sample$/.test(base)) return 'file rahasia';
  return null;
}

async function gitSha(data) {
  const head = new TextEncoder().encode(`blob ${data.length}\0`);
  const all = new Uint8Array(head.length + data.length);
  all.set(head);
  all.set(data, head.length);
  const h = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

async function upload() {
  await loadProjects();
  if (!state.projects.length) { view.innerHTML = `<section class="card"><h2>Upload ZIP</h2>${noProjects()}</section>`; return; }
  view.innerHTML = `
    <section class="card">
      <h2>Upload ZIP</h2>
      <label>Proyek ${projectSelect('uproj', state.params.get('p'))}</label>
      <label class="drop" id="drop">
        <input type="file" id="ufile" accept=".zip,application/zip" hidden>
        <span class="drop-ico"></span>
        <span id="dropText">Ketuk untuk pilih file .zip</span>
      </label>
      <label>Pesan commit<input id="umsg" placeholder="Update dari Kantor Bos" maxlength="200"></label>
      <fieldset class="radio">
        <legend>Mode</legend>
        <label><input type="radio" name="mode" value="replace" checked> <span><b>Ganti semua</b> — zip berisi proyek lengkap. File yang tidak ada di zip akan dihapus (kecuali folder .github).</span></label>
        <label><input type="radio" name="mode" value="merge"> <span><b>Tambah / timpa</b> — hanya file di zip yang diubah, file lain tetap.</span></label>
      </fieldset>
      <button class="btn primary block" id="ugo" disabled>Push ke GitHub</button>
      <div class="progress hidden" id="uprog"><div id="ubar"></div></div>
      <pre class="log hidden" id="ulog"></pre>
    </section>`;

  let file = null;
  const drop = $('#drop');
  $('#ufile').onchange = (e) => pick(e.target.files[0]);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); });
  function pick(f) {
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) return toast('Pilih file .zip', 'bad');
    if (f.size > 95 * 1048576) return toast('Zip terlalu besar (maks ±95 MB)', 'bad');
    file = f;
    $('#dropText').innerHTML = `<b>${esc(f.name)}</b> · ${fmtSize(f.size)}`;
    $('#ugo').disabled = false;
  }
  $('#ugo').onclick = () => file && runUpload(file);
}

async function runUpload(file) {
  const btn = $('#ugo'), logEl = $('#ulog'), bar = $('#ubar');
  const projectId = $('#uproj').value;
  const mode = $('input[name=mode]:checked').value;
  const message = $('#umsg').value.trim() || `Update dari Kantor Bos (${file.name})`;
  const log = (m, cls = '') => { logEl.innerHTML += `<span class="${cls}">${esc(m)}</span>\n`; logEl.scrollTop = logEl.scrollHeight; };
  const progress = (p) => { bar.style.width = `${Math.round(p * 100)}%`; };
  btn.disabled = true;
  logEl.innerHTML = '';
  logEl.classList.remove('hidden');
  $('#uprog').classList.remove('hidden');
  progress(0.02);

  try {
    log('Membuka zip…');
    const { unzipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js');
    const raw = unzipSync(new Uint8Array(await file.arrayBuffer()));
    let files = [];
    const skipped = {};
    for (const [path, data] of Object.entries(raw)) {
      if (path.endsWith('/')) continue;
      const why = skipReason(path);
      if (why) { skipped[why] = (skipped[why] || 0) + 1; continue; }
      files.push({ path, data });
    }
    // buang folder pembungkus kalau semua file ada di satu folder yang sama
    while (files.length && files.every((f) => f.path.includes('/') && f.path.split('/')[0] === files[0].path.split('/')[0])) {
      const root = files[0].path.split('/')[0] + '/';
      files = files.map((f) => ({ ...f, path: f.path.slice(root.length) }));
      log(`Folder pembungkus "${root}" dilepas`);
    }
    if (!files.length) throw new Error('Zip kosong setelah disaring');
    for (const [why, n] of Object.entries(skipped)) log(`Dilewati ${n} file (${why})`, why === 'file rahasia' ? 'warn' : 'muted');
    if (skipped['file rahasia']) log('File .env / .dev.vars tidak di-push supaya rahasia tidak bocor ke GitHub.', 'warn');
    const big = files.find((f) => f.data.length > 50 * 1048576);
    if (big) throw new Error(`${big.path} lebih dari 50 MB — GitHub menolak file sebesar itu`);
    log(`${files.length} file siap.`);
    progress(0.1);

    log('Menghubungi GitHub…');
    const start = await api('/push/start', { method: 'POST', body: { projectId } });
    if (start.newBranch) log(`Branch "${start.branch}" akan dibuat.`);
    for (const f of files) f.sha = await gitSha(f.data);
    progress(0.2);

    const existing = start.tree;
    const changed = files.filter((f) => existing[f.path]?.sha !== f.sha);
    const zipPaths = new Set(files.map((f) => f.path));
    const zipHasGithub = files.some((f) => f.path.startsWith('.github/'));
    const kept = Object.entries(existing).filter(([p]) => !zipPaths.has(p) && p.startsWith('.github/') && !zipHasGithub);
    const deleted = mode === 'replace' ? Object.keys(existing).filter((p) => !zipPaths.has(p) && !kept.some(([k]) => k === p)) : [];
    log(`${changed.length} file berubah, ${deleted.length} file dihapus.`);
    if (!changed.length && !deleted.length) {
      progress(1);
      log('Tidak ada perubahan — tidak perlu push.', 'ok');
      toast('Tidak ada perubahan');
      return;
    }

    // upload isi file yang berubah, per batch (maks 40 file / ±12 MB)
    const batches = [];
    let cur = [], size = 0;
    for (const f of changed) {
      if (cur.length && (cur.length >= 40 || size + f.data.length > 12 * 1048576)) { batches.push(cur); cur = []; size = 0; }
      cur.push(f); size += f.data.length;
    }
    if (cur.length) batches.push(cur);
    let done = 0;
    for (const b of batches) {
      const res = await api('/push/blobs', { method: 'POST', body: { projectId, files: b.map((f) => ({ path: f.path, b64: toB64(f.data) })) } });
      for (const r of res) {
        const f = b.find((x) => x.path === r.path);
        if (f.sha !== r.sha) log(`Peringatan: SHA ${f.path} berbeda`, 'warn');
        f.sha = r.sha;
      }
      done += b.length;
      log(`Upload ${done}/${changed.length} file`);
      progress(0.2 + 0.7 * (done / changed.length));
    }

    const entries = mode === 'replace'
      ? [...files.map((f) => ({ path: f.path, sha: f.sha, mode: existing[f.path]?.mode || '100644' })),
         ...kept.map(([path, e]) => ({ path, sha: e.sha, mode: e.mode }))]
      : changed.map((f) => ({ path: f.path, sha: f.sha, mode: existing[f.path]?.mode || '100644' }));

    log('Membuat commit…');
    const fin = await api('/push/finish', {
      method: 'POST',
      body: {
        projectId, message, entries, base: mode === 'merge',
        parentSha: start.parentSha, parentTree: start.parentTree, newBranch: start.newBranch,
        changedCount: changed.length + deleted.length,
      },
    });
    progress(1);
    if (fin.unchanged) { log('Tidak ada perubahan.', 'ok'); return; }
    log(`Berhasil! Commit ${fin.sha.slice(0, 7)} — Cloudflare akan deploy otomatis.`, 'ok');
    logEl.innerHTML += `<a href="${esc(fin.url)}" target="_blank" rel="noopener">Lihat commit di GitHub ↗</a>\n`;
    toast('Push berhasil! Karyawan mulai kerja.', 'ok');
  } catch (e) {
    log(`Gagal: ${e.message}`, 'bad');
    toast(e.message, 'bad');
  } finally {
    btn.disabled = false;
  }
}

// ---------------- DATA (KV & D1) ----------------
async function data() {
  const sub = state.params.get('s') === 'd1' ? 'd1' : 'kv';
  view.innerHTML = `
    <section class="card">
      <div class="seg" role="tablist">
        <a href="#data?s=kv" class="${sub === 'kv' ? 'on' : ''}">KV</a>
        <a href="#data?s=d1" class="${sub === 'd1' ? 'on' : ''}">Database D1</a>
      </div>
      <div id="dbody"><div class="loading">Memuat…</div></div>
    </section>`;
  if (sub === 'kv') await kvView($('#dbody')); else await d1View($('#dbody'));
}

async function kvView(el) {
  let ns;
  try { ns = await api('/kv/namespaces'); } catch (e) { el.innerHTML = errBox(e); return; }
  el.innerHTML = `
    <div class="row">
      <select id="kns" class="grow">${ns.map((n) => `<option value="${esc(n.id)}">${esc(n.title)}</option>`).join('')}</select>
      <button class="btn ghost" id="knsnew" title="Buat namespace">+ NS</button>
    </div>
    <div class="row"><input id="kprefix" class="grow" placeholder="Cari awalan key…"><button class="btn" id="ksearch">Cari</button></div>
    <button class="btn primary block" id="knew">+ Key baru</button>
    <ul class="list" id="kkeys"></ul>
    <button class="btn ghost block hidden" id="kmore">Muat lagi</button>`;
  $('#knsnew').onclick = async () => {
    const title = prompt('Nama namespace KV baru:');
    if (!title) return;
    try { await api('/kv/namespaces', { method: 'POST', body: { title } }); toast('Namespace dibuat', 'ok'); kvView(el); }
    catch (e) { toast(e.message, 'bad'); }
  };
  if (!ns.length) { $('#kkeys').innerHTML = '<li class="muted">Belum ada namespace KV.</li>'; return; }

  let cursor = null;
  const nsId = () => $('#kns').value;
  async function load(reset) {
    if (reset) { cursor = null; $('#kkeys').innerHTML = ''; }
    const q = new URLSearchParams({ prefix: $('#kprefix').value.trim() });
    if (cursor) q.set('cursor', cursor);
    try {
      const r = await api(`/kv/${nsId()}/keys?${q}`);
      for (const k of r.keys) {
        const li = document.createElement('li');
        li.innerHTML = `<button class="key-row"><span>${esc(k.name)}</span>${k.expiration ? `<small class="muted">kedaluwarsa ${new Date(k.expiration * 1000).toLocaleDateString('id-ID')}</small>` : ''}</button>`;
        $('button', li).onclick = () => kvEditor(nsId(), k.name, () => load(true));
        $('#kkeys').appendChild(li);
      }
      if (reset && !r.keys.length) $('#kkeys').innerHTML = '<li class="muted">Kosong.</li>';
      cursor = r.cursor;
      $('#kmore').classList.toggle('hidden', !cursor);
    } catch (e) { $('#kkeys').innerHTML = `<li>${errBox(e)}</li>`; }
  }
  $('#kns').onchange = () => load(true);
  $('#ksearch').onclick = () => load(true);
  $('#kprefix').onkeydown = (e) => { if (e.key === 'Enter') load(true); };
  $('#kmore').onclick = () => load(false);
  $('#knew').onclick = () => kvEditor(nsId(), null, () => load(true));
  load(true);
}

function kvEditor(ns, key, onDone) {
  const isNew = !key;
  const card = sheet(`
    <h3>${isNew ? 'Key baru' : `<code>${esc(key)}</code>`}</h3>
    ${isNew ? '<label>Nama key<input id="ek" maxlength="512"></label>' : ''}
    <label>Isi (value)<textarea id="ev" rows="12" spellcheck="false">${isNew ? '' : 'Memuat…'}</textarea></label>
    <div class="row wrap">
      <button class="btn" id="epretty">Rapikan JSON</button>
      <button class="btn primary" id="esave">Simpan</button>
      ${isNew ? '' : '<button class="btn danger" id="edel">Hapus</button>'}
      <button class="btn ghost" id="eclose">Tutup</button>
    </div>`);
  const ta = $('#ev', card);
  if (!isNew) {
    ta.disabled = true;
    api(`/kv/${ns}/value?key=${encodeURIComponent(key)}`)
      .then((r) => { ta.value = r.value; ta.disabled = false; })
      .catch((e) => { ta.value = ''; ta.disabled = false; toast(e.message, 'bad'); });
  }
  $('#eclose', card).onclick = closeSheet;
  $('#epretty', card).onclick = () => {
    try { ta.value = JSON.stringify(JSON.parse(ta.value), null, 2); } catch { toast('Bukan JSON yang valid', 'bad'); }
  };
  $('#esave', card).onclick = async () => {
    const k = isNew ? $('#ek', card).value.trim() : key;
    if (!k) return toast('Nama key wajib', 'bad');
    try {
      await api(`/kv/${ns}/value?key=${encodeURIComponent(k)}`, { method: 'PUT', body: { value: ta.value } });
      toast('Tersimpan', 'ok'); closeSheet(); onDone();
    } catch (e) { toast(e.message, 'bad'); }
  };
  if (!isNew) $('#edel', card).onclick = async () => {
    if (!confirm(`Hapus key "${key}"? Tidak bisa dibatalkan.`)) return;
    try { await api(`/kv/${ns}/value?key=${encodeURIComponent(key)}`, { method: 'DELETE' }); toast('Dihapus', 'ok'); closeSheet(); onDone(); }
    catch (e) { toast(e.message, 'bad'); }
  };
}

async function d1View(el) {
  let dbs;
  try { dbs = await api('/d1/databases'); } catch (e) { el.innerHTML = errBox(e); return; }
  el.innerHTML = `
    <div class="row">
      <select id="ddb" class="grow">${dbs.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select>
      <button class="btn ghost" id="ddbnew">+ DB</button>
    </div>
    <div class="chips" id="dtables"></div>
    <label>SQL<textarea id="dsql" rows="5" spellcheck="false" placeholder="SELECT * FROM users LIMIT 20;"></textarea></label>
    <button class="btn primary block" id="drun">Jalankan</button>
    <div id="dres"></div>`;
  $('#ddbnew').onclick = async () => {
    const name = prompt('Nama database D1 baru (huruf, angka, -):');
    if (!name) return;
    try { await api('/d1/databases', { method: 'POST', body: { name } }); toast('Database dibuat', 'ok'); d1View(el); }
    catch (e) { toast(e.message, 'bad'); }
  };
  if (!dbs.length) { $('#dtables').innerHTML = '<span class="muted">Belum ada database D1.</span>'; $('#drun').disabled = true; return; }

  const dbId = () => $('#ddb').value;
  const q = (sql) => api(`/d1/${dbId()}/query`, { method: 'POST', body: { sql } });
  async function tables() {
    $('#dtables').innerHTML = '<span class="muted">Memuat tabel…</span>';
    try {
      const r = await q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
      const names = r[r.length - 1]?.results?.map((x) => x.name) || [];
      $('#dtables').innerHTML = names.length ? names.map((n) => `<button class="chip" data-t="${esc(n)}">${esc(n)}</button>`).join('') : '<span class="muted">Belum ada tabel.</span>';
      $$('[data-t]', el).forEach((b) => (b.onclick = () => { $('#dsql').value = `SELECT * FROM "${b.dataset.t}" LIMIT 50;`; run(); }));
    } catch (e) { $('#dtables').innerHTML = errBox(e); }
  }
  async function run() {
    const sql = $('#dsql').value.trim();
    if (!sql) return;
    if (/\b(drop|delete|update|alter|truncate|replace)\b/i.test(sql) && !confirm('Perintah ini mengubah/menghapus data. Lanjutkan?')) return;
    $('#dres').innerHTML = '<div class="loading">Menjalankan…</div>';
    try {
      const r = await q(sql);
      $('#dres').innerHTML = r.map((s) => resultTable(s)).join('');
      if (/\b(create|drop|alter)\b/i.test(sql)) tables();
    } catch (e) { $('#dres').innerHTML = errBox(e); }
  }
  $('#ddb').onchange = tables;
  $('#drun').onclick = run;
  tables();
}

function resultTable(s) {
  const rows = s.results || [];
  const meta = s.meta || {};
  const info = `<p class="muted small">${rows.length} baris${meta.changes ? ` · ${meta.changes} diubah` : ''}${meta.duration != null ? ` · ${Number(meta.duration).toFixed(1)} ms` : ''}</p>`;
  if (!rows.length) return info;
  const cols = Object.keys(rows[0]);
  return `${info}<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${r[c] === null ? '<i class="muted">null</i>' : esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ---------------- RIWAYAT ----------------
async function riwayat() {
  await loadProjects();
  if (!state.projects.length) { view.innerHTML = `<section class="card"><h2>Riwayat</h2>${noProjects()}</section>`; return; }
  const sel = state.params.get('p') || state.projects[0].id;
  view.innerHTML = `<section class="card"><h2>Riwayat deploy</h2><label>Proyek ${projectSelect('hproj', sel)}</label><div id="hbody"><div class="loading">Memuat…</div></div></section>`;
  $('#hproj').onchange = (e) => { location.hash = `riwayat?p=${encodeURIComponent(e.target.value)}`; };
  try {
    const h = await api(`/projects/${encodeURIComponent(sel)}/history`);
    const runStatus = (r) => (r.status !== 'completed' ? 'building' : ['success', 'skipped', 'neutral'].includes(r.conclusion) ? 'success' : 'failed');
    const item = (title, sub, status, url) => `<li class="hist"><div><b>${esc(title || '(tanpa pesan)')}</b><small class="muted">${sub}</small></div>${status ? pill(status) : ''}${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="ext" aria-label="Buka">↗</a>` : ''}</li>`;
    $('#hbody').innerHTML = `
      ${h.error ? errBox(h.error) : ''}
      <h3>Push dari dashboard</h3>
      <ul class="list">${h.pushes.map((p) => item(p.message, `${timeAgo(p.time)} · ${p.sha.slice(0, 7)} · ${p.files} file`, '', p.url)).join('') || '<li class="muted">Belum ada.</li>'}</ul>
      <h3>GitHub Actions</h3>
      <ul class="list">${h.runs.map((r) => item(r.title, `${esc(r.name)} · ${timeAgo(Date.parse(r.created_at))}`, runStatus(r), r.url)).join('') || '<li class="muted">Tidak ada workflow run.</li>'}</ul>
      ${h.project.pagesProject ? `<h3>Cloudflare Pages</h3>
      <ul class="list">${h.deployments.map((d) => item(d.message, `${esc(d.environment)} · ${timeAgo(Date.parse(d.created_on))}`, d.status, d.url)).join('') || '<li class="muted">Belum ada deployment.</li>'}</ul>` : ''}`;
  } catch (e) { $('#hbody').innerHTML = errBox(e); }
}

// ---------------- ATUR ----------------
function parseRepo(s) {
  s = s.trim();
  let m = s.match(/github\.com[/:]([^/]+)\/([^/#?\s]+?)(?:\.git)?\/?$/i);
  if (!m) m = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function atur() {
  const [me] = await Promise.all([DEMO ? { config: {} } : api('/me'), loadProjects(true)]);
  const ok = (b) => (b ? '<span class="pill st-success">Terpasang</span>' : '<span class="pill st-failed">Belum</span>');
  view.innerHTML = `
    <section class="card">
      <h2>Koneksi</h2>
      <ul class="list plain">
        <li class="row between"><span>Token GitHub</span>${ok(me.config.github)}</li>
        <li class="row between"><span>Token Cloudflare + Account ID</span>${ok(me.config.cloudflare)}</li>
      </ul>
      <button class="btn block" id="acheck">Cek koneksi</button>
      <div id="acheckres"></div>
    </section>
    <section class="card">
      <div class="row between"><h2>Proyek / karyawan</h2><button class="btn primary" id="aadd">+ Proyek</button></div>
      <ul class="list" id="aplist">${state.projects.map((p) => `
        <li class="hist"><div><b>${esc(p.worker)}</b> · ${esc(p.name)}<small class="muted">${esc(p.owner)}/${esc(p.repo)} · ${esc(p.branch)}${p.pagesProject ? ` · Pages: ${esc(p.pagesProject)}` : ''}</small></div>
        <button class="btn ghost" data-edit="${esc(p.id)}">Ubah</button></li>`).join('') || '<li class="muted">Belum ada proyek.</li>'}</ul>
    </section>
    <section class="card">
      <h2>Akun</h2>
      <button class="btn danger block" id="alogout">Keluar</button>
    </section>`;
  $('#acheck').onclick = async () => {
    $('#acheckres').innerHTML = '<div class="loading">Mengecek…</div>';
    try {
      const r = await api('/check', { method: 'POST', body: {} });
      $('#acheckres').innerHTML = `<ul class="list plain">${[['GitHub', r.github], ['KV', r.kv], ['D1', r.d1]]
        .map(([n, x]) => `<li><b>${n}:</b> ${x.ok ? '✅' : '❌'} ${esc(x.detail)}</li>`).join('')}</ul>`;
    } catch (e) { $('#acheckres').innerHTML = errBox(e); }
  };
  $('#aadd').onclick = () => projectForm(null);
  $$('[data-edit]').forEach((b) => (b.onclick = () => projectForm(state.projects.find((p) => p.id === b.dataset.edit))));
  $('#alogout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.replace('/'); };
}

function projectForm(p) {
  const isNew = !p;
  p = p || { name: '', worker: '', owner: '', repo: '', branch: 'main', pagesProject: '', siteUrl: '' };
  const card = sheet(`
    <h3>${isNew ? 'Rekrut karyawan baru' : 'Ubah proyek'}</h3>
    <label>Nama proyek<input id="pName" value="${esc(p.name)}" maxlength="40" placeholder="Toko Online"></label>
    <label>Nama karyawan pixel<input id="pWorker" value="${esc(p.worker)}" maxlength="20" placeholder="Budi"></label>
    <label>Repo GitHub<input id="pRepo" value="${p.owner ? esc(p.owner + '/' + p.repo) : ''}" placeholder="username/nama-repo atau URL GitHub"></label>
    <label>Branch<input id="pBranch" value="${esc(p.branch)}"></label>
    <label>Nama proyek Cloudflare Pages <small class="muted">(opsional, untuk status deploy)</small><input id="pPages" value="${esc(p.pagesProject)}" placeholder="toko-online"></label>
    <label>URL situs <small class="muted">(opsional)</small><input id="pUrl" value="${esc(p.siteUrl)}" placeholder="https://…"></label>
    <div class="row wrap">
      <button class="btn primary" id="pSave">Simpan</button>
      ${isNew ? '' : '<button class="btn danger" id="pDel">Pecat (hapus)</button>'}
      <button class="btn ghost" id="pCancel">Batal</button>
    </div>`);
  $('#pCancel', card).onclick = closeSheet;
  $('#pSave', card).onclick = async () => {
    const r = parseRepo($('#pRepo').value);
    if (!r) return toast('Format repo: username/nama-repo', 'bad');
    try {
      await api('/projects', {
        method: 'POST',
        body: {
          id: p.id, name: $('#pName').value, worker: $('#pWorker').value, ...r,
          branch: $('#pBranch').value || 'main', pagesProject: $('#pPages').value, siteUrl: $('#pUrl').value,
        },
      });
      toast(isNew ? 'Karyawan baru masuk kantor!' : 'Tersimpan', 'ok');
      closeSheet(); atur();
    } catch (e) { toast(e.message, 'bad'); }
  };
  if (!isNew) $('#pDel', card).onclick = async () => {
    if (!confirm(`Hapus proyek ${p.name} dari dashboard? (Repo GitHub tidak ikut terhapus)`)) return;
    try { await api(`/projects/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); toast('Proyek dihapus', 'ok'); closeSheet(); atur(); }
    catch (e) { toast(e.message, 'bad'); }
  };
}

// ---------------- start ----------------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();
