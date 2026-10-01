'use client';
// Alur push ke GitHub yang dipakai bersama oleh layar Upload & Proyek Baru.
import { unzipSync } from 'fflate';
import { api } from './client';

export type PFile = { path: string; data: Uint8Array; sha?: string };
type Log = (t: string, c?: string) => void;

const SKIP_DIRS = new Set(['node_modules', '.git', '__MACOSX', '.wrangler', '.next', '.vercel', 'dist-ssr', '.cloudflare', '.vinext']);
const SECRET = /^(\.env(\..+)?|\.dev\.vars)$/;
export function skipReason(path: string) {
  const parts = path.split('/');
  if (parts.some((p) => SKIP_DIRS.has(p))) return 'folder diabaikan';
  const base = parts[parts.length - 1];
  if (base === '.DS_Store' || base === 'Thumbs.db' || base === 'desktop.ini') return 'sampah sistem';
  if (SECRET.test(base) && !/\.(example|sample)$/.test(base)) return 'file rahasia';
  return null;
}

async function gitSha(data: Uint8Array) {
  const head = new TextEncoder().encode(`blob ${data.length}\0`);
  const all = new Uint8Array(head.length + data.length);
  all.set(head); all.set(data, head.length);
  const h = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function toB64(u8: Uint8Array) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000) as any);
  return btoa(s);
}
export const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

/** Baca zip atau file lepas → daftar file bersih (tanpa node_modules, .env, dll). */
export async function readFiles(picked: File[], opts: { unwrap: boolean; prefix: string }, log: Log): Promise<PFile[]> {
  const isZip = picked.length === 1 && /\.zip$/i.test(picked[0].name);
  let raw: Record<string, Uint8Array>;
  if (isZip) {
    log('Membuka peti zip…');
    raw = unzipSync(new Uint8Array(await picked[0].arrayBuffer()));
  } else {
    if (!opts.prefix.trim()) throw new Error('Isi "Folder tujuan di repo" dulu, contoh: public/media/audio/2019-07');
    log(`Membaca ${picked.length} file…`);
    raw = {};
    for (const f of picked) raw[f.name] = new Uint8Array(await f.arrayBuffer());
  }
  let files: PFile[] = [];
  const skipped: Record<string, number> = {};
  for (const [path, data] of Object.entries(raw)) {
    if (path.endsWith('/')) continue;
    const why = skipReason(path);
    if (why) { skipped[why] = (skipped[why] || 0) + 1; continue; }
    files.push({ path, data });
  }
  if (opts.unwrap && files.length && files.every((f) => f.path.includes('/') && f.path.split('/')[0] === files[0].path.split('/')[0])) {
    const root = files[0].path.split('/')[0] + '/';
    files = files.map((f) => ({ ...f, path: f.path.slice(root.length) }));
    log(`Folder pembungkus "${root}" dilepas`, 'muted');
  }
  const pre = opts.prefix.trim().replace(/^\/+|\/+$/g, '');
  if (pre) {
    if (pre.split('/').some((x) => !x || x === '.' || x === '..')) throw new Error('Folder tujuan tidak valid');
    files = files.map((f) => ({ ...f, path: `${pre}/${f.path}` }));
    log(`File ditaruh di folder "${pre}/"`, 'muted');
  }
  if (!files.length) throw new Error('Tidak ada file setelah disaring');
  for (const [why, n] of Object.entries(skipped)) log(`Dilewati ${n} file (${why})`, why === 'file rahasia' ? 'warn' : 'muted');
  if (skipped['file rahasia']) log('File .env/.dev.vars tidak di-push supaya rahasia aman.', 'warn');
  const big = files.find((f) => f.data.length > 50 * 1048576);
  if (big) throw new Error(`${big.path} lebih dari 50 MB — ditolak GitHub`);
  log(`${files.length} file siap.`);
  return files;
}

export type Review = { changed: string[]; deleted: string[]; total: number };

/**
 * Push daftar file ke repo proyek sebagai satu commit.
 * confirm() dipanggil dengan ringkasan perubahan sebelum upload; kembalikan false untuk batal.
 */
export async function pushFiles(projectId: string, files: PFile[], o: {
  mode: 'replace' | 'merge'; message: string; log: Log; progress: (p: number) => void; confirm: (r: Review) => Promise<boolean>;
}) {
  const { log, progress } = o;
  log('Menghubungi GitHub…');
  const start = await api('/push/start', { method: 'POST', body: { projectId } });
  if (start.newBranch) log(`Branch "${start.branch}" akan dibuat.`);
  for (const f of files) f.sha = await gitSha(f.data);
  progress(0.2);

  const existing = start.tree as Record<string, { sha: string; mode: string }>;
  const changed = files.filter((f) => existing[f.path]?.sha !== f.sha);
  const paths = new Set(files.map((f) => f.path));
  const hasGithub = files.some((f) => f.path.startsWith('.github/'));
  const kept = Object.entries(existing).filter(([p]) => !paths.has(p) && p.startsWith('.github/') && !hasGithub);
  const keptSet = new Set(kept.map(([p]) => p));
  const deleted = o.mode === 'replace' ? Object.keys(existing).filter((p) => !paths.has(p) && !keptSet.has(p) && p !== '.kantor-bos') : [];
  log(`${changed.length} file berubah, ${deleted.length} file dihapus.`);
  if (!changed.length && !deleted.length) { progress(1); log('Tidak ada perubahan.', 'ok'); return { unchanged: true }; }
  if (!(await o.confirm({ changed: changed.map((f) => f.path), deleted, total: Object.keys(existing).length }))) {
    log('Dibatalkan. Repo tidak diubah.', 'warn'); progress(0); return { cancelled: true };
  }

  const batches: PFile[][] = [];
  let cur: PFile[] = [], size = 0;
  for (const f of changed) {
    if (cur.length && (cur.length >= 40 || size + f.data.length > 12 * 1048576)) { batches.push(cur); cur = []; size = 0; }
    cur.push(f); size += f.data.length;
  }
  if (cur.length) batches.push(cur);
  let done = 0;
  for (const b of batches) {
    const res = await api('/push/blobs', { method: 'POST', body: { projectId, files: b.map((f) => ({ path: f.path, b64: toB64(f.data) })) } });
    for (const r of res) { const f = b.find((x) => x.path === r.path)!; f.sha = r.sha; }
    done += b.length;
    log(`Upload ${done}/${changed.length} file`);
    progress(0.2 + 0.7 * (done / changed.length));
  }
  const entries = o.mode === 'replace'
    ? [...files.map((f) => ({ path: f.path, sha: f.sha, mode: existing[f.path]?.mode || '100644' })), ...kept.map(([path, e]) => ({ path, sha: e.sha, mode: e.mode }))]
    : changed.map((f) => ({ path: f.path, sha: f.sha, mode: existing[f.path]?.mode || '100644' }));

  log('Membuat commit…');
  const fin = await api('/push/finish', {
    method: 'POST',
    body: { projectId, message: o.message, entries, base: o.mode === 'merge',
      parentSha: start.parentSha, parentTree: start.parentTree, newBranch: start.newBranch, changedCount: changed.length + deleted.length },
  });
  progress(1);
  window.dispatchEvent(new Event('kb-stats'));
  return fin;
}

// ---------------- Deteksi jenis proyek ----------------
export type Detected = {
  kind: 'wrangler' | 'build' | 'static' | 'unknown';
  label: string;
  framework: string;
  workerName: string;
  hasPackage: boolean; hasLock: boolean; buildCmd: string; deployScript: string;
  outDir: string; spa: boolean; hasOwnWorkflow: boolean; hasGitignore: boolean;
  warnings: string[];
};

const text = (f?: PFile) => (f ? new TextDecoder().decode(f.data) : '');
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'proyek-baru';

export function detectProject(files: PFile[]): Detected {
  const by = new Map(files.map((f) => [f.path, f]));
  const warnings: string[] = [];
  const pkgFile = by.get('package.json');
  let pkg: any = null;
  try { pkg = pkgFile ? JSON.parse(text(pkgFile)) : null; } catch { warnings.push('package.json tidak bisa dibaca (JSON rusak).'); }
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const scripts = pkg?.scripts || {};
  const hasLock = by.has('package-lock.json');
  const hasOwnWorkflow = files.some((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f.path));
  const base = {
    hasPackage: !!pkg, hasLock, hasOwnWorkflow, hasGitignore: by.has('.gitignore'),
    deployScript: scripts['deploy:ci'] ? 'deploy:ci' : '', warnings,
  };
  if (by.has('yarn.lock') || by.has('pnpm-lock.yaml')) warnings.push('Memakai yarn/pnpm — deploy otomatis memakai npm install. Biasanya tetap jalan.');

  const wcfg = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'].find((n) => by.has(n));
  if (wcfg) {
    const t = text(by.get(wcfg));
    const m = wcfg.endsWith('toml') ? t.match(/^\s*name\s*=\s*["']([^"']+)["']/m) : t.match(/"name"\s*:\s*"([^"]+)"/);
    if (/GANTI|REPLACE|your[-_]?id|<.*id.*>/i.test(t)) warnings.push(`${wcfg} masih berisi ID placeholder (D1/KV). Hapus baris "id"/"database_id" supaya wrangler membuat/memakai resource otomatis.`);
    if (hasOwnWorkflow) warnings.push('Proyek sudah punya workflow GitHub sendiri — Kantor Bos tidak menambah workflow baru, tapi tetap memasang secret CLOUDFLARE_API_TOKEN & CLOUDFLARE_ACCOUNT_ID.');
    return { ...base, kind: 'wrangler', label: 'Worker (punya wrangler config)', framework: 'Cloudflare Worker', workerName: m?.[1] || '', buildCmd: '', outDir: '.', spa: false };
  }

  const fw = deps.next ? 'Next.js' : deps.astro ? 'Astro' : deps['@sveltejs/kit'] ? 'SvelteKit' : deps.nuxt ? 'Nuxt'
    : deps.vite ? (deps.react ? 'Vite + React' : deps.vue ? 'Vite + Vue' : deps.svelte ? 'Vite + Svelte' : 'Vite')
    : deps['react-scripts'] ? 'Create React App' : '';
  if (pkg && scripts.build) {
    if (fw === 'Next.js') warnings.push('Next.js dengan server (bukan "output: export") butuh setup khusus. Kalau hasil build gagal, minta bantuan Claude untuk pasang vinext/OpenNext.');
    if (fw === 'Nuxt' || fw === 'SvelteKit') warnings.push(`${fw} mode server butuh adapter Cloudflare. Mode statis/SPA tetap bisa.`);
    const outDir = fw === 'Next.js' ? 'out' : fw === 'Create React App' ? 'build' : fw === 'Nuxt' ? '.output/public' : fw === 'SvelteKit' ? 'build' : 'dist';
    const spa = /React|Vue|Svelte|Vite|Create React/.test(fw);
    return { ...base, kind: 'build', label: `Situs perlu build${fw ? ` (${fw})` : ''}`, framework: fw || 'Node', workerName: '', buildCmd: 'npm run build', outDir, spa };
  }

  const roots = ['index.html', 'public/index.html', 'dist/index.html', 'docs/index.html', 'site/index.html'];
  const idx = roots.find((r) => by.has(r));
  if (idx) {
    const outDir = idx.includes('/') ? idx.split('/')[0] : '.';
    return { ...base, kind: 'static', label: 'Situs statis (HTML/CSS/JS)', framework: 'HTML', workerName: '', buildCmd: '', outDir, spa: false };
  }
  warnings.push('Tidak menemukan index.html, package.json dengan script build, atau wrangler config. Pilih jenis & folder secara manual.');
  return { ...base, kind: 'unknown', label: 'Tidak dikenali', framework: '', workerName: '', buildCmd: '', outDir: '.', spa: false };
}
