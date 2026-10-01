'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, toast, sfx } from '@/lib/client';
import { Btn, ErrorBox, Loading, Panel, Sheet, Field } from './ui';

export default function DataScreen() {
  const [tab, setTab] = useState<'kv' | 'd1'>('kv');
  return (
    <div className="screen">
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'kv'} className={tab === 'kv' ? 'on' : ''} onClick={() => { sfx('tab'); setTab('kv'); }}>🗝 KV</button>
        <button role="tab" aria-selected={tab === 'd1'} className={tab === 'd1' ? 'on' : ''} onClick={() => { sfx('tab'); setTab('d1'); }}>🗄 DATABASE D1</button>
      </div>
      {tab === 'kv' ? <KvPanel /> : <D1Panel />}
    </div>
  );
}

function KvPanel() {
  const [ns, setNs] = useState<any[] | null>(null);
  const [err, setErr] = useState<any>(null);
  const [cur, setCur] = useState('');
  const [prefix, setPrefix] = useState('');
  const [keys, setKeys] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<{ key: string | null } | null>(null);

  const loadNs = useCallback(() => api('/kv/namespaces').then((n) => { setNs(n); setCur((c) => c || n[0]?.id || ''); }).catch(setErr), []);
  useEffect(() => { loadNs(); }, [loadNs]);

  const load = useCallback(async (reset: boolean, c?: string | null) => {
    if (!cur) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ prefix });
      if (!reset && c) q.set('cursor', c);
      const r = await api(`/kv/${cur}/keys?${q}`);
      setKeys((k) => (reset ? r.keys : [...k, ...r.keys]));
      setCursor(r.cursor);
    } catch (e: any) { toast(e.message, 'bad'); } finally { setLoading(false); }
  }, [cur, prefix]);
  useEffect(() => { load(true); }, [cur]); // eslint-disable-line

  const newNs = async () => {
    const title = prompt('Nama namespace KV baru:');
    if (!title) return;
    try { const n = await api('/kv/namespaces', { method: 'POST', body: { title } }); toast('Namespace dibuat', 'ok'); setCur(n.id); loadNs(); }
    catch (e: any) { toast(e.message, 'bad'); }
  };

  if (err) return <ErrorBox error={err} />;
  if (!ns) return <Loading />;
  return (
    <Panel title="PENYIMPANAN KV" icon="db" right={<Btn variant="ghost" onClick={newNs}>+ NS</Btn>}>
      {!ns.length ? <p className="muted">Belum ada namespace KV.</p> : (
        <>
          <Field label="Namespace">
            <select value={cur} onChange={(e) => setCur(e.target.value)}>{ns.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}</select>
          </Field>
          <form className="inline-row" onSubmit={(e) => { e.preventDefault(); load(true); }}>
            <input value={prefix} placeholder="Cari awalan key…" onChange={(e) => setPrefix(e.target.value)} />
            <Btn type="submit">Cari</Btn>
          </form>
          <Btn variant="green" block onClick={() => setEdit({ key: null })}>+ Key baru</Btn>
          <ul className="inv">
            {keys.map((k) => (
              <li key={k.name}><button onClick={() => setEdit({ key: k.name })}>
                <span className="inv-ico" aria-hidden>◆</span><span className="inv-name">{k.name}</span>
                {k.expiration && <small>exp {new Date(k.expiration * 1000).toLocaleDateString('id-ID')}</small>}
              </button></li>
            ))}
            {!keys.length && !loading && <li className="muted pad">Kosong.</li>}
          </ul>
          {loading && <Loading />}
          {cursor && !loading && <Btn variant="ghost" block onClick={() => load(false, cursor)}>Muat lagi</Btn>}
        </>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.key ? `KEY · ${edit.key}` : 'KEY BARU'}>
        {edit && <KvEditor ns={cur} k={edit.key} onDone={() => { setEdit(null); load(true); }} onCancel={() => setEdit(null)} />}
      </Sheet>
    </Panel>
  );
}

function KvEditor({ ns, k, onDone, onCancel }: { ns: string; k: string | null; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [val, setVal] = useState(k ? null as any : '');
  useEffect(() => {
    if (k) api(`/kv/${ns}/value?key=${encodeURIComponent(k)}`).then((r) => setVal(r.value)).catch((e) => { setVal(''); toast(e.message, 'bad'); });
  }, [ns, k]);
  const save = async () => {
    const key = k || name.trim();
    if (!key) return toast('Nama key wajib', 'bad');
    try { await api(`/kv/${ns}/value?key=${encodeURIComponent(key)}`, { method: 'PUT', body: { value: val } }); toast('Tersimpan', 'ok'); onDone(); }
    catch (e: any) { toast(e.message, 'bad'); }
  };
  const del = async () => {
    if (!k || !confirm(`Hapus key "${k}"? Tidak bisa dibatalkan.`)) return;
    try { await api(`/kv/${ns}/value?key=${encodeURIComponent(k)}`, { method: 'DELETE' }); toast('Dihapus', 'ok'); onDone(); }
    catch (e: any) { toast(e.message, 'bad'); }
  };
  if (val === null) return <Loading />;
  return (
    <>
      {!k && <Field label="Nama key"><input maxLength={512} value={name} onChange={(e) => setName(e.target.value)} /></Field>}
      <Field label="Isi (value)"><textarea rows={12} spellCheck={false} value={val} onChange={(e) => setVal(e.target.value)} /></Field>
      <div className="btn-row">
        <Btn variant="ghost" onClick={() => { try { setVal(JSON.stringify(JSON.parse(val), null, 2)); } catch { toast('Bukan JSON yang valid', 'bad'); } }}>Rapikan JSON</Btn>
        <Btn variant="gold" onClick={save}>Simpan</Btn>
        {k && <Btn variant="red" onClick={del}>Hapus</Btn>}
        <Btn variant="ghost" onClick={onCancel}>Batal</Btn>
      </div>
    </>
  );
}

function D1Panel() {
  const [dbs, setDbs] = useState<any[] | null>(null);
  const [err, setErr] = useState<any>(null);
  const [cur, setCur] = useState('');
  const [tables, setTables] = useState<string[] | null>(null);
  const [sql, setSql] = useState('');
  const [res, setRes] = useState<any[] | null>(null);
  const [rerr, setRerr] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const loadDbs = useCallback(() => api('/d1/databases').then((d) => { setDbs(d); setCur((c) => c || d[0]?.id || ''); }).catch(setErr), []);
  useEffect(() => { loadDbs(); }, [loadDbs]);
  const q = useCallback((s: string) => api(`/d1/${cur}/query`, { method: 'POST', body: { sql: s } }), [cur]);
  const loadTables = useCallback(async () => {
    if (!cur) return;
    setTables(null);
    try {
      const r = await q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
      setTables(r[r.length - 1]?.results?.map((x: any) => x.name) || []);
    } catch (e) { setRerr(e); setTables([]); }
  }, [cur, q]);
  useEffect(() => { loadTables(); }, [loadTables]);

  const run = async (s = sql) => {
    if (!s.trim()) return;
    if (/\b(drop|delete|update|alter|truncate|replace)\b/i.test(s) && !confirm('Perintah ini mengubah/menghapus data. Lanjutkan?')) return;
    setRunning(true); setRerr(null);
    try { setRes(await q(s)); sfx('coin'); if (/\b(create|drop|alter)\b/i.test(s)) loadTables(); }
    catch (e) { setRerr(e); setRes(null); } finally { setRunning(false); }
  };
  const newDb = async () => {
    const name = prompt('Nama database D1 baru (huruf, angka, -):');
    if (!name) return;
    try { const d = await api('/d1/databases', { method: 'POST', body: { name } }); toast('Database dibuat', 'ok'); setCur(d.id); loadDbs(); }
    catch (e: any) { toast(e.message, 'bad'); }
  };

  if (err) return <ErrorBox error={err} />;
  if (!dbs) return <Loading />;
  return (
    <Panel title="DATABASE D1" icon="db" right={<Btn variant="ghost" onClick={newDb}>+ DB</Btn>}>
      {!dbs.length ? <p className="muted">Belum ada database D1.</p> : (
        <>
          <Field label="Database"><select value={cur} onChange={(e) => setCur(e.target.value)}>{dbs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <div className="chips">
            {tables === null ? <Loading text="Memuat tabel…" /> : tables.length ? tables.map((t) => (
              <button key={t} className="chip" onClick={() => { const s = `SELECT * FROM "${t}" LIMIT 50;`; setSql(s); run(s); }}>▤ {t}</button>
            )) : <span className="muted">Belum ada tabel.</span>}
          </div>
          <Field label="SQL"><textarea rows={5} spellCheck={false} placeholder="SELECT * FROM users LIMIT 20;" value={sql} onChange={(e) => setSql(e.target.value)} /></Field>
          <Btn variant="gold" block disabled={running} onClick={() => run()}>{running ? 'Menjalankan…' : 'JALANKAN ▶'}</Btn>
          <ErrorBox error={rerr} />
          {res?.map((s, i) => <ResultTable key={i} s={s} />)}
        </>
      )}
    </Panel>
  );
}

function ResultTable({ s }: { s: any }) {
  const rows = s.results || [];
  const meta = s.meta || {};
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <>
      <p className="muted small">{rows.length} baris{meta.changes ? ` · ${meta.changes} diubah` : ''}{meta.duration != null ? ` · ${Number(meta.duration).toFixed(1)} ms` : ''}</p>
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{rows.map((r: any, i: number) => <tr key={i}>{cols.map((c) => <td key={c}>{r[c] === null ? <i className="muted">null</i> : String(r[c])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
