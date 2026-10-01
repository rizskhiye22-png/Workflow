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
  const [picked, setPicked] = useState<File[]>([]);
  const isZip = picked.length === 1 && /\.zip$/i.test(picked[0].name);
  const file = picked.length ? picked[0] : null;
  const totalSize = picked.reduce((n, f) => n + f.size, 0);
  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [over, setOver] = useState(false);
  const [unwrap, setUnwrap] = useState(true);
  const [prefix, setPrefix] = useState('');
  const [review, setReview] = useState<null | { changed: string[]; deleted: string[]; total: number }>(null);
  const decide = useRef<((ok: boolean) => void) | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api('/projects').then((p) => {
      setProjects(p);
      const want = new URLSearchParams(location.search).get('p');
      setPid(p.find((x: any) => x.id === want)?.id || p[0]?.id || '');
    }).catch(setErr);
  }, []);
  useEffect(() => { logRef.current?.scrollTo(0, 1e9); }, [lines]);

  const pick = (list?: FileList | null) => {
    const arr = list ? Array.from(list) : [];
    if (!arr.length) return;
    const zips = arr.filter((f) => /\.zip$/i.test(f.name));
    if (zips.length && arr.length > 1) return toast('Pilih satu .zip saja, atau beberapa file biasa (tanpa zip)', 'bad');
    const size = arr.reduce((n, f) => n + f.size, 0);
    if (size > 95 * 1048576) return toast('Terlalu besar (maks ±95 MB sekali upload). Bagi jadi beberapa kali.', 'bad');
    if (arr.length > 200) return toast('Maks 200 file sekali upload', 'bad');
    sfx('coin');
    setPicked(arr);
    if (!zips.length) { setMode('merge'); setUnwrap(false); }
  };

  async function run() {
    if (!picked.length || !pid) return;
    const log = (t: string, c = '') => setLines((l) => [...l, { t, c }]);
    setBusy(true); setLines([]); setProg(0.03);
    try {
      let raw: Record<string, Uint8Array>;
      if (isZip) {
        log('Membuka peti zip…');
        raw = unzipSync(new Uint8Array(await file.arrayBuffer()));
      } else {
        if (!prefix.trim()) throw new Error('Isi "Folder tujuan di repo" dulu, contoh: public/media/audio/2019-07');
        log(`Membaca ${picked.length} file…`);
        raw = {};
        for (const f of picked) raw[f.name] = new Uint8Array(await f.arrayBuffer());
      }
      let files: { path: string; data: Uint8Array; sha?: string }[] = [];
      const skipped: Record<string, number> = {};
      for (const [path, data] of Object.entries(raw)) {
        if (path.endsWith('/')) continue;
        const why = skipReason(path);
        if (why) { skipped[why] = (skipped[why] || 0) + 1; continue; }
        files.push({ path, data });
      }
      if (unwrap && files.length && files.every((f) => f.path.includes('/') && f.path.split('/')[0] === files[0].path.split('/')[0])) {
        const root = files[0].path.split('/')[0] + '/';
        files = files.map((f) => ({ ...f, path: f.path.slice(root.length) }));
        log(`Folder pembungkus "${root}" dilepas`, 'muted');
      }
      const pre = prefix.trim().replace(/^\/+|\/+$/g, '');
      if (pre) {
        if (pre.split('/').some((x) => !x || x === '.' || x === '..')) throw new Error('Folder tujuan tidak valid');
        files = files.map((f) => ({ ...f, path: `${pre}/${f.path}` }));
        log(`File ditaruh di folder "${pre}/"`, 'muted');
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
      const ok = await new Promise<boolean>((resolve) => {
        decide.current = resolve;
        setReview({ changed: changed.map((f) => f.path), deleted, total: Object.keys(existing).length });
      });
      setReview(null);
      if (!ok) { log('Dibatalkan. Repo tidak diubah.', 'warn'); setProg(0); return; }

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
        body: { projectId: pid, message: msg.trim() || `Update dari Kantor Bos (${isZip ? file!.name : `${picked.length} file → ${prefix.trim()}`})`, entries, base: mode === 'merge',
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
    <Panel title="UPLOAD" icon="up">
      <p className="muted">Belum ada proyek. Rekrut karyawan dulu di menu Atur.</p>
      <Link className="gbtn gbtn-gold" href="/atur"><span>+ Rekrut karyawan</span></Link>
    </Panel>
  );

  return (
    <div className="screen">
      <Panel title="UPLOAD" icon="up">
        <Field label="Proyek">
          <select value={pid} onChange={(e) => setPid(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.worker} · {p.name} — {p.owner}/{p.repo}</option>)}
          </select>
        </Field>
        <label className={`chest ${over ? 'over' : ''} ${file ? 'has' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}>
          <input type="file" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
          <span className="chest-ico" aria-hidden />
          {picked.length ? (
            <span><b>{isZip ? file!.name : `${picked.length} file (${picked.slice(0, 3).map((f) => f.name).join(', ')}${picked.length > 3 ? '…' : ''})`}</b><br /><small>{fmtSize(totalSize)} · ketuk untuk ganti</small></span>
          ) : <span>Ketuk untuk pilih <b>.zip</b> atau file biasa<br /><small>mp3, gambar, html… bisa beberapa sekaligus</small></span>}
        </label>
        <Field label="Folder tujuan di repo" hint="(kosongkan = root repo)">
          <input value={prefix} placeholder={isZip || !picked.length ? 'contoh: public' : 'contoh: public/media/audio/2019-07'} onChange={(e) => setPrefix(e.target.value)} />
        </Field>
        {!isZip && picked.length > 0 && <p className="muted small">File biasa (bukan zip) wajib diberi folder tujuan. Mode otomatis <b>Tambah / timpa</b>.</p>}
        <label className="toggle">
          <input type="checkbox" checked={unwrap} onChange={(e) => setUnwrap(e.target.checked)} />
          <span className="tg" aria-hidden />
          <span>Lepas 1 folder pembungkus <small className="muted">(mis. zip berisi n1-cf/… → isinya saja)</small></span>
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
        <Btn variant="gold" block disabled={!picked.length || busy} onClick={run}>{busy ? 'Mengirim…' : 'PUSH KE GITHUB ▶'}</Btn>
        {review && (
          <div className={`review ${review.deleted.length ? 'danger' : ''}`}>
            <p className="review-title">PERIKSA SEBELUM PUSH</p>
            <p><b>{review.changed.length}</b> file ditambah/diubah{review.deleted.length ? <> · <b className="bad">{review.deleted.length}</b> file DIHAPUS dari repo</> : ''}</p>
            <ul className="review-list">
              {review.changed.slice(0, 8).map((x) => <li key={'c' + x}>＋ {x}</li>)}
              {review.changed.length > 8 && <li className="muted">…dan {review.changed.length - 8} lainnya</li>}
              {review.deleted.slice(0, 6).map((x) => <li key={'d' + x} className="bad">－ {x}</li>)}
              {review.deleted.length > 6 && <li className="bad">…dan {review.deleted.length - 6} lainnya dihapus</li>}
            </ul>
            {review.deleted.length > 0 && review.deleted.length >= review.total / 3 && (
              <p className="bad small">⚠ Lebih dari sepertiga isi repo akan dihapus. Kalau zip ini cuma patch beberapa file, batalkan lalu pilih mode <b>Tambah / timpa</b>.</p>
            )}
            <div className="btn-row">
              <Btn variant={review.deleted.length ? 'red' : 'gold'} onClick={() => decide.current?.(true)}>Lanjutkan push</Btn>
              <Btn variant="ghost" onClick={() => decide.current?.(false)}>Batal</Btn>
            </div>
          </div>
        )}
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
