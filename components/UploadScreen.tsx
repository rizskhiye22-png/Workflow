'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { unzipSync } from 'fflate';
import { api, toast, sfx } from '@/lib/client';
import { Btn, Field, Loading, Panel, ErrorBox } from './ui';

const SKIP_DIRS = new Set(['node_modules', '.git', '__MACOSX', '.wrangler', '.next', '.vercel', 'dist-ssr']);
const SECRET = /^(\.env(\..+)?|\.dev\.vars)$/;
function skipReason(path: string) {
  const parts = path.split('/');
  if (parts.some((p) => SKIP_DIRS.has(p))) return 'folder diabaikan';
  const base = parts[parts.length - 1];
  if (base === '.DS_Store' || base === 'Thumbs.db') return 'sampah sistem';
  if (SECRET.test(base) && !/\.(example|sample)$/.test(base)) return 'file rahasia';
  return null;
}
async function gitSha(data: Uint8Array) {
  const head = new TextEncoder().encode(`blob ${data.length}\0`);
  const all = new Uint8Array(head.length + data.length);
  all.set(head); all.set(data, head.length);
  const h = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function toB64(u8: Uint8Array) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as any);
  return btoa(s);
}
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

type Line = { t: string; c?: string; href?: string };

export default function UploadScreen() {
  const [projects, setProjects] = useState<any[] | null>(null);
  const [err, setErr] = useState<any>(null);
  const [pid, setPid] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [over, setOver] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api('/projects').then((p) => {
      setProjects(p);
      const want = new URLSearchParams(location.search).get('p');
      setPid(p.find((x: any) => x.id === want)?.id || p[0]?.id || '');
    }).catch(setErr);
  }, []);
  useEffect(() => { logRef.current?.scrollTo(0, 1e9); }, [lines]);

  const pick = (f?: File) => {
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) return toast('Pilih file .zip', 'bad');
    if (f.size > 95 * 1048576) return toast('Zip terlalu besar (maks ±95 MB)', 'bad');
    sfx('coin');
    setFile(f);
  };

  async function run() {
    if (!file || !pid) return;
    const log = (t: string, c = '') => setLines((l) => [...l, { t, c }]);
    setBusy(true); setLines([]); setProg(0.03);
    try {
      log('Membuka peti zip…');
      const raw = unzipSync(new Uint8Array(await file.arrayBuffer()));
      let files: { path: string; data: Uint8Array; sha?: string }[] = [];
      const skipped: Record<string, number> = {};
      for (const [path, data] of Object.entries(raw)) {
        if (path.endsWith('/')) continue;
        const why = skipReason(path);
        if (why) { skipped[why] = (skipped[why] || 0) + 1; continue; }
        files.push({ path, data });
      }
      while (files.length && files.every((f) => f.path.includes('/') && f.path.split('/')[0] === files[0].path.split('/')[0])) {
        const root = files[0].path.split('/')[0] + '/';
        files = files.map((f) => ({ ...f, path: f.path.slice(root.length) }));
        log(`Folder pembungkus "${root}" dilepas`, 'muted');
      }
      if (!files.length) throw new Error('Zip kosong setelah disaring');
      for (const [why, n] of Object.entries(skipped)) log(`Dilewati ${n} file (${why})`, why === 'file rahasia' ? 'warn' : 'muted');
      if (skipped['file rahasia']) log('File .env/.dev.vars tidak di-push supaya rahasia aman.', 'warn');
      const big = files.find((f) => f.data.length > 50 * 1048576);
      if (big) throw new Error(`${big.path} lebih dari 50 MB — ditolak GitHub`);
      log(`${files.length} file siap.`);
      setProg(0.1);

      log('Menghubungi GitHub…');
      const start = await api('/push/start', { method: 'POST', body: { projectId: pid } });
      if (start.newBranch) log(`Branch "${start.branch}" akan dibuat.`);
      for (const f of files) f.sha = await gitSha(f.data);
      setProg(0.2);

      const existing = start.tree as Record<string, { sha: string; mode: string }>;
      const changed = files.filter((f) => existing[f.path]?.sha !== f.sha);
      const zipPaths = new Set(files.map((f) => f.path));
      const zipHasGithub = files.some((f) => f.path.startsWith('.github/'));
      const kept = Object.entries(existing).filter(([p]) => !zipPaths.has(p) && p.startsWith('.github/') && !zipHasGithub);
      const keptSet = new Set(kept.map(([p]) => p));
      const deleted = mode === 'replace' ? Object.keys(existing).filter((p) => !zipPaths.has(p) && !keptSet.has(p)) : [];
      log(`${changed.length} file berubah, ${deleted.length} file dihapus.`);
      if (!changed.length && !deleted.length) { setProg(1); log('Tidak ada perubahan.', 'ok'); toast('Tidak ada perubahan'); return; }

      const batches: typeof files[] = [];
      let cur: typeof files = [], size = 0;
      for (const f of changed) {
        if (cur.length && (cur.length >= 40 || size + f.data.length > 12 * 1048576)) { batches.push(cur); cur = []; size = 0; }
        cur.push(f); size += f.data.length;
      }
      if (cur.length) batches.push(cur);
      let done = 0;
      for (const b of batches) {
        const res = await api('/push/blobs', { method: 'POST', body: { projectId: pid, files: b.map((f) => ({ path: f.path, b64: toB64(f.data) })) } });
        for (const r of res) { const f = b.find((x) => x.path === r.path)!; f.sha = r.sha; }
        done += b.length;
        log(`Upload ${done}/${changed.length} file`);
        setProg(0.2 + 0.7 * (done / changed.length));
      }
      const entries = mode === 'replace'
        ? [...files.map((f) => ({ path: f.path, sha: f.sha, mode: existing[f.path]?.mode || '100644' })), ...kept.map(([path, e]) => ({ path, sha: e.sha, mode: e.mode }))]
        : changed.map((f) => ({ path: f.path, sha: f.sha, mode: existing[f.path]?.mode || '100644' }));

      log('Membuat commit…');
      const fin = await api('/push/finish', {
        method: 'POST',
        body: { projectId: pid, message: msg.trim() || `Update dari Kantor Bos (${file.name})`, entries, base: mode === 'merge',
          parentSha: start.parentSha, parentTree: start.parentTree, newBranch: start.newBranch, changedCount: changed.length + deleted.length },
      });
      setProg(1);
      if (fin.unchanged) { log('Tidak ada perubahan.', 'ok'); return; }
      setLines((l) => [...l, { t: `Commit ${fin.sha.slice(0, 7)} berhasil — Cloudflare deploy otomatis.`, c: 'ok' }, { t: 'Lihat commit di GitHub ↗', href: fin.url }]);
      toast('+1 XP · Push berhasil! Karyawan mulai kerja.', 'xp');
      window.dispatchEvent(new Event('kb-stats'));
    } catch (e: any) {
      log(`Gagal: ${e.message}`, 'bad');
      toast(e.message, 'bad');
    } finally { setBusy(false); }
  }

  if (err) return <ErrorBox error={err} />;
  if (!projects) return <Loading />;
  if (!projects.length) return (
    <Panel title="UPLOAD ZIP" icon="up">
      <p className="muted">Belum ada proyek. Rekrut karyawan dulu di menu Atur.</p>
      <Link className="gbtn gbtn-gold" href="/atur"><span>+ Rekrut karyawan</span></Link>
    </Panel>
  );

  return (
    <div className="screen">
      <Panel title="UPLOAD ZIP" icon="up">
        <Field label="Proyek">
          <select value={pid} onChange={(e) => setPid(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.worker} · {p.name} — {p.owner}/{p.repo}</option>)}
          </select>
        </Field>
        <label className={`chest ${over ? 'over' : ''} ${file ? 'has' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}>
          <input type="file" accept=".zip,application/zip" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <span className="chest-ico" aria-hidden />
          {file ? <span><b>{file.name}</b><br /><small>{fmtSize(file.size)} · ketuk untuk ganti</small></span> : <span>Ketuk untuk pilih file <b>.zip</b><br /><small>atau seret ke sini</small></span>}
        </label>
        <Field label="Pesan commit"><input value={msg} maxLength={200} placeholder="Update dari Kantor Bos" onChange={(e) => setMsg(e.target.value)} /></Field>
        <div className="mode-pick" role="radiogroup" aria-label="Mode">
          <button type="button" role="radio" aria-checked={mode === 'replace'} className={mode === 'replace' ? 'on' : ''} onClick={() => { sfx('click'); setMode('replace'); }}>
            <b>Ganti semua</b><small>Zip = proyek lengkap. File yang tidak ada di zip dihapus (.github tetap).</small>
          </button>
          <button type="button" role="radio" aria-checked={mode === 'merge'} className={mode === 'merge' ? 'on' : ''} onClick={() => { sfx('click'); setMode('merge'); }}>
            <b>Tambah / timpa</b><small>Hanya file di zip yang diubah, sisanya tetap.</small>
          </button>
        </div>
        <Btn variant="gold" block disabled={!file || busy} onClick={run}>{busy ? 'Mengirim…' : 'PUSH KE GITHUB ▶'}</Btn>
        {(busy || lines.length > 0) && (
          <>
            <div className="hpbar big"><div style={{ width: `${Math.round(prog * 100)}%` }} /></div>
            <div className="console" ref={logRef}>
              {lines.map((l, i) => l.href
                ? <a key={i} href={l.href} target="_blank" rel="noopener">{l.t}</a>
                : <div key={i} className={l.c}>{'> '}{l.t}</div>)}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
