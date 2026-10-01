'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { readFiles, pushFiles, fmtSize } from '@/lib/pushflow';
import { api, toast, sfx } from '@/lib/client';
import { Btn, Field, Loading, Panel, ErrorBox } from './ui';

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
      const files = await readFiles(picked, { unwrap, prefix }, log);
      setProg(0.1);
      const fin: any = await pushFiles(pid, files, {
        mode,
        message: msg.trim() || `Update dari Kantor Bos (${isZip ? file!.name : `${picked.length} file → ${prefix.trim()}`})`,
        log, progress: setProg,
        confirm: (r) => new Promise<boolean>((resolve) => {
          decide.current = (ok) => { setReview(null); resolve(ok); };
          setReview(r);
        }),
      });
      if (fin.unchanged) { toast('Tidak ada perubahan'); return; }
      if (fin.cancelled) return;
      setLines((l) => [...l, { t: `Commit ${fin.sha.slice(0, 7)} berhasil — deploy otomatis berjalan.`, c: 'ok' }, { t: 'Lihat commit di GitHub ↗', href: fin.url }]);
      toast('+1 XP · Push berhasil! Karyawan mulai kerja.', 'xp');
    } catch (e: any) {
      log(`Gagal: ${e.message}`, 'bad');
      toast(e.message, 'bad');
    } finally { setBusy(false); }
  }

  if (err) return <ErrorBox error={err} />;
  if (!projects) return <Loading />;
  if (!projects.length) return (
    <Panel title="UPLOAD" icon="up">
      <p className="muted">Belum ada proyek. Buat proyek baru dari zip, atau rekrut karyawan untuk repo yang sudah ada.</p>
      <Link className="gbtn gbtn-gold" href="/baru"><span>🚀 Proyek baru</span></Link>
      <Link className="gbtn gbtn-ghost" href="/atur"><span>+ Repo yang sudah ada</span></Link>
    </Panel>
  );

  return (
    <div className="screen">
      <Link href="/baru" className="quest-banner">
        <span className="qb-tag">BARU</span>
        <span className="qb-text"><b>🚀 Proyek baru</b> · buat repo GitHub + deploy ke Cloudflare dari satu zip</span>
      </Link>
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
