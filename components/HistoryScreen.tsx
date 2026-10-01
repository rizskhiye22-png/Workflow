'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, timeAgo, toast } from '@/lib/client';
import { Btn, ErrorBox, Field, Loading, Panel, Pill } from './ui';

const runStatus = (r: any) => (r.status !== 'completed' ? 'building' : ['success', 'skipped', 'neutral'].includes(r.conclusion) ? 'success' : 'failed');

function Row({ title, sub, status, url }: { title: string; sub: string; status?: string; url?: string }) {
  return (
    <li className="log-row">
      <div><b>{title || '(tanpa pesan)'}</b><small>{sub}</small></div>
      {status && <Pill status={status} />}
      {url && <a href={url} target="_blank" rel="noopener" className="ext" aria-label="Buka">↗</a>}
    </li>
  );
}

export default function HistoryScreen() {
  const [projects, setProjects] = useState<any[] | null>(null);
  const [pid, setPid] = useState('');
  const [h, setH] = useState<any>(null);
  const [err, setErr] = useState<any>(null);

  useEffect(() => {
    api('/projects').then((p) => {
      setProjects(p);
      const want = new URLSearchParams(location.search).get('p');
      setPid(p.find((x: any) => x.id === want)?.id || p[0]?.id || '');
    }).catch(setErr);
  }, []);
  const [rolling, setRolling] = useState('');
  const load = () => api(`/projects/${encodeURIComponent(pid)}/history`).then(setH).catch(setErr);
  useEffect(() => {
    if (!pid) return;
    setH(null);
    load();
  }, [pid]); // eslint-disable-line
  const rollback = async (c: any) => {
    if (!confirm(`Kembalikan proyek ke versi ini?\n\n"${c.message}"\n\nIni membuat commit baru (riwayat tetap aman, bisa dibatalkan dengan rollback lagi). Situs akan deploy ulang otomatis.`)) return;
    setRolling(c.sha);
    try {
      const r = await api('/rollback', { method: 'POST', body: { projectId: pid, sha: c.sha } });
      toast(r.unchanged ? 'Isinya sudah sama dengan versi itu' : 'Rollback berhasil! Situs deploy ulang…', 'ok');
      await load();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setRolling(''); }
  };

  if (err) return <ErrorBox error={err} />;
  if (!projects) return <Loading />;
  if (!projects.length) return <Panel title="LOG DEPLOY" icon="log"><p className="muted">Belum ada proyek.</p><Link className="gbtn gbtn-gold" href="/atur"><span>+ Rekrut karyawan</span></Link></Panel>;

  return (
    <div className="screen">
      <Panel title="LOG DEPLOY" icon="log">
        <Field label="Proyek">
          <select value={pid} onChange={(e) => setPid(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.worker} · {p.name}</option>)}</select>
        </Field>
        {!h ? <Loading /> : (
          <>
            {h.error && <ErrorBox error={h.error} />}
            <h3 className="sub">Versi (commit terakhir)</h3>
            <ul className="logs">
              {h.commits?.length ? h.commits.map((c: any, i: number) => (
                <li key={c.sha} className="log-row">
                  <div><b>{c.message || '(tanpa pesan)'}</b><small>{c.sha.slice(0, 7)} · {timeAgo(Date.parse(c.date))}</small></div>
                  {i === 0 ? <span className="pill st-success">AKTIF</span>
                    : <Btn variant="ghost" disabled={!!rolling} onClick={() => rollback(c)}>{rolling === c.sha ? '…' : '↺ Kembalikan'}</Btn>}
                </li>
              )) : <li className="muted pad">Belum ada commit / tidak bisa dibaca.</li>}
            </ul>
            <h3 className="sub">Push dari dashboard</h3>
            <ul className="logs">{h.pushes.length ? h.pushes.map((p: any) => <Row key={p.sha} title={p.message} sub={`${timeAgo(p.time)} · ${p.sha.slice(0, 7)} · ${p.files} file`} url={p.url} />) : <li className="muted pad">Belum ada.</li>}</ul>
            <h3 className="sub">GitHub Actions</h3>
            <ul className="logs">{h.runs.length ? h.runs.map((r: any) => <Row key={r.id} title={r.title} sub={`${r.name} · ${timeAgo(Date.parse(r.created_at))}`} status={runStatus(r)} url={r.url} />) : <li className="muted pad">Tidak ada workflow run.</li>}</ul>
            {(h.project.pagesProject || h.project.workerName) && (
              <>
                <h3 className="sub">{h.project.workerName ? `Cloudflare Worker · ${h.project.workerName}` : 'Cloudflare Pages'}</h3>
                <ul className="logs">{h.deployments.length ? h.deployments.map((d: any) => <Row key={d.id} title={d.message} sub={`${d.environment} · ${timeAgo(Date.parse(d.created_on))}`} status={d.status} url={d.url} />) : <li className="muted pad">Belum ada deployment.</li>}</ul>
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
