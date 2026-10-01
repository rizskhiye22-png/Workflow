'use client';
import { useEffect, type ReactNode } from 'react';
import { sfx } from '@/lib/client';

export const STATUS_TEXT: Record<string, string> = {
  building: 'Sedang deploy…', success: 'Deploy sukses', failed: 'Deploy gagal!',
  sleep: 'Tidur', idle: 'Santai', unknown: 'Tidak diketahui',
};

export function Panel({ title, icon, right, children, className = '' }: { title?: ReactNode; icon?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-head">
          <h2 className="ribbon">{icon && <span className={`pico pico-${icon}`} aria-hidden />}{title}</h2>
          {right}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'gold' | 'blue' | 'red' | 'ghost' | 'green'; block?: boolean };
export function Btn({ variant = 'blue', block, className = '', onClick, children, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={`gbtn gbtn-${variant} ${block ? 'block' : ''} ${className}`}
      onClick={(e) => { sfx('click'); onClick?.(e); }}
    >
      <span>{children}</span>
    </button>
  );
}

export function Pill({ status }: { status: string }) {
  return <span className={`pill st-${status}`}>{STATUS_TEXT[status] || status}</span>;
}

export function ErrorBox({ error }: { error: any }) {
  if (!error) return null;
  return <div className="alert" role="alert">⚠ {String(error.message || error)}</div>;
}

export function Loading({ text = 'Memuat…' }: { text?: string }) {
  return <div className="loading"><span className="spinner" aria-hidden /> {text}</div>;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    sfx('open');
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="sheet-bg" onClick={onClose} />
      <div className="sheet-win">
        <div className="win-bar">
          <span className="win-title">{title}</span>
          <button className="win-x" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="win-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}{hint && <small> {hint}</small>}</span>
      {children}
    </label>
  );
}
