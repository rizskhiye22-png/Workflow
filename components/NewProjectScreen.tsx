'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, toast, sfx } from '@/lib/client';
import { readFiles, pushFiles, detectProject, slugify, fmtSize, type PFile, type Detected } from '@/lib/pushflow';
import { Btn, Field, Loading, Panel, ErrorBox } from './ui';

const NAMES = ['Budi', 'Sari', 'Joko', 'Rina', 'Dewi', 'Agus', 'Mega', 'Tono', 'Lina', 'Andi', 'Putri', 'Rudi', 'Yanti', 'Eko', 'Fitri', 'Hendra', 'Kiki', 'Nina'];
type Line = { t: string; c?: string; href?: string };

export default function NewProjectScreen() {
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [files, setFiles] = useState<PFile[] | null>(null);
  const [det, setDet] = useState<Detected | null>(null);
  const [f, setF] = useState<any>({});
  const [phase, setPhase] = useState<'pick' | 'form' | 'run' | 'done'>('pick');
  const [lines, setLines] = useState<Line[]>([]);
  const [prog, setProg] = useState(0);
  const [confirmWarn, setConfirmWarn] = useState<string[] | null>(null);
  const [result, setResult] = useState<any>(null);
  const [over, setOver] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const [nameCheck, setNameCheck] = useState<any>(null);
  useEffect(() => {
    if (phase !== 'form' || !f.workerName) return;
    setNameCheck({ loading: true });
    const t = setTimeout(() => {
      api(`/newproject/check?target=${f.target}&name=${encodeURIComponent(f.workerName)}`).then(setNameCheck).catch(() => setNameCheck(null));
    }, 500);
    return () => clearTimeout(t);
  }, [f.workerName, f.target, phase]);

  useEffect(() => { api('/newproject/info').then(setInfo).catch(setErr); }, []);
  useEffect(() => { logRef.current?.scrollTo(0, 1e9); }, [lines]);
  const log = (t: string, c = '') => setLines((l) => [...l, { t, c }]);

  const pick = async (list?: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) return toast('Pilih file .zip berisi proyekmu', 'bad');
    if (file.size > 95 * 1048576) return toast('Zip terlalu besar (maks ±95 MB). Upload sisanya nanti lewat menu Upload.', 'bad');
    sfx('coin');
    setZip(file); setLines([]);
    try {
      const fl = await readFiles([file], { unwrap: true, prefix: '' }, () => {});
      const d = detectProject(fl);
      const base = slugify(file.name.replace(/\.zip$/i, '').replace(/[-_ ]?(cloudflare|cf|main|master|project|proyek)$/i, ''));
      setFiles(fl); setDet(d);
      setF({
        name: file.name.replace(/\.zip$/i, ''), worker: NAMES[Math.floor(Math.random() * NAMES.length)],
        repo: base, private: true, workerName: d.workerName || base, target: 'worker',
        kind: d.kind === 'unknown' ? 'static' : d.kind, outDir: d.outDir, spa: d.spa, buildCmd: d.buildCmd || 'npm run build',
      });
      setPhase('form');
    } catch (e: any) { toast(e.message, 'bad'); }
  };

  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function create(overwrite = false) {
    if (!files || !det) return;
    setConfirmWarn(null);
    setPhase('run'); setProg(0.05);
    if (!overwrite) setLines([]);
    try {
      log(overwrite ? 'Lanjut (menimpa sudah disetujui)…' : 'Menyiapkan repo GitHub & Cloudflare…');
      const r = await api('/newproject', {
        method: 'POST',
        body: {
          name: f.name, worker: f.worker, repo: f.repo, private: f.private, workerName: f.workerName, kind: f.kind, target: f.target,
          hasPackage: det.hasPackage, hasLock: det.hasLock, buildCmd: f.kind === 'build' ? f.buildCmd : '', deployScript: det.deployScript,
          outDir: f.outDir, spa: f.spa, hasOwnWorkflow: det.hasOwnWorkflow, hasGitignore: det.hasGitignore, overwrite,
        },
      });
      if (r.needConfirm) { setConfirmWarn(r.warnings); setPhase('form'); return; }
      for (const s of r.steps) log(`✓ ${s}`, s.startsWith('⚠') ? 'warn' : 'ok');
      setProg(0.15);
      const extra: PFile[] = r.files.map((x: any) => ({ path: x.path, data: new TextEncoder().encode(x.content) }));
      for (const x of extra) log(`+ ${x.path} (dibuat Kantor Bos)`, 'muted');
      const all = [...files.filter((x) => !extra.some((e) => e.path === x.path)), ...extra];
      const fin: any = await pushFiles(r.project.id, all, {
        mode: 'replace', message: `Proyek baru dari Kantor Bos (${zip?.name})`, log,
        progress: (p) => setProg(0.15 + p * 0.85), confirm: async () => true,
      });
      if (fin.sha) log(`Commit ${fin.sha.slice(0, 7)} terkirim.`, 'ok');
      log(r.secrets ? 'GitHub Actions sedang build & deploy ke Cloudflare (±1–3 menit).' : 'Isi secret repo dulu supaya deploy bisa jalan (lihat petunjuk di bawah).', r.secrets ? 'ok' : 'warn');
      setResult({ ...r, commitUrl: fin.url });
      setPhase('done');
      toast(`🎉 ${r.project.worker} bergabung! Proyek sedang di-deploy.`, 'xp');
    } catch (e: any) {
      log(`Gagal: ${e.message}`, 'bad');
      toast(e.message, 'bad');
      setPhase('form');
    }
  }

  if (err) return <ErrorBox error={err} />;
  if (!info) return <Loading />;

  return (
    <div className="screen">
      <Panel title="PROYEK BARU" icon="up">
        <p className="muted">Satu zip → repo GitHub baru → otomatis online di Cloudflare. Selanjutnya cukup update lewat menu Upload.</p>
        {!info.deployTokenReady && (
          <div className="review danger">
            <p className="review-title">KUNCI DEPLOY BELUM ADA</p>
            <p className="small">Supaya repo baru bisa langsung deploy, isi secret <b>CF_DEPLOY_TOKEN</b> di Worker Kantor Bos (Cloudflare → workflow → Settings → Variables and Secrets). Isinya token Cloudflare template <b>Edit Cloudflare Workers</b> + izin <b>D1: Edit</b>, <b>Workers KV Storage: Edit</b> & <b>Cloudflare Pages: Edit</b>. Tanpa ini proyek tetap dibuat, tapi secret repo harus diisi manual.</p>
          </div>
        )}
        <label className={`chest ${over ? 'over' : ''} ${zip ? 'has' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}>
          <input type="file" accept=".zip,application/zip" hidden disabled={phase === 'run'} onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
          <span className="chest-ico" aria-hidden />
          {zip ? <span><b>{zip.name}</b><br /><small>{fmtSize(zip.size)} · {files?.length} file · ketuk untuk ganti</small></span>
            : <span>Ketuk untuk pilih <b>.zip</b> proyek<br /><small>HTML statis, Vite/React, atau Worker dengan wrangler</small></span>}
        </label>
      </Panel>

      {det && phase !== 'done' && (
        <Panel title="HASIL PEMERIKSAAN" icon="log">
          <p><span className="pill st-building">{det.label}</span></p>
          {det.warnings.map((w, i) => <p key={i} className="warnline">⚠ {w}</p>)}
          <div className="grid2">
            <Field label="Nama proyek"><input value={f.name} maxLength={40} onChange={set('name')} /></Field>
            <Field label="Nama karyawan"><input value={f.worker} maxLength={20} onChange={set('worker')} /></Field>
          </div>
          <Field label={`Repo GitHub baru${info.githubUser ? ` (${info.githubUser}/…)` : ''}`}>
            <input value={f.repo} onChange={(e) => setF((x: any) => ({ ...x, repo: e.target.value.replace(/[^A-Za-z0-9_.-]/g, '-') }))} />
          </Field>
          <label className="toggle"><input type="checkbox" checked={f.private} onChange={set('private')} /><span className="tg" aria-hidden /><span>Repo private <small className="muted">(disarankan)</small></span></label>
          <Field label="Deploy ke Cloudflare sebagai">
            <div className="seg" role="radiogroup">
              <button type="button" role="radio" aria-checked={f.target === 'worker'} className={f.target === 'worker' ? 'on' : ''} onClick={() => { sfx('tab'); setF((x: any) => ({ ...x, target: 'worker' })); }}>⟨⟩ WORKER</button>
              <button type="button" role="radio" aria-checked={f.target === 'pages'} className={f.target === 'pages' ? 'on' : ''} disabled={det.kind === 'wrangler'}
                onClick={() => { sfx('tab'); setF((x: any) => ({ ...x, target: 'pages' })); }}>⚡ PAGES</button>
            </div>
          </Field>
          <p className="muted small">{f.target === 'pages'
            ? 'Pages: khusus situs (HTML/CSS/JS atau hasil build). Alamat *.pages.dev.'
            : det.kind === 'wrangler' ? 'Proyek ini punya kode Worker (wrangler), jadi dideploy sebagai Worker.' : 'Worker: situs + bisa ditambah API/KV/D1 nanti. Alamat *.workers.dev.'}</p>
          <Field label={f.target === 'pages' ? 'Nama proyek Pages' : 'Nama Worker'} hint="(huruf kecil, angka, -)">
            <input value={f.workerName} disabled={det.kind === 'wrangler' && !!det.workerName}
              onChange={(e) => setF((x: any) => ({ ...x, workerName: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63) }))} />
          </Field>
          {nameCheck && (
            <p className={`namecheck ${nameCheck.loading ? '' : nameCheck.valid === false ? 'bad' : nameCheck.exists ? 'warn' : nameCheck.exists === false ? 'ok' : ''}`}>
              {nameCheck.loading ? '… mengecek nama di Cloudflare'
                : nameCheck.valid === false ? '✗ Nama tidak valid (huruf kecil, angka, tanda -, tidak diawali/diakhiri -)'
                : nameCheck.exists ? `⚠ "${f.workerName}" SUDAH ADA di Cloudflare — situs lama akan ditimpa. Ganti nama kalau mau proyek baru.`
                : nameCheck.exists === false ? `✓ Nama tersedia — ${f.target === 'pages' ? 'proyek Pages' : 'Worker'} baru akan dibuat`
                : 'Nama tidak bisa dicek (token deploy belum ada). Tetap bisa dilanjutkan.'}
              {nameCheck.url && !nameCheck.loading && <><br /><small>Alamat: <b>{nameCheck.url}</b></small></>}
            </p>
          )}
          {det.kind !== 'wrangler' && (
            <>
              <Field label="Jenis">
                <select value={f.kind} onChange={set('kind')}>
                  <option value="static">Situs statis — langsung tayang</option>
                  <option value="build">Perlu build (npm run build)</option>
                </select>
              </Field>
              <div className="grid2">
                <Field label={f.kind === 'build' ? 'Folder hasil build' : 'Folder situs'}><input value={f.outDir} onChange={set('outDir')} placeholder="." /></Field>
                {f.kind === 'build' && <Field label="Perintah build"><input value={f.buildCmd} onChange={set('buildCmd')} /></Field>}
              </div>
              {f.target === 'worker' && <label className="toggle"><input type="checkbox" checked={f.spa} onChange={set('spa')} /><span className="tg" aria-hidden /><span>Single-page app <small className="muted">(React/Vue router: semua alamat → index.html)</small></span></label>}
            </>
          )}

          {confirmWarn && (
            <div className="review danger">
              <p className="review-title">PERHATIAN</p>
              {confirmWarn.map((w, i) => <p key={i}>{w}</p>)}
              <div className="btn-row">
                <Btn variant="red" onClick={() => create(true)}>Ya, timpa & lanjutkan</Btn>
                <Btn variant="ghost" onClick={() => setConfirmWarn(null)}>Batal</Btn>
              </div>
            </div>
          )}
          {!confirmWarn && <Btn variant="gold" block disabled={phase === 'run' || !f.repo || !f.workerName} onClick={() => create(false)}>{phase === 'run' ? 'Sedang bekerja…' : '🚀 BUAT & DEPLOY'}</Btn>}
        </Panel>
      )}

      {lines.length > 0 && (
        <Panel title="PROSES" icon="log">
          <div className="hpbar big"><div style={{ width: `${Math.round(prog * 100)}%` }} /></div>
          <div className="console" ref={logRef}>
            {lines.map((l, i) => <div key={i} className={l.c}>{'> '}{l.t}</div>)}
          </div>
        </Panel>
      )}

      {phase === 'done' && result && (
        <Panel title="SELESAI!" icon="office">
          <p className="big">🎉 {result.project.worker} mulai bekerja di {result.project.name}</p>
          <div className="btn-row">
            <a className="gbtn gbtn-gold" href={result.actionsUrl} target="_blank" rel="noopener"><span>Lihat proses deploy</span></a>
            {result.project.siteUrl && <a className="gbtn gbtn-green" href={result.project.siteUrl} target="_blank" rel="noopener"><span>Buka situs</span></a>}
            <a className="gbtn gbtn-ghost" href={result.repoUrl} target="_blank" rel="noopener"><span>Repo GitHub</span></a>
            <Link className="gbtn gbtn-blue" href="/"><span>Ke kantor</span></Link>
          </div>
          {!result.secrets && (
            <p className="warnline">⚠ Secret repo belum terpasang. Setelah mengisi CF_DEPLOY_TOKEN di Kantor Bos, buka Atur → {result.project.worker} → <b>Pasang deploy otomatis</b>, lalu jalankan ulang di tab Actions.</p>
          )}
          <p className="muted small">Situs biasanya online 1–3 menit setelah deploy selesai. Status deploy tampil di karyawan {result.project.worker}.</p>
          <Btn variant="ghost" block onClick={() => { setPhase('pick'); setZip(null); setFiles(null); setDet(null); setLines([]); setResult(null); }}>Buat proyek lain</Btn>
        </Panel>
      )}
    </div>
  );
}
