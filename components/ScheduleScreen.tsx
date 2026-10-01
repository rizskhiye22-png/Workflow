'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, toast, timeline, fmtDur, HARI, toMin, downloadIcs, jstNow, type Kelas } from '@/lib/client';
import { Btn, ErrorBox, Field, Loading, Panel, Sheet } from './ui';

const EMPTY: Kelas = { name: '', day: 1, start: '19:00', end: '20:40', code: '', kelas: '', link: '', note: '' };

export default function ScheduleScreen() {
  const [list, setList] = useState<Kelas[] | null>(null);
  const [err, setErr] = useState<any>(null);
  const [, setTick] = useState(0);
  const [edit, setEdit] = useState<Kelas | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [until, setUntil] = useState('');
  const [remind, setRemind] = useState(false);

  useEffect(() => {
    api('/schedule').then(setList).catch(setErr);
    try { setRemind(localStorage.getItem('kb_remind') === '1'); } catch {}
    const iv = setInterval(() => setTick((t) => t + 1), 20_000);
    return () => clearInterval(iv);
  }, []);

  const save = useCallback(async (next: Kelas[], msg: string) => {
    try {
      const r = await api('/schedule', { method: 'PUT', body: { items: next } });
      setList(r); setEdit(null); toast(msg, 'ok');
    } catch (e: any) { toast(e.message, 'bad'); }
  }, []);

  if (err) return <ErrorBox error={err} />;
  if (!list) return <Loading />;

  const tl = timeline(list);
  const now = tl.find((c) => c.ongoing);
  const nxt = [...tl].filter((c) => !c.ongoing).sort((a, b) => a.until - b.until)[0];
  const today = jstNow().day;
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => list.some((c) => c.day === d));
  const hero = now || nxt;

  const toggleRemind = async (on: boolean) => {
    if (on) {
      if (!('Notification' in window)) return toast('Browser ini tidak mendukung notifikasi', 'bad');
      if ((await Notification.requestPermission()) !== 'granted') return toast('Izin notifikasi ditolak', 'bad');
    }
    try { localStorage.setItem('kb_remind', on ? '1' : '0'); } catch {}
    setRemind(on);
    toast(on ? 'Pengingat aktif' : 'Pengingat dimatikan', on ? 'ok' : '');
  };

  return (
    <div className="screen">
      {hero && (
        <section className={`boss-quest ${now ? 'live' : ''}`}>
          <div className="bq-tag">{now ? '● QUEST AKTIF' : 'QUEST BERIKUTNYA'}</div>
          <div className="bq-name">{hero.name}</div>
          <div className="bq-meta">{HARI[hero.day]} · {hero.start}–{hero.end} JST{hero.kelas ? ` · ${hero.kelas}` : ''}</div>
          <div className="bq-timer">
            {now ? <>SISA <b>{fmtDur(now.left)}</b></> : <>MULAI <b>{fmtDur(nxt.until)}</b> LAGI</>}
          </div>
          {now && (
            <div className="hpbar"><div style={{ width: `${Math.max(3, 100 - (now.left / ((toMin(now.end) - toMin(now.start) + 1440) % 1440 || 1440)) * 100)}%` }} /></div>
          )}
          {hero.link && <a className="gbtn gbtn-gold" href={hero.link} target="_blank" rel="noopener"><span>Masuk kelas</span></a>}
        </section>
      )}

      <Panel title="PENGINGAT" icon="bell">
        <label className="toggle">
          <input type="checkbox" checked={remind} onChange={(e) => toggleRemind(e.target.checked)} />
          <span className="tg" aria-hidden />
          <span>Notifikasi 15 menit sebelum kelas <small className="muted">(saat aplikasi terbuka)</small></span>
        </label>
        <p className="muted small">Agar tetap diingatkan walau aplikasi tertutup, pasang ke kalender HP:</p>
        <div className="btn-row">
          <Field label="Semester selesai"><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        </div>
        <Btn variant="gold" block onClick={() => { downloadIcs(list, until); toast(until ? 'File kalender dibuat. Buka untuk menambahkan.' : 'Dibuat tanpa tanggal akhir (berulang terus)', 'ok'); }}>
          Tambah ke kalender (.ics)
        </Btn>
      </Panel>

      <Panel title="SEMINGGU" icon="cal" right={<Btn variant="green" onClick={() => { setIsNew(true); setEdit({ ...EMPTY }); }}>+ Kelas</Btn>}>
        <p className="muted small">Semua jam waktu Jepang (JST). <b>+1</b> = selesai besok harinya.</p>
        {days.map((d) => (
          <div key={d} className={`day ${d === today ? 'today' : ''}`}>
            <h4>{HARI[d]}{d === today && <span className="pill st-building">HARI INI</span>}</h4>
            {tl.filter((c) => c.day === d).sort((a, b) => toMin(a.start) - toMin(b.start)).map((c) => (
              <button key={c.id} className={`class-card ${c.ongoing ? 'live' : ''}`} onClick={() => { setIsNew(false); setEdit(c); }}>
                <span className="cc-time">{c.start}<small>{c.end}{toMin(c.end) < toMin(c.start) && <sup>+1</sup>}</small></span>
                <span className="cc-name">{c.name}<small>{[c.kelas, c.code].filter(Boolean).join(' · ')}{c.note ? ` · ${c.note}` : ''}</small></span>
                {c.ongoing && <span className="pill st-success">LIVE</span>}
              </button>
            ))}
          </div>
        ))}
        {!days.length && <p className="muted">Belum ada jadwal.</p>}
      </Panel>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={isNew ? 'TAMBAH KELAS' : 'UBAH KELAS'}>
        {edit && <ClassForm value={edit} isNew={isNew}
          onCancel={() => setEdit(null)}
          onSave={(item) => save(isNew ? [...list, item] : list.map((x) => (x.id === edit.id ? item : x)), 'Jadwal disimpan')}
          onDelete={() => confirm(`Hapus ${edit.name} dari jadwal?`) && save(list.filter((x) => x.id !== edit.id), 'Kelas dihapus')} />}
      </Sheet>
    </div>
  );
}

function ClassForm({ value, isNew, onSave, onDelete, onCancel }: { value: Kelas; isNew: boolean; onSave: (k: Kelas) => void; onDelete: () => void; onCancel: () => void }) {
  const [v, setV] = useState<Kelas>(value);
  const set = (k: keyof Kelas) => (e: any) => setV({ ...v, [k]: k === 'day' ? Number(e.target.value) : e.target.value });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...v, name: v.name.trim() }); }}>
      <Field label="Mata kuliah"><input required maxLength={80} value={v.name} onChange={set('name')} /></Field>
      <div className="grid3">
        <Field label="Hari"><select value={v.day} onChange={set('day')}>{HARI.map((h, i) => <option key={i} value={i}>{h}</option>)}</select></Field>
        <Field label="Mulai"><input type="time" required value={v.start} onChange={set('start')} /></Field>
        <Field label="Selesai"><input type="time" required value={v.end} onChange={set('end')} /></Field>
      </div>
      <div className="grid2">
        <Field label="Kelas"><input value={v.kelas || ''} onChange={set('kelas')} /></Field>
        <Field label="Kode"><input value={v.code || ''} onChange={set('code')} /></Field>
      </div>
      <Field label="Link kelas" hint="(Zoom/Meet, opsional)"><input value={v.link || ''} placeholder="https://" onChange={set('link')} /></Field>
      <Field label="Catatan"><input maxLength={200} value={v.note || ''} onChange={set('note')} /></Field>
      <div className="btn-row">
        <Btn variant="gold" type="submit">Simpan</Btn>
        {!isNew && <Btn variant="red" type="button" onClick={onDelete}>Hapus</Btn>}
        <Btn variant="ghost" type="button" onClick={onCancel}>Batal</Btn>
      </div>
    </form>
  );
}
