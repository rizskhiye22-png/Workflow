// Laporan Bos + tugas terjadwal (dijalankan Cron Trigger tiap 5 menit).
import * as store from './store.js';
import * as push from './webpush.js';
import { summarizeProject } from './api.js';
import {
  jstDate, jstMinutes, addDays, occurrencesOn, occurrencesRange, pendingSessions, taskDueTs, toMin, HARI, dayOf,
} from '../kuliah.js';

const MIN = 60_000;

/** Ringkasan hari ini: kuliah, tugas, proyek bermasalah. Dipakai di layar Kantor & push pagi. */
export async function buildReport(env, now = Date.now()) {
  const [data, laststatus] = await Promise.all([store.getKuliahAll(env), env.DASH_KV.get('laststatus', 'json')]);
  const today = jstDate(now);
  const classes = occurrencesOn(today, data).map((o) => ({ name: o.name, start: o.start, end: o.end, status: o.status, extra: o.extra }));
  const soon = addDays(today, 2);
  const tasks = data.tasks
    .filter((t) => !t.done && t.due && t.due <= soon)
    .map((t) => ({ id: t.id, title: t.title, due: t.due, dueTime: t.dueTime, overdue: taskDueTs(t) < now }))
    .sort((a, b) => (a.due + (a.dueTime || '23:59')).localeCompare(b.due + (b.dueTime || '23:59')));
  const failed = Object.values(laststatus || {}).filter((x) => x.status === 'failed').map((x) => x.name);
  const pending = pendingSessions(data, 7, now).length;

  const lines = [];
  const active = classes.filter((c) => c.status !== 'libur');
  if (active.length) lines.push(`📚 ${active.length} kuliah: ${active.map((c) => `${c.start} ${c.name}`).join(', ')}`);
  else lines.push('📚 Tidak ada kuliah hari ini');
  const libur = classes.filter((c) => c.status === 'libur');
  if (libur.length) lines.push(`🏖 Libur: ${libur.map((c) => c.name).join(', ')}`);
  const overdue = tasks.filter((t) => t.overdue);
  if (overdue.length) lines.push(`⏰ ${overdue.length} tugas lewat tenggat`);
  const dueSoon = tasks.filter((t) => !t.overdue);
  if (dueSoon.length) lines.push(`📝 ${dueSoon.length} tugas tenggat ≤2 hari: ${dueSoon.slice(0, 3).map((t) => t.title).join(', ')}`);
  if (pending) lines.push(`✅ ${pending} sesi kuliah belum dicentang`);
  if (failed.length) lines.push(`💥 Deploy gagal: ${failed.join(', ')}`);

  return { date: today, day: HARI[dayOf(today)], classes, tasks, failed, pending, lines };
}

async function once(env, key, ttl) {
  if (await env.DASH_KV.get(key)) return false;
  await env.DASH_KV.put(key, '1', { expirationTtl: ttl });
  return true;
}

export async function runCron(env, now = Date.now()) {
  const subs = await push.listSubs(env);
  const settings = await store.getNotify(env);
  const notes = [];
  const data = await store.getKuliahAll(env);
  const today = jstDate(now);

  if (subs.length) {
    // 1. Pengingat kuliah
    for (const o of occurrencesRange(today, 2, data)) {
      if (o.status === 'libur') continue;
      const until = (o.startTs - now) / MIN;
      if (until > 0 && until <= settings.classLead && (await once(env, `sent:class:${o.key}`, 3 * 86400))) {
        notes.push({
          title: `📚 ${o.name}`,
          body: `Mulai ${o.start} JST (${Math.ceil(until)} menit lagi)${o.extra ? ' · kuliah tambahan' : ''}`,
          tag: `class-${o.key}`, url: '/jadwal',
        });
      }
    }
    // 2. Pengingat tenggat tugas
    for (const t of data.tasks) {
      if (t.done || !t.due) continue;
      const until = (taskDueTs(t) - now) / MIN;
      if (until > 0 && until <= settings.taskLead && (await once(env, `sent:task:${t.id}:${t.due}${t.dueTime}`, 3 * 86400))) {
        notes.push({ title: `📝 Tenggat: ${t.title}`, body: `${t.due} ${t.dueTime || '23:59'} JST · ${Math.ceil(until)} menit lagi`, tag: `task-${t.id}`, url: '/jadwal?tab=tugas' });
      }
    }
    // 3. Laporan pagi
    const m = jstMinutes(now);
    const target = toMin(settings.morningTime);
    if (settings.morning && m >= target && m < target + 180 && (await once(env, `sent:morning:${today}`, 2 * 86400))) {
      const r = await buildReport(env, now);
      notes.push({ title: `☀️ Laporan pagi Bos · ${r.day}`, body: r.lines.join('\n'), tag: `morning-${today}`, url: '/' });
    }
  }

  // 4. Perubahan status deploy (selalu dicatat, notifikasi hanya jika ada perangkat)
  const projects = await store.listProjects(env);
  if (projects.length) {
    const prev = (await env.DASH_KV.get('laststatus', 'json')) || {};
    const next = {};
    let changed = false;
    await Promise.all(projects.map(async (p) => {
      try {
        const s = await summarizeProject(env, p);
        next[p.id] = { name: p.worker || p.name, status: s.status, time: s.lastTime || 0 };
        const before = prev[p.id];
        if (!before || before.status !== s.status || before.time !== next[p.id].time) changed = true;
        if (before && before.status !== s.status && settings.deploy && subs.length) {
          if (s.status === 'success') notes.push({ title: `✅ ${p.worker || p.name}: deploy sukses`, body: s.message || p.name, tag: `deploy-${p.id}`, url: '/' });
          if (s.status === 'failed') notes.push({ title: `💥 ${p.worker || p.name}: deploy gagal!`, body: s.message || p.name, tag: `deploy-${p.id}`, url: `/riwayat?p=${p.id}` });
        }
      } catch (e) {
        next[p.id] = prev[p.id] || { name: p.worker || p.name, status: 'unknown', time: 0 };
      }
    }));
    if (changed || Object.keys(prev).length !== Object.keys(next).length) await env.DASH_KV.put('laststatus', JSON.stringify(next));
  }

  for (const n of notes) await push.broadcast(env, n);
  return { sent: notes.length };
}
