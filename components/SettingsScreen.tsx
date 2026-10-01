'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, toast, pushSupported, currentPushSub, enablePush, disablePush } from '@/lib/client';
import { Btn, ErrorBox, Field, Loading, Panel, Sheet } from './ui';

function parseRepo(s: string) {
  s = s.trim();
  let m = s.match(/github\.com[/:]([^/]+)\/([^/#?\s]+?)(?:\.git)?\/?$/i);
  if (!m) m = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export default function SettingsScreen() {
  const [me, setMe] = useState<any>(null);
  const [projects, setProjects] = useState<any[] | null>(null);
  const [err, setErr] = useState<any>(null);
  const [check, setCheck] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [edit, setEdit] = useState<any>(null);

  const load = useCallback(() => {
    Promise.all([api('/me'), api('/projects')]).then(([m, p]) => { setMe(m); setProjects(p); }).catch(setErr);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err) return <ErrorBox error={err} />;
  if (!me || !projects) return <Loading />;

  const Ok = ({ v }: { v: boolean }) => <span className={`pill ${v ? 'st-success' : 'st-failed'}`}>{v ? 'TERPASANG' : 'BELUM'}</span>;

  return (
    <div className="screen">
      <Panel title="KARYAWAN" icon="people" right={<Btn variant="green" onClick={() => setEdit({})}>+ Rekrut</Btn>}>
        <Link href="/baru" className="gbtn gbtn-gold block"><span>🚀 Proyek baru dari zip</span></Link>
        <p className="muted small">"+ Rekrut" untuk repo GitHub yang sudah ada.</p>
        <ul className="roster">
          {projects.map((p) => (
            <li key={p.id}>
              <div><b>{p.worker}</b> · {p.name}<small>{p.owner}/{p.repo} · {p.branch}{p.pagesProject ? ` · Pages: ${p.pagesProject}` : ''}{p.workerName ? ` · Worker: ${p.workerName}` : ''}</small></div>
              <Btn variant="ghost" onClick={() => setEdit(p)}>Ubah</Btn>
            </li>
          ))}
          {!projects.length && <li className="muted pad">Belum ada karyawan. Rekrut satu untuk setiap repo proyekmu.</li>}
        </ul>
      </Panel>

      <NotifyPanel />

      <Panel title="KONEKSI" icon="plug">
        <ul className="roster plain">
          <li><span>Token GitHub</span><Ok v={me.config.github} /></li>
          <li><span>Token Cloudflare + Account ID</span><Ok v={me.config.cloudflare} /></li>
          <li><span>Kunci deploy (CF_DEPLOY_TOKEN)</span><Ok v={me.config.deploy} /></li>
        </ul>
        <Btn block disabled={checking} onClick={async () => {
          setChecking(true);
          try { setCheck(await api('/check', { method: 'POST', body: {} })); } catch (e) { setCheck({ error: e }); } finally { setChecking(false); }
        }}>{checking ? 'Mengecek…' : 'Cek koneksi'}</Btn>
        {check?.error && <ErrorBox error={check.error} />}
        {check && !check.error && (
          <ul className="roster plain">
            {[['GitHub', check.github], ['KV', check.kv], ['D1', check.d1]].map(([n, x]: any) => <li key={n}><span><b>{n}</b> {x.ok ? '✅' : '❌'} {x.detail}</span></li>)}
          </ul>
        )}
      </Panel>

      <Panel title="AKUN" icon="gear">
        <Btn variant="red" block onClick={async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; }}>Keluar kantor</Btn>
      </Panel>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'UBAH KARYAWAN' : 'REKRUT KARYAWAN'}>
        {edit && <ProjectForm p={edit} onDone={() => { setEdit(null); load(); }} onCancel={() => setEdit(null)} />}
      </Sheet>
    </div>
  );
}

function ProjectForm({ p, onDone, onCancel }: { p: any; onDone: () => void; onCancel: () => void }) {
  const [v, setV] = useState({
    name: p.name || '', worker: p.worker || '', repo: p.owner ? `${p.owner}/${p.repo}` : '',
    branch: p.branch || 'main', siteUrl: p.siteUrl || '',
    kind: p.workerName ? 'worker' : p.pagesProject ? 'pages' : 'none',
    cfName: p.workerName || p.pagesProject || '',
  });
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  const save = async (e: any) => {
    e.preventDefault();
    const r = parseRepo(v.repo);
    if (!r) return toast('Format repo: username/nama-repo', 'bad');
    try {
      await api('/projects', { method: 'POST', body: { id: p.id, name: v.name, worker: v.worker, ...r, branch: v.branch || 'main', siteUrl: v.siteUrl,
        pagesProject: v.kind === 'pages' ? v.cfName.trim() : '', workerName: v.kind === 'worker' ? v.cfName.trim() : '' } });
      toast(p.id ? 'Tersimpan' : 'Karyawan baru masuk kantor!', 'ok');
      onDone();
    } catch (er: any) { toast(er.message, 'bad'); }
  };
  const del = async () => {
    if (!confirm(`Pecat ${p.worker}? (Repo GitHub tidak ikut terhapus)`)) return;
    try { await api(`/projects/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); toast('Karyawan dipecat', 'ok'); onDone(); }
    catch (er: any) { toast(er.message, 'bad'); }
  };
  return (
    <form onSubmit={save}>
      <Field label="Nama proyek"><input required maxLength={40} value={v.name} placeholder="Toko Online" onChange={set('name')} /></Field>
      <Field label="Nama karyawan pixel"><input maxLength={20} value={v.worker} placeholder="Budi" onChange={set('worker')} /></Field>
      <Field label="Repo GitHub"><input required value={v.repo} placeholder="username/nama-repo atau URL" onChange={set('repo')} /></Field>
      <Field label="Branch"><input value={v.branch} onChange={set('branch')} /></Field>
      <Field label="Dideploy ke Cloudflare sebagai" hint="(untuk status deploy)">
        <select value={v.kind} onChange={set('kind')}>
          <option value="worker">Worker (ikon ⟨⟩ di Cloudflare)</option>
          <option value="pages">Pages (ikon ⚡ di Cloudflare)</option>
          <option value="none">Tidak dipantau</option>
        </select>
      </Field>
      {v.kind !== 'none' && (
        <Field label={v.kind === 'worker' ? 'Nama Worker' : 'Nama proyek Pages'} hint="(persis seperti di Cloudflare)">
          <input value={v.cfName} placeholder={v.kind === 'worker' ? 'jlpt-n1' : 'toko-online'} onChange={set('cfName')} />
        </Field>
      )}
      <Field label="URL situs" hint="(opsional)"><input value={v.siteUrl} placeholder="https://…" onChange={set('siteUrl')} /></Field>
      {p.id && (
        <div className="review">
          <p className="review-title">DEPLOY OTOMATIS</p>
          <p className="small">Pasang kunci Cloudflare (CLOUDFLARE_API_TOKEN &amp; CLOUDFLARE_ACCOUNT_ID) ke secret repo <b>{p.owner}/{p.repo}</b>, supaya workflow GitHub Actions di repo itu bisa deploy.</p>
          <Btn variant="green" type="button" onClick={async () => {
            try { const r = await api(`/projects/${encodeURIComponent(p.id)}/secrets`, { method: 'POST', body: {} }); toast('Kunci deploy terpasang! Jalankan ulang workflow di tab Actions.', 'ok'); window.open(r.actionsUrl, '_blank'); }
            catch (er: any) { toast(er.message, 'bad'); }
          }}>🔑 Pasang deploy otomatis</Btn>
        </div>
      )}
      <div className="btn-row">
        <Btn variant="gold" type="submit">Simpan</Btn>
        {p.id && <Btn variant="red" type="button" onClick={del}>Pecat</Btn>}
        <Btn variant="ghost" type="button" onClick={onCancel}>Batal</Btn>
      </div>
    </form>
  );
}

function NotifyPanel() {
  const [state, setState] = useState<'?' | 'on' | 'off' | 'na'>('?');
  const [cfg, setCfg] = useState<any>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setCfg(await api('/notify').catch(() => null));
    setDevices(await api('/push/devices').catch(() => []));
    if (!pushSupported()) return setState('na');
    const s = await currentPushSub();
    setState(s && Notification.permission === 'granted' ? 'on' : 'off');
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const save = async (patch: any) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    try { setCfg(await api('/notify', { method: 'PUT', body: next })); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const run = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true);
    try { await fn(); toast(msg, 'ok'); await refresh(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Panel title="NOTIFIKASI" icon="bell">
      {state === 'na' && <p className="muted">Browser ini tidak mendukung notifikasi push. Di iPhone: Bagikan → <b>Tambahkan ke Layar Utama</b>, lalu buka dari ikon itu.</p>}
      {state === 'off' && (
        <>
          <p className="muted">Pengingat kuliah, tenggat tugas, laporan pagi, dan kabar deploy dikirim ke HP walau aplikasi tertutup.</p>
          <Btn variant="green" block disabled={busy} onClick={() => run(enablePush, 'Notifikasi aktif di perangkat ini 🔔')}>🔔 Aktifkan di perangkat ini</Btn>
        </>
      )}
      {state === 'on' && (
        <>
          <p>🔔 Aktif di perangkat ini.</p>
          <div className="btn-row">
            <Btn variant="gold" disabled={busy} onClick={() => run(() => api('/push/test', { method: 'POST', body: {} }), 'Notifikasi tes dikirim')}>Kirim tes</Btn>
            <Btn variant="ghost" disabled={busy} onClick={() => run(disablePush, 'Notifikasi dimatikan di perangkat ini')}>Matikan</Btn>
          </div>
        </>
      )}
      {cfg && (
        <div className="notify-cfg">
          <Field label="Ingatkan kuliah">
            <select value={cfg.classLead} onChange={(e) => save({ classLead: Number(e.target.value) })}>
              {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} menit sebelum mulai</option>)}
            </select>
          </Field>
          <Field label="Ingatkan tenggat tugas">
            <select value={cfg.taskLead} onChange={(e) => save({ taskLead: Number(e.target.value) })}>
              {[[30, '30 menit'], [60, '1 jam'], [180, '3 jam'], [720, '12 jam'], [1440, '1 hari']].map(([m, l]) => <option key={m} value={m}>{l} sebelum tenggat</option>)}
            </select>
          </Field>
          <label className="toggle"><input type="checkbox" checked={cfg.morning} onChange={(e) => save({ morning: e.target.checked })} /><span className="tg" aria-hidden /><span>Laporan pagi dari Bos</span></label>
          {cfg.morning && <Field label="Jam laporan pagi (JST)"><input type="time" value={cfg.morningTime} onChange={(e) => save({ morningTime: e.target.value })} /></Field>}
          <label className="toggle"><input type="checkbox" checked={cfg.deploy} onChange={(e) => save({ deploy: e.target.checked })} /><span className="tg" aria-hidden /><span>Kabar deploy sukses / gagal</span></label>
        </div>
      )}
      {devices.length > 0 && <p className="muted small">Perangkat terdaftar: {devices.map((d) => d.label).join(', ')}</p>}
    </Panel>
  );
}
