'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, toast, sfx, downloadIcs, pushSupported, currentPushSub, enablePush, type Kelas } from '@/lib/client';
import {
  HARI, fmtDur, toMin, jstDate, addDays, dayOf, occurrencesOn, nowAndNext, classProgress,
  sessionInfo, pendingSessions, taskDueTs, occKey,
} from '@/lib/kuliah.js';
import { Btn, ErrorBox, Field, Loading, Panel, Sheet } from './ui';

type Data = { schedule: Kelas[]; semester: { start?: string; end?: string }; occ: Record<string, any>; extras: any[]; tasks: any[] };
type Tab = 'minggu' | 'kalender' | 'tugas';
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const fmtDate = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return `${HARI[dayOf(d)]}, ${dd} ${BULAN[m - 1].slice(0, 3)} ${y}`; };

export default function ScheduleScreen() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('minggu');
  const [, setTick] = useState(0);
  const [day, setDay] = useState<string | null>(null);
  const [editClass, setEditClass] = useState<{ c: Kelas; isNew: boolean } | null>(null);
  const [editTask, setEditTask] = useState<any>(null);
  const [editExtra, setEditExtra] = useState<any>(null);

  useEffect(() => {
    const t = new URLSearchParams(location.search).get('tab');
    if (t === 'kalender' || t === 'tugas') setTab(t);
    api('/kuliah').then(setData).catch(setErr);
    const iv = setInterval(() => setTick((x) => x + 1), 20_000);
    return () => clearInterval(iv);
  }, []);

  const call = useCallback(async (path: string, method: string, body?: any, msg?: string) => {
    try {
      const d = await api(path, { method, body });
      setData(d);
      if (msg) toast(msg, 'ok');
      return true;
    } catch (e: any) { toast(e.message, 'bad'); return false; }
  }, []);
  const setOcc = (key: string, status: string, msg?: string) => call('/kuliah/occ', 'PUT', { key, status }, msg);

  if (err) return <ErrorBox error={err} />;
  if (!data) return <Loading />;

  const { current, next } = nowAndNext(data);
  const openTasks = data.tasks.filter((t) => !t.done);
  const pending = pendingSessions(data, 14);
  const lastEnded = pending[0];

  const switchTab = (t: Tab) => { sfx('tab'); setTab(t); history.replaceState(null, '', t === 'minggu' ? '/jadwal' : `/jadwal?tab=${t}`); };

  return (
    <div className="screen">
      <Secretary data={data} current={current} next={next} openTasks={openTasks} pending={pending} />

      {(current || next) && (
        <section className={`boss-quest ${current ? 'live' : ''}`}>
          <div className="bq-tag">{current ? '● QUEST AKTIF' : 'QUEST BERIKUTNYA'}{(current || next).extra ? ' · TAMBAHAN' : ''}</div>
          <div className="bq-name">{(current || next).name}</div>
          <div className="bq-meta">{fmtDate((current || next).date)} · {(current || next).start}–{(current || next).end} JST</div>
          <div className="bq-timer">
            {current ? <>SISA <b>{fmtDur((current.endTs - Date.now()) / 60000)}</b></> : <>MULAI <b>{fmtDur((next.startTs - Date.now()) / 60000)}</b> LAGI</>}
          </div>
          {current && <div className="hpbar"><div style={{ width: `${Math.max(3, Math.min(100, ((Date.now() - current.startTs) / (current.endTs - current.startTs)) * 100))}%` }} /></div>}
          <div className="btn-row center">
            {(current || next).link && <a className="gbtn gbtn-gold" href={(current || next).link} target="_blank" rel="noopener"><span>Masuk kelas</span></a>}
            {current && <Btn variant="green" onClick={() => setOcc(current.key, 'done', 'Sesi ditandai selesai! +semangat')}>✓ Selesai</Btn>}
            {!current && next && <Btn variant="ghost" onClick={() => setOcc(next.key, 'libur', `${next.name} ditandai libur`)}>Tandai libur</Btn>}
          </div>
        </section>
      )}

      {lastEnded && !current && (
        <div className="quick-done">
          <span>Sudah ikut <b>{lastEnded.name}</b> ({fmtDate(lastEnded.date).split(',')[0]} {lastEnded.start})?</span>
          <Btn variant="green" onClick={() => setOcc(lastEnded.key, 'done', 'Sesi dicentang ✓')}>✓ Ya</Btn>
          <Btn variant="ghost" onClick={() => setOcc(lastEnded.key, 'libur', 'Ditandai tidak ada kuliah')}>Libur</Btn>
        </div>
      )}

      <div className="seg seg3" role="tablist">
        {(['minggu', 'kalender', 'tugas'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => switchTab(t)}>
            {t === 'minggu' ? '📅 MINGGU' : t === 'kalender' ? '🗓 KALENDER' : `📝 TUGAS${openTasks.length + pending.length ? ` (${openTasks.length + pending.length})` : ''}`}
          </button>
        ))}
      </div>

      {tab === 'minggu' && (
        <WeekTab data={data} onEdit={(c, isNew) => setEditClass({ c, isNew })} call={call} />
      )}
      {tab === 'kalender' && <CalendarTab data={data} onPick={setDay} />}
      {tab === 'tugas' && (
        <TaskTab data={data} pending={pending} setOcc={setOcc} call={call} onEdit={setEditTask} />
      )}

      <Sheet open={!!day} onClose={() => setDay(null)} title={day ? fmtDate(day).toUpperCase() : ''}>
        {day && <DayDetail date={day} data={data} setOcc={setOcc} call={call}
          onAddExtra={() => setEditExtra({ date: day, name: '', start: '19:00', end: '20:40' })}
          onEditExtra={(x: any) => setEditExtra(x)}
          onAddTask={() => setEditTask({ title: '', due: day, dueTime: '23:59' })}
          onEditTask={setEditTask} />}
      </Sheet>

      <Sheet open={!!editClass} onClose={() => setEditClass(null)} title={editClass?.isNew ? 'TAMBAH KELAS MINGGUAN' : 'UBAH KELAS'}>
        {editClass && <ClassForm value={editClass.c} isNew={editClass.isNew} onCancel={() => setEditClass(null)}
          onSave={async (item) => {
            const list = editClass.isNew ? [...data.schedule, item] : data.schedule.map((x) => (x.id === editClass.c.id ? item : x));
            try { await api('/schedule', { method: 'PUT', body: { items: list } }); setData(await api('/kuliah')); setEditClass(null); toast('Jadwal disimpan', 'ok'); }
            catch (e: any) { toast(e.message, 'bad'); }
          }}
          onDelete={async () => {
            if (!confirm(`Hapus ${editClass.c.name} dari jadwal mingguan?`)) return;
            try { await api('/schedule', { method: 'PUT', body: { items: data.schedule.filter((x) => x.id !== editClass.c.id) } }); setData(await api('/kuliah')); setEditClass(null); toast('Kelas dihapus', 'ok'); }
            catch (e: any) { toast(e.message, 'bad'); }
          }} />}
      </Sheet>

      <Sheet open={!!editTask} onClose={() => setEditTask(null)} title={editTask?.id ? 'UBAH TUGAS' : 'TUGAS BARU'}>
        {editTask && <TaskForm value={editTask} schedule={data.schedule} onCancel={() => setEditTask(null)}
          onSave={async (t) => { if (await call('/kuliah/task', 'POST', t, t.id ? 'Tugas disimpan' : 'Tugas ditambahkan')) setEditTask(null); }}
          onDelete={async () => { if (confirm('Hapus tugas ini?') && (await call(`/kuliah/task/${editTask.id}`, 'DELETE', undefined, 'Tugas dihapus'))) setEditTask(null); }} />}
      </Sheet>

      <Sheet open={!!editExtra} onClose={() => setEditExtra(null)} title={editExtra?.id ? 'UBAH KULIAH TAMBAHAN' : 'KULIAH TAMBAHAN / PENGGANTI'}>
        {editExtra && <ExtraForm value={editExtra} schedule={data.schedule} onCancel={() => setEditExtra(null)}
          onSave={async (x) => { if (await call('/kuliah/extra', 'POST', x, 'Kuliah tambahan disimpan')) setEditExtra(null); }}
          onDelete={async () => { if (confirm('Hapus kuliah tambahan ini?') && (await call(`/kuliah/extra/${editExtra.id}`, 'DELETE', undefined, 'Dihapus'))) setEditExtra(null); }} />}
      </Sheet>
    </div>
  );
}

// ---------------- Sekretaris (bot kuliah) ----------------
function Secretary({ data, current, next, openTasks, pending }: any) {
  const lines = useMemo(() => {
    const out: string[] = [];
    const now = Date.now();
    if (current) out.push(`Bos, sekarang ada kuliah ${current.name}. Sisa ${fmtDur((current.endTs - now) / 60000)}. Semangat!`);
    else if (next) out.push(`Kuliah berikutnya ${next.name}, ${HARI[dayOf(next.date)]} jam ${next.start}. ${fmtDur((next.startTs - now) / 60000)} lagi.`);
    else out.push('Tidak ada kuliah dalam 2 minggu ke depan. Waktunya istirahat, Bos!');
    const overdue = openTasks.filter((t: any) => t.due && taskDueTs(t) < now);
    if (overdue.length) out.push(`Ada ${overdue.length} tugas yang sudah lewat tenggat. Cek tab Tugas ya!`);
    const soon = openTasks.filter((t: any) => t.due && taskDueTs(t) >= now && taskDueTs(t) - now < 3 * 86400_000);
    if (soon.length) out.push(`${soon.length} tugas tenggatnya ≤3 hari: ${soon.slice(0, 2).map((t: any) => t.title).join(', ')}.`);
    if (pending.length) out.push(`${pending.length} sesi kuliah belum dicentang. Sudah ikut semua, Bos?`);
    if (!data.semester?.start) out.push('Atur tanggal mulai semester di tab Minggu supaya saya bisa hitung pertemuan ke berapa.');
    if (out.length === 1) out.push('Semua tugas aman. Kerja bagus, Bos! 👍');
    return out;
  }, [data, current, next, openTasks, pending]);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState('');
  const text = lines[i % lines.length];
  useEffect(() => {
    setShown('');
    let n = 0;
    const iv = setInterval(() => { n += 2; setShown(text.slice(0, n)); if (n >= text.length) clearInterval(iv); }, 28);
    return () => clearInterval(iv);
  }, [text]);
  return (
    <button className="secretary" onClick={() => { sfx('click'); setI((x) => x + 1); }} aria-label="Sekretaris: ketuk untuk pesan berikutnya">
      <img src="/icons/sekretaris.png" alt="" width={56} height={56} className="pix sec-avatar" />
      <div className="sec-bubble">
        <span className="sec-name">YUKI · SEKRETARIS</span>
        <span className="sec-text">{shown}<span className="caret">▌</span></span>
        {lines.length > 1 && <span className="sec-more">{(i % lines.length) + 1}/{lines.length} ▶</span>}
      </div>
    </button>
  );
}

// ---------------- Tab Minggu ----------------
function WeekTab({ data, onEdit, call }: { data: Data; onEdit: (c: Kelas, isNew: boolean) => void; call: any }) {
  const today = jstDate();
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => data.schedule.some((c) => c.day === d));
  const [sem, setSem] = useState({ start: data.semester?.start || '', end: data.semester?.end || '' });
  const [push, setPush] = useState<'?' | 'on' | 'off' | 'na'>('?');
  const [until, setUntil] = useState('');
  useEffect(() => {
    if (!pushSupported()) { setPush('na'); return; }
    currentPushSub().then((s) => setPush(s && Notification.permission === 'granted' ? 'on' : 'off'));
  }, []);
  const todayDow = dayOf(today);

  return (
    <>
      <Panel title="SEMINGGU" icon="cal" right={<Btn variant="green" onClick={() => onEdit({ name: '', day: 1, start: '19:00', end: '20:40' }, true)}>+ Kelas</Btn>}>
        <p className="muted small">Jam waktu Jepang (JST). <b>+1</b> = selesai besok. Ketuk kelas untuk ubah.</p>
        {days.map((d) => {
          const date = addDays(today, (d - todayDow + 7) % 7);
          return (
            <div key={d} className={`day ${d === todayDow ? 'today' : ''}`}>
              <h4>{HARI[d]}{d === todayDow && <span className="pill st-building">HARI INI</span>}</h4>
              {data.schedule.filter((c) => c.day === d).sort((a, b) => toMin(a.start) - toMin(b.start)).map((c) => {
                const prog = classProgress(c, data);
                const ses = sessionInfo(c, date, data);
                const o = data.occ[occKey(date, c.id!)];
                return (
                  <button key={c.id} className={`class-card ${o?.status === 'libur' ? 'off' : ''}`} onClick={() => onEdit(c, false)}>
                    <span className="cc-time">{c.start}<small>{c.end}{toMin(c.end) < toMin(c.start) && <sup>+1</sup>}</small></span>
                    <span className="cc-name">
                      {c.name}
                      <small>{[c.kelas, c.code].filter(Boolean).join(' · ')}{ses ? ` · Pertemuan ${ses.n}${ses.total ? `/${ses.total}` : ''}` : ''}</small>
                      {prog && (
                        <span className="sesbar" title={`${prog.done} selesai, ${prog.libur} libur dari ${prog.total}`}>
                          {Array.from({ length: Math.min(prog.total, 20) }, (_, i) => {
                            const dd = addDays(addDays(data.semester.start!, (c.day - dayOf(data.semester.start!) + 7) % 7), i * 7);
                            const st = data.occ[occKey(dd, c.id!)]?.status;
                            return <i key={i} className={st === 'done' ? 'ok' : st === 'libur' ? 'off' : dd < today ? 'miss' : ''} />;
                          })}
                        </span>
                      )}
                    </span>
                    {o?.status === 'libur' && <span className="pill">LIBUR</span>}
                    {o?.status === 'done' && <span className="pill st-success">✓</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
        {!days.length && <p className="muted">Belum ada jadwal.</p>}
        <p className="muted small legend"><i className="lg ok" /> selesai <i className="lg off" /> libur <i className="lg miss" /> belum dicentang <i className="lg" /> akan datang</p>
      </Panel>

      <Panel title="SEMESTER" icon="cal">
        <p className="muted small">Dipakai untuk menghitung pertemuan ke berapa & progres sesi.</p>
        <div className="grid2">
          <Field label="Mulai"><input type="date" value={sem.start} onChange={(e) => setSem({ ...sem, start: e.target.value })} /></Field>
          <Field label="Selesai"><input type="date" value={sem.end} onChange={(e) => setSem({ ...sem, end: e.target.value })} /></Field>
        </div>
        <Btn variant="gold" block onClick={() => call('/kuliah/semester', 'PUT', sem, 'Semester disimpan')}>Simpan semester</Btn>
      </Panel>

      <Panel title="PENGINGAT" icon="bell">
        {push === 'on' && <p>🔔 Notifikasi push <b className="okc">aktif</b> di perangkat ini. Atur detailnya di menu <b>Atur</b>.</p>}
        {push === 'off' && (
          <>
            <p className="muted">Aktifkan supaya HP berbunyi sebelum kuliah & tenggat tugas, walau aplikasi tertutup.</p>
            <Btn variant="green" block onClick={async () => { try { await enablePush(); setPush('on'); toast('Notifikasi aktif! 🔔', 'ok'); } catch (e: any) { toast(e.message, 'bad'); } }}>🔔 Aktifkan notifikasi</Btn>
          </>
        )}
        {push === 'na' && <p className="muted small">Browser ini tidak mendukung push. Di iPhone: Bagikan → Tambahkan ke Layar Utama, lalu buka dari ikon.</p>}
        <p className="muted small" style={{ marginTop: 14 }}>Cadangan: masukkan jadwal ke kalender HP (tanggal libur ikut dikecualikan).</p>
        <Field label="Berulang sampai" hint="(kosong = akhir semester)"><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        <Btn variant="ghost" block onClick={() => { downloadIcs(data, until); toast('File kalender dibuat', 'ok'); }}>Unduh kalender (.ics)</Btn>
      </Panel>
    </>
  );
}

// ---------------- Tab Kalender ----------------
function CalendarTab({ data, onPick }: { data: Data; onPick: (d: string) => void }) {
  const today = jstDate();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const lead = (dayOf(first) + 6) % 7; // Senin di kolom pertama
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const shift = (n: number) => { sfx('click'); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setYm(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); };
  const now = Date.now();

  return (
    <Panel title="KALENDER" icon="cal">
      <div className="cal-head">
        <button className="cal-nav" onClick={() => shift(-1)} aria-label="Bulan sebelumnya">◀</button>
        <span className="cal-title">{BULAN[m - 1].toUpperCase()} {y}</span>
        <button className="cal-nav" onClick={() => shift(1)} aria-label="Bulan berikutnya">▶</button>
      </div>
      <div className="cal-grid">
        {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((h) => <span key={h} className="cal-dow">{h}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="cal-cell empty" />;
          const occ = occurrencesOn(d, data);
          const tasks = data.tasks.filter((t) => t.due === d);
          return (
            <button key={d} className={`cal-cell ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`} onClick={() => { sfx('open'); onPick(d); }}>
              <span className="cal-n">{Number(d.slice(8))}</span>
              <span className="cal-dots">
                {occ.map((o) => <i key={o.key} className={o.status === 'done' ? 'ok' : o.status === 'libur' ? 'off' : o.endTs < now ? 'miss' : o.extra ? 'extra' : ''} />)}
                {tasks.map((t) => <i key={t.id} className={`task ${t.done ? 'done' : ''}`} />)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="muted small legend">
        <i className="lg" /> kuliah <i className="lg extra" /> tambahan <i className="lg ok" /> selesai <i className="lg off" /> libur <i className="lg miss" /> belum dicentang <i className="lg task" /> tugas
      </p>
      <Btn variant="ghost" block onClick={() => { setYm(today.slice(0, 7)); onPick(today); }}>Hari ini</Btn>
    </Panel>
  );
}

function DayDetail({ date, data, setOcc, call, onAddExtra, onEditExtra, onAddTask, onEditTask }: any) {
  const occ = occurrencesOn(date, data);
  const tasks = data.tasks.filter((t: any) => t.due === date);
  const now = Date.now();
  return (
    <>
      <h4 className="sub">KULIAH</h4>
      {occ.length ? occ.map((o: any) => {
        const cls = data.schedule.find((c: Kelas) => c.id === o.classId);
        const ses = cls && !o.extra ? sessionInfo(cls, date, data) : null;
        return (
          <div key={o.key} className={`occ-row st-${o.status}`}>
            <div className="occ-top">
              <b>{o.start}–{o.end}</b> {o.name}
              {o.extra && <span className="pill">TAMBAHAN</span>}
              {ses && <small className="muted"> · Pertemuan {ses.n}{ses.total ? `/${ses.total}` : ''}</small>}
            </div>
            <div className="tri" role="radiogroup" aria-label={`Status ${o.name}`}>
              <button role="radio" aria-checked={o.status === 'normal'} className={o.status === 'normal' ? 'on' : ''} onClick={() => setOcc(o.key, 'normal')}>{o.endTs < now ? 'Belum' : 'Ada kuliah'}</button>
              <button role="radio" aria-checked={o.status === 'done'} className={o.status === 'done' ? 'on ok' : ''} onClick={() => setOcc(o.key, 'done', 'Sesi selesai ✓')}>✓ Selesai</button>
              <button role="radio" aria-checked={o.status === 'libur'} className={o.status === 'libur' ? 'on off' : ''} onClick={() => setOcc(o.key, 'libur', 'Ditandai libur')}>Libur</button>
            </div>
            {o.extra && <button className="linkbtn" onClick={() => onEditExtra(data.extras.find((x: any) => x.id === o.extraId))}>Ubah kuliah tambahan</button>}
          </div>
        );
      }) : <p className="muted">Tidak ada kuliah di tanggal ini.</p>}
      <Btn variant="ghost" block onClick={onAddExtra}>+ Kuliah tambahan / pengganti</Btn>

      <h4 className="sub">TUGAS TENGGAT HARI INI</h4>
      {tasks.length ? <ul className="todo">{tasks.map((t: any) => <TaskRow key={t.id} t={t} data={data} call={call} onEdit={onEditTask} />)}</ul> : <p className="muted">Tidak ada.</p>}
      <Btn variant="ghost" block onClick={onAddTask}>+ Tugas di tanggal ini</Btn>
    </>
  );
}

// ---------------- Tab Tugas ----------------
function TaskRow({ t, data, call, onEdit }: any) {
  const cls = data.schedule.find((c: Kelas) => c.id === t.classId);
  const due = taskDueTs(t);
  const now = Date.now();
  const late = !t.done && due && due < now;
  const left = due ? (due - now) / 60000 : null;
  return (
    <li className={`todo-row ${t.done ? 'done' : ''} ${late ? 'late' : ''}`}>
      <button className="chk" aria-label={t.done ? 'Tandai belum selesai' : 'Tandai selesai'} aria-pressed={t.done}
        onClick={() => { if (!t.done) sfx('coin'); call('/kuliah/task', 'POST', { ...t, done: !t.done }, t.done ? undefined : 'Tugas selesai! 🎉'); }}>
        {t.done ? '✓' : ''}
      </button>
      <button className="todo-main" onClick={() => onEdit(t)}>
        <b>{t.title}</b>
        <small>
          {cls ? `${cls.name} · ` : ''}
          {t.due ? `${t.due.slice(5).replace('-', '/')} ${t.dueTime || ''}` : 'tanpa tenggat'}
          {!t.done && left !== null && (late ? ' · LEWAT TENGGAT' : left < 3 * 1440 ? ` · ${fmtDur(left)} lagi` : '')}
        </small>
      </button>
    </li>
  );
}

function TaskTab({ data, pending, setOcc, call, onEdit }: any) {
  const [showDone, setShowDone] = useState(false);
  const [showAllPending, setShowAllPending] = useState(false);
  const sortKey = (t: any) => (t.due ? t.due + (t.dueTime || '23:59') : '9999');
  const open = data.tasks.filter((t: any) => !t.done).sort((a: any, b: any) => sortKey(a).localeCompare(sortKey(b)));
  const done = data.tasks.filter((t: any) => t.done).sort((a: any, b: any) => (b.doneAt || 0) - (a.doneAt || 0));
  const shownPending = showAllPending ? pending : pending.slice(0, 5);
  return (
    <>
      <Panel title="TUGAS" icon="log" right={<Btn variant="green" onClick={() => onEdit({ title: '', due: '', dueTime: '23:59' })}>+ Tugas</Btn>}>
        {open.length ? <ul className="todo">{open.map((t: any) => <TaskRow key={t.id} t={t} data={data} call={call} onEdit={onEdit} />)}</ul>
          : <p className="muted">Tidak ada tugas yang belum selesai. Mantap, Bos!</p>}
        {done.length > 0 && (
          <>
            <button className="linkbtn" onClick={() => setShowDone(!showDone)}>{showDone ? '▼' : '▶'} Selesai ({done.length})</button>
            {showDone && <ul className="todo">{done.slice(0, 30).map((t: any) => <TaskRow key={t.id} t={t} data={data} call={call} onEdit={onEdit} />)}</ul>}
          </>
        )}
      </Panel>

      <Panel title={`SESI BELUM DICENTANG${pending.length ? ` (${pending.length})` : ''}`} icon="log">
        {pending.length ? (
          <>
            <p className="muted small">Kuliah 2 minggu terakhir yang sudah lewat. Centang kalau sudah ikut, atau tandai libur.</p>
            {pending.length > 1 && (
              <Btn variant="green" block onClick={() => { if (confirm(`Tandai ${pending.length} sesi sebagai selesai?`)) { sfx('coin'); call('/kuliah/occ-bulk', 'PUT', { keys: pending.map((o: any) => o.key), status: 'done' }, `${pending.length} sesi dicentang ✓`); } }}>
                ✓ Centang semua ({pending.length})
              </Btn>
            )}
            <ul className="todo">
              {shownPending.map((o: any) => (
                <li key={o.key} className="todo-row">
                  <button className="chk" aria-label={`Tandai ${o.name} selesai`} onClick={() => { sfx('coin'); setOcc(o.key, 'done', 'Sesi selesai ✓'); }} />
                  <div className="todo-main static">
                    <b>{o.name}</b>
                    <small>{fmtDate(o.date)} · {o.start}–{o.end}</small>
                  </div>
                  <button className="linkbtn" onClick={() => setOcc(o.key, 'libur', 'Ditandai libur')}>Libur</button>
                </li>
              ))}
            </ul>
            {pending.length > 5 && <button className="linkbtn" onClick={() => setShowAllPending(!showAllPending)}>{showAllPending ? '▲ Ringkas' : `▼ Lihat semua (${pending.length})`}</button>}
          </>
        ) : <p className="muted">Semua sesi 2 minggu terakhir sudah dicentang. 👍</p>}
      </Panel>
    </>
  );
}

// ---------------- Form ----------------
function TaskForm({ value, schedule, onSave, onDelete, onCancel }: any) {
  const [v, setV] = useState({ classId: '', note: '', ...value });
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <Field label="Tugas"><input required maxLength={140} value={v.title} placeholder="Essay Sejarah Jepang 1000 kata" onChange={set('title')} autoFocus /></Field>
      <Field label="Mata kuliah" hint="(opsional)">
        <select value={v.classId} onChange={set('classId')}>
          <option value="">— Tidak terkait —</option>
          {schedule.map((c: Kelas) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div className="grid2">
        <Field label="Tenggat"><input type="date" value={v.due} onChange={set('due')} /></Field>
        <Field label="Jam"><input type="time" value={v.dueTime} onChange={set('dueTime')} /></Field>
      </div>
      <Field label="Catatan"><textarea rows={3} maxLength={500} value={v.note} onChange={set('note')} /></Field>
      <div className="btn-row">
        <Btn variant="gold" type="submit">Simpan</Btn>
        {v.id && <Btn variant="red" type="button" onClick={onDelete}>Hapus</Btn>}
        <Btn variant="ghost" type="button" onClick={onCancel}>Batal</Btn>
      </div>
    </form>
  );
}

function ExtraForm({ value, schedule, onSave, onDelete, onCancel }: any) {
  const [v, setV] = useState({ classId: '', link: '', note: '', ...value });
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <Field label="Pengganti untuk" hint="(opsional)">
        <select value={v.classId} onChange={(e) => {
          const c = schedule.find((x: Kelas) => x.id === e.target.value);
          setV({ ...v, classId: e.target.value, name: c ? c.name : v.name, start: c ? c.start : v.start, end: c ? c.end : v.end });
        }}>
          <option value="">— Kuliah lain —</option>
          {schedule.map((c: Kelas) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Nama kuliah"><input required maxLength={80} value={v.name} onChange={set('name')} /></Field>
      <div className="grid3">
        <Field label="Tanggal"><input type="date" required value={v.date} onChange={set('date')} /></Field>
        <Field label="Mulai"><input type="time" required value={v.start} onChange={set('start')} /></Field>
        <Field label="Selesai"><input type="time" required value={v.end} onChange={set('end')} /></Field>
      </div>
      <Field label="Link kelas" hint="(opsional)"><input value={v.link} placeholder="https://" onChange={set('link')} /></Field>
      <Field label="Catatan"><input maxLength={200} value={v.note} onChange={set('note')} /></Field>
      <div className="btn-row">
        <Btn variant="gold" type="submit">Simpan</Btn>
        {v.id && <Btn variant="red" type="button" onClick={onDelete}>Hapus</Btn>}
        <Btn variant="ghost" type="button" onClick={onCancel}>Batal</Btn>
      </div>
    </form>
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
      <p className="muted small">Untuk meliburkan atau memindah satu pertemuan saja, pakai tab <b>Kalender</b>.</p>
      <div className="btn-row">
        <Btn variant="gold" type="submit">Simpan</Btn>
        {!isNew && <Btn variant="red" type="button" onClick={onDelete}>Hapus</Btn>}
        <Btn variant="ghost" type="button" onClick={onCancel}>Batal</Btn>
      </div>
    </form>
  );
}
