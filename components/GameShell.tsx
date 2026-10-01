'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, sfx, soundOn, setSound, jstNow, HARI, pad, timeline } from '@/lib/client';

const TABS = [
  { href: '/', label: 'Kantor', icon: 'office' },
  { href: '/jadwal', label: 'Jadwal', icon: 'cal' },
  { href: '/upload', label: 'Upload', icon: 'up' },
  { href: '/data', label: 'Data', icon: 'db' },
  { href: '/riwayat', label: 'Log', icon: 'log' },
  { href: '/atur', label: 'Atur', icon: 'gear' },
];

type Stats = { pushes: number; level: number; xp: number; xpNeed: number };

export default function GameShell({ children }: { children: ReactNode }) {
  const path = usePathname() || '/';
  const [stats, setStats] = useState<Stats | null>(null);
  const [clock, setClock] = useState('');
  const [sound, setSnd] = useState(true);
  const [toasts, setToasts] = useState<any[]>([]);

  useEffect(() => {
    setSnd(soundOn());
    const load = () => api('/stats').then(setStats).catch(() => {});
    load();
    window.addEventListener('kb-stats', load);
    const t = () => {
      const n = jstNow();
      setClock(`${HARI[n.day].slice(0, 3).toUpperCase()} ${pad(Math.floor(n.min / 60))}:${pad(n.min % 60)}`);
    };
    t();
    const iv = setInterval(t, 1000);
    const onToast = (e: any) => {
      setToasts((x) => [...x.slice(-2), e.detail]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== e.detail.id)), 3800);
    };
    window.addEventListener('kb-toast', onToast);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { clearInterval(iv); window.removeEventListener('kb-toast', onToast); window.removeEventListener('kb-stats', load); };
  }, []);

  // Pengingat kuliah 15 menit sebelum mulai (selama aplikasi terbuka)
  useEffect(() => {
    const done = new Set<string>();
    let list: any[] | null = null;
    const check = async () => {
      try {
        if (localStorage.getItem('kb_remind') !== '1' || Notification.permission !== 'granted') return;
        list = list || (await api('/schedule'));
        for (const c of timeline(list)) {
          const key = `${c.id}-${new Date().toDateString()}`;
          if (!c.ongoing && c.until <= 15 && !done.has(key)) {
            done.add(key);
            const reg = await navigator.serviceWorker?.getRegistration();
            const opts = { body: `${HARI[c.day]} ${c.start}–${c.end} JST · mulai ${Math.ceil(c.until)} menit lagi`, icon: '/icons/icon-192.png', tag: key };
            if (reg) reg.showNotification(`📚 ${c.name}`, opts); else new Notification(`📚 ${c.name}`, opts);
          }
        }
      } catch {}
    };
    const iv = setInterval(check, 30_000);
    check();
    return () => clearInterval(iv);
  }, []);

  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const pct = stats ? Math.min(100, Math.round((stats.xp / Math.max(1, stats.xpNeed)) * 100)) : 0;

  return (
    <div className="game">
      <div className="crt" aria-hidden />
      <header className="hud">
        <div className="hud-avatar" aria-hidden><img src="/icons/icon-192.png" alt="" width={36} height={36} /></div>
        <div className="hud-main">
          <div className="hud-row">
            <span className="hud-name">BOS</span>
            <span className="hud-lv">LV {stats?.level ?? 1}</span>
          </div>
          <div className="xpbar" title={stats ? `${stats.xp}/${stats.xpNeed} XP` : ''}>
            <div className="xpfill" style={{ width: `${pct}%` }} />
            <span className="xptext">{stats ? `${stats.xp}/${stats.xpNeed} XP` : '— XP'}</span>
          </div>
        </div>
        <div className="hud-side">
          <span className="hud-coin" title="Total push"><i className="coin" aria-hidden />{stats?.pushes ?? 0}</span>
          <span className="hud-clock" title="Jam Jepang (JST)">{clock}</span>
        </div>
        <button
          className="hud-sound"
          aria-label={sound ? 'Matikan suara' : 'Nyalakan suara'}
          onClick={() => { const v = !sound; setSound(v); setSnd(v); if (v) sfx('coin'); }}
        >
          <span className={`pico pico-${sound ? 'sound' : 'mute'}`} aria-hidden />
        </button>
      </header>

      <main className="stage" key={path}>{children}</main>

      <nav className="hotbar" aria-label="Menu">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={`slot ${active(t.href) ? 'on' : ''}`} onClick={() => sfx('tab')}>
            <span className={`pico pico-${t.icon}`} aria-hidden />
            <span className="slot-label">{t.label}</span>
          </Link>
        ))}
      </nav>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`quest ${t.kind}`}>
            <span className="quest-tag">{t.kind === 'bad' ? 'GAGAL' : t.kind === 'ok' || t.kind === 'xp' ? 'SUKSES' : 'INFO'}</span>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
