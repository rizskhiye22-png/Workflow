'use client';
import { useEffect, useState } from 'react';
import { sfx } from '@/lib/client';

export default function LoginScreen() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [blink, setBlink] = useState(true);

  useEffect(() => {
    const iv = setInterval(() => setBlink((b) => !b), 550);
    return () => clearInterval(iv);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true); sfx('click');
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Gagal masuk');
      sfx('success');
      setTimeout(() => location.replace('/'), 350);
    } catch (x: any) {
      sfx('error'); setErr(x.message); setBusy(false);
    }
  };

  return (
    <div className="title-screen">
      <div className="crt" aria-hidden />
      <div className="stars" aria-hidden />
      <div className="skyline" aria-hidden />
      <form className="title-card" onSubmit={submit}>
        <img src="/icons/icon-512.png" alt="" width={88} height={88} className="title-boss pix" />
        <h1 className="title-logo">KANTOR<br /><span>BOS</span></h1>
        <p className="title-sub">Office Simulator · Edisi Pribadi</p>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" autoComplete="current-password" autoFocus required value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <button className="gbtn gbtn-gold block" type="submit" disabled={busy}>
          <span>{busy ? 'MEMBUKA PINTU…' : 'MASUK KANTOR'}</span>
        </button>
        <p className="press" aria-hidden style={{ visibility: blink ? 'visible' : 'hidden' }}>▶ PRESS START</p>
        {err && <p className="title-err" role="alert">{err}</p>}
      </form>
    </div>
  );
}
