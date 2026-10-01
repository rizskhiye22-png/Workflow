'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { OfficeEngine } from '@/lib/office/engine.js';
import { api, timeAgo, timeline, fmtDur, HARI, sfx } from '@/lib/client';
import { Btn, ErrorBox, Pill, Sheet } from './ui';

function demoWorkers() {
  const now = Date.now();
  return [
    { id: 'toko-online', name: 'Toko Online', worker: 'Budi', status: 'building', lastTime: now - 60e3, message: 'Tambah keranjang', siteUrl: 'https://example.com' },
    { id: 'portfolio', name: 'Portfolio', worker: 'Sari', status: 'success', lastTime: now - 3600e3, message: 'Update foto' },
    { id: 'api-absen', name: 'API Absen', worker: 'Joko', status: 'failed', lastTime: now - 7200e3, message: 'Fix login' },
    { id: 'blog', name: 'Blog', worker: 'Rina', status: 'sleep', lastTime: now - 5 * 86400e3, message: 'Post baru' },
    { id: 'kalkulator', name: 'Kalkulator', worker: 'Dewi', status: 'idle' },
    { id: 'landing', name: 'Landing Page', worker: 'Agus', status: 'success', lastTime: now - 7200e3 },
    { id: 'kasir', name: 'Kasir', worker: 'Mega', status: 'success', lastTime: now - 9600e3 },
  ];
}

type Log = { id: number; text: string; t: number };

export default function OfficeScreen() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<any>(null);
  const [workers, setWorkers] = useState<any[] | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const [picked, setPicked] = useState<any>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [next, setNext] = useState<any>(null);

  useEffect(() => {
    const demo = new URLSearchParams(location.search).has('demo');
    const eng = new OfficeEngine(canvas.current!, {
      onPick: (data: any, activity: string | null) => { sfx('open'); setPicked({ ...data, activity }); },
      onEvent: (text: string) => setLogs((l) => [{ id: Math.random(), text, t: Date.now() }, ...l].slice(0, 6)),
    });
    engine.current = eng;
    const ro = new ResizeObserver(() => eng.resize(wrap.current!.clientWidth, window.devicePixelRatio || 1));
    ro.observe(wrap.current!);

    const load = async () => {
      try {
        const d = demo ? { workers: demoWorkers(), stats: { level: 3 } } : await api('/office');
        setWorkers(d.workers); setStats(d.stats); setErr(null);
        eng.setLevel(d.stats?.level || 1);
        eng.setWorkers(d.workers);
      } catch (e) { setErr(e); setWorkers((w) => w || []); }
    };
    load();
    const iv = setInterval(() => document.visibilityState === 'visible' && load(), 60_000);

    const loadNext = () => api('/schedule').then((list) => {
      const tl = timeline(list);
      const now = tl.find((c) => c.ongoing);
      setNext(now ? { ...now, live: true } : [...tl].sort((a, b) => a.until - b.until)[0] || null);
    }).catch(() => {});
    if (!demo) loadNext();
    const iv2 = setInterval(loadNext, 60_000);
    return () => { eng.destroy(); ro.disconnect(); clearInterval(iv); clearInterval(iv2); };
  }, []);

  const count = (s: string) => (workers || []).filter((w) => w.status === s).length;

  return (
    <div className="office-screen">
      {next && (
        <Link href="/jadwal" className={`quest-banner ${next.live ? 'live' : ''}`}>
          <span className="qb-tag">{next.live ? '● KULIAH' : 'BERIKUTNYA'}</span>
          <span className="qb-text"><b>{next.name}</b> · {next.live ? `sisa ${fmtDur(next.left)}` : `${HARI[next.day]} ${next.start} · ${fmtDur(next.until)} lagi`}</span>
        </Link>
      )}

      <div className="chips-row">
        <span className="stat"><i className="sd" />{workers?.length ?? 0} karyawan</span>
        <span className="stat ok"><i className="sd" />{count('success')} sukses</span>
        <span className="stat run"><i className="sd" />{count('building')} kerja</span>
        <span className="stat bad"><i className="sd" />{count('failed')} gagal</span>
        <span className="stat zzz"><i className="sd" />{count('sleep')} tidur</span>
      </div>

      <div className="office-frame">
        <div className="office-canvas" ref={wrap}>
          <canvas ref={canvas} aria-label="Kantor pixel: ketuk karyawan untuk melihat proyeknya" />
        </div>
        {workers && !workers.length && !err && (
          <div className="office-empty">
            <p>Kantor masih sepi, Bos. Rekrut karyawan pertama!</p>
            <Link className="gbtn gbtn-gold" href="/atur"><span>+ Rekrut karyawan</span></Link>
          </div>
        )}
      </div>
      <ErrorBox error={err} />

      <section className="feed" aria-label="Kabar kantor">
        <h3 className="feed-title">KABAR KANTOR</h3>
        {logs.length ? (
          <ul>{logs.map((l) => <li key={l.id}><span className="feed-time">{new Date(l.t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>{l.text}</li>)}</ul>
        ) : <p className="muted">Karyawan sedang fokus kerja…</p>}
      </section>

      <Sheet open={!!picked} onClose={() => setPicked(null)} title={picked?.boss ? 'KARTU BOS' : `KARYAWAN · ${picked?.worker || ''}`}>
        {picked?.boss ? (
          <div className="boss-card">
            <img src="/icons/icon-512.png" alt="" width={72} height={72} className="pix" />
            <div>
              <p className="big">Bos Besar</p>
              <p className="muted">Level {stats?.level ?? 1} · {stats?.pushes ?? 0} push · {workers?.length ?? 0} karyawan</p>
              <p className="muted small">Bos suka keliling: memuji yang sukses, menegur yang gagal, membangunkan yang tidur.</p>
            </div>
          </div>
        ) : picked && (
          <>
            <p className="big">{picked.name}</p>
            <p><Pill status={picked.status} />{picked.activity && <span className="pill">🚶 {picked.activity}</span>}</p>
            {picked.message && <p className="muted">Terakhir: “{picked.message}” · {timeAgo(picked.lastTime)}{picked.source ? ` · ${picked.source}` : ''}</p>}
            {picked.detail && <ErrorBox error={picked.detail} />}
            <div className="btn-row">
              <Link className="gbtn gbtn-gold" href={`/upload?p=${encodeURIComponent(picked.id)}`}><span>Upload zip</span></Link>
              <Link className="gbtn gbtn-blue" href={`/riwayat?p=${encodeURIComponent(picked.id)}`}><span>Riwayat</span></Link>
              {picked.siteUrl && <a className="gbtn gbtn-green" href={picked.siteUrl} target="_blank" rel="noopener"><span>Buka situs</span></a>}
              {picked.repoUrl && <a className="gbtn gbtn-ghost" href={picked.repoUrl} target="_blank" rel="noopener"><span>GitHub</span></a>}
            </div>
          </>
        )}
        <Btn variant="ghost" block onClick={() => setPicked(null)}>Tutup</Btn>
      </Sheet>
    </div>
  );
}
