'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, toast } from '@/lib/client';
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
        <ul className="roster">
          {projects.map((p) => (
            <li key={p.id}>
              <div><b>{p.worker}</b> · {p.name}<small>{p.owner}/{p.repo} · {p.branch}{p.pagesProject ? ` · Pages: ${p.pagesProject}` : ''}</small></div>
              <Btn variant="ghost" onClick={() => setEdit(p)}>Ubah</Btn>
            </li>
          ))}
          {!projects.length && <li className="muted pad">Belum ada karyawan. Rekrut satu untuk setiap repo proyekmu.</li>}
        </ul>
      </Panel>

      <Panel title="KONEKSI" icon="plug">
        <ul className="roster plain">
          <li><span>Token GitHub</span><Ok v={me.config.github} /></li>
          <li><span>Token Cloudflare + Account ID</span><Ok v={me.config.cloudflare} /></li>
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
    branch: p.branch || 'main', pagesProject: p.pagesProject || '', siteUrl: p.siteUrl || '',
  });
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  const save = async (e: any) => {
    e.preventDefault();
    const r = parseRepo(v.repo);
    if (!r) return toast('Format repo: username/nama-repo', 'bad');
    try {
      await api('/projects', { method: 'POST', body: { id: p.id, name: v.name, worker: v.worker, ...r, branch: v.branch || 'main', pagesProject: v.pagesProject, siteUrl: v.siteUrl } });
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
      <Field label="Proyek Cloudflare Pages" hint="(opsional)"><input value={v.pagesProject} placeholder="toko-online" onChange={set('pagesProject')} /></Field>
      <Field label="URL situs" hint="(opsional)"><input value={v.siteUrl} placeholder="https://…" onChange={set('siteUrl')} /></Field>
      <div className="btn-row">
        <Btn variant="gold" type="submit">Simpan</Btn>
        {p.id && <Btn variant="red" type="button" onClick={del}>Pecat</Btn>}
        <Btn variant="ghost" type="button" onClick={onCancel}>Batal</Btn>
      </div>
    </form>
  );
}
