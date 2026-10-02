// Proyek baru: buat repo GitHub, pasang secret deploy, rekrut karyawan,
// dan siapkan file deploy (workflow GitHub Actions + wrangler.jsonc bila perlu).
import { HttpError } from './util.js';
import * as gh from './github.js';
import * as cf from './cloudflare.js';
import * as store from './store.js';

const REPO_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const WORKER_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DIR_RE = /^(\.|[A-Za-z0-9_.\/-]{1,80})$/;

export async function info(env) {
  const [me, subdomain] = await Promise.all([
    env.GITHUB_TOKEN ? gh.whoami(env).then((u) => u.login).catch(() => '') : '',
    env.CF_ACCOUNT_ID ? cf.workersSubdomain(env) : '',
  ]);
  return {
    githubUser: me,
    subdomain,
    deployTokenReady: !!(env.CF_DEPLOY_TOKEN && env.CF_ACCOUNT_ID),
  };
}

/** Cek apakah nama Worker / Pages sudah dipakai di Cloudflare (untuk form). */
export async function check(env, target, name) {
  if (!WORKER_RE.test(name || '')) return { valid: false };
  const sub = target === 'pages' ? '' : await cf.workersSubdomain(env);
  if (target === 'pages') {
    const r = await cf.pagesProjectInfo(env, name).catch(() => null);
    if (!r) return { valid: true, exists: null };
    return { valid: true, exists: r.exists, url: `https://${r.exists ? r.subdomain : `${name}.pages.dev`}` };
  }
  const ex = await cf.workerExists(env, name);
  return { valid: true, exists: ex, url: sub ? `https://${name}.${sub}.workers.dev` : '' };
}

/** Pasang CLOUDFLARE_API_TOKEN & CLOUDFLARE_ACCOUNT_ID ke secret repo. */
export async function installSecrets(env, owner, repo) {
  if (!env.CF_DEPLOY_TOKEN || !env.CF_ACCOUNT_ID) {
    throw new HttpError(400, 'Secret CF_DEPLOY_TOKEN belum diisi di Worker Kantor Bos (lihat Atur → Deploy otomatis).');
  }
  await gh.setRepoSecret(env, owner, repo, 'CLOUDFLARE_API_TOKEN', env.CF_DEPLOY_TOKEN);
  await gh.setRepoSecret(env, owner, repo, 'CLOUDFLARE_ACCOUNT_ID', env.CF_ACCOUNT_ID);
}

export function workflowYaml(o) {
  const install = o.hasPackage ? `
      - uses: actions/setup-node@v4
        with:
          node-version: 22
${o.hasLock ? '          cache: npm\n' : ''}
      - run: ${o.hasLock ? 'npm ci' : 'npm install'}
` : `
      - uses: actions/setup-node@v4
        with:
          node-version: 22
`;
  const build = o.buildCmd ? `
      - name: Build
        run: ${o.buildCmd}
` : '';
  let deploy = o.hasPackage && o.deployScript ? `npm run ${o.deployScript}` : 'npx -y wrangler@4 deploy';
  let prep = '';
  if (o.target === 'pages') {
    let dir = o.outDir.replace(/^\.\//, '');
    if (dir === '.' || dir === '') {
      // Situs di root repo: salin hanya file situs (tanpa .github, README, config) ke _site
      prep = `
      - name: Siapkan file situs
        run: |
          mkdir -p /tmp/_site
          tar -cf - --exclude='./.git*' --exclude='./node_modules' --exclude='./README*' \\
            --exclude='./package*.json' --exclude='./wrangler.*' --exclude='./.assetsignore' . | tar -xf - -C /tmp/_site
          mv /tmp/_site ./_site
`;
      dir = '_site';
    }
    deploy = `npx -y wrangler@4 pages deploy ${dir} --project-name ${o.pagesName} --branch main --commit-dirty=true`;
  }
  return `# Dibuat oleh Kantor Bos — deploy ke Cloudflare setiap push ke main.
# Secret CLOUDFLARE_API_TOKEN & CLOUDFLARE_ACCOUNT_ID dipasang otomatis oleh Kantor Bos.
name: Deploy ke Cloudflare

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v4

      - name: Cek secret
        run: |
          if [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
            echo "::error::Secret CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID belum ada. Buka Kantor Bos → Atur → proyek ini → Pasang deploy otomatis."
            exit 1
          fi
${install}${build}${prep}
      - name: Deploy ke Cloudflare ${o.target === 'pages' ? 'Pages' : 'Worker'}
        run: ${deploy}
`;
}

export function wranglerJson(o) {
  const cfg = {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: o.workerName,
    compatibility_date: '2026-09-01',
    assets: {
      directory: o.outDir === '.' ? './' : `./${o.outDir.replace(/^\.?\//, '')}`,
      not_found_handling: o.spa ? 'single-page-application' : '404-page',
    },
    observability: { enabled: true },
  };
  return `// Dibuat oleh Kantor Bos: situs statis disajikan oleh Cloudflare Worker (static assets).\n${JSON.stringify(cfg, null, 2)}\n`;
}

/**
 * Buat proyek baru. Mengembalikan file tambahan yang harus ikut di-push oleh browser.
 * Body: { name, worker, repo, private, workerName, kind, hasPackage, hasLock, buildCmd, deployScript, outDir, spa, overwrite }
 */
export async function create(env, b) {
  if (!env.GITHUB_TOKEN) throw new HttpError(400, 'GITHUB_TOKEN belum diatur');
  const name = String(b.name || '').trim();
  const repo = String(b.repo || '').trim();
  const workerName = String(b.workerName || '').trim();
  const kind = ['wrangler', 'build', 'static'].includes(b.kind) ? b.kind : null;
  const target = b.target === 'pages' ? 'pages' : 'worker';
  if (target === 'pages' && kind === 'wrangler') throw new HttpError(400, 'Proyek dengan wrangler config (Worker) tidak bisa dideploy ke Pages. Pilih Worker.');
  if (!name) throw new HttpError(400, 'Nama proyek wajib');
  if (!REPO_RE.test(repo)) throw new HttpError(400, 'Nama repo: huruf, angka, - _ .');
  if (!WORKER_RE.test(workerName)) throw new HttpError(400, `Nama ${target === 'pages' ? 'proyek Pages' : 'Worker'}: huruf kecil, angka, tanda - (maks 63, tidak diawali/diakhiri -)`);
  if (target === 'pages' && !(env.CF_DEPLOY_TOKEN && env.CF_ACCOUNT_ID)) throw new HttpError(400, 'Deploy ke Pages butuh CF_DEPLOY_TOKEN (untuk membuat proyek Pages). Isi dulu di Worker Kantor Bos.');
  if (!kind) throw new HttpError(400, 'Jenis proyek tidak dikenal');
  const outDir = String(b.outDir || '.').trim() || '.';
  if (kind !== 'wrangler' && (!DIR_RE.test(outDir) || outDir.split('/').includes('..'))) throw new HttpError(400, 'Folder hasil tidak valid');
  const buildCmd = kind === 'build' ? String(b.buildCmd || 'npm run build').replace(/[\r\n`$]/g, '').slice(0, 120) : '';
  const deployScript = /^[\w:-]{1,40}$/.test(b.deployScript || '') ? b.deployScript : '';

  const owner = (await gh.whoami(env)).login;
  const projects = await store.listProjects(env);
  if (projects.some((p) => p.owner.toLowerCase() === owner.toLowerCase() && p.repo.toLowerCase() === repo.toLowerCase())) {
    throw new HttpError(409, `Repo ${owner}/${repo} sudah dipegang karyawan lain di kantor. Pakai menu Upload untuk memperbaruinya.`);
  }

  // Keamanan: jangan menimpa Worker / repo yang sudah berisi tanpa izin eksplisit
  const [ri, cfx] = await Promise.all([
    gh.repoInfo(env, owner, repo),
    target === 'pages' ? cf.pagesProjectInfo(env, workerName) : cf.workerExists(env, workerName).then((e) => (e === null ? null : { exists: e })),
  ]);
  const cfExists = !!cfx?.exists;
  const warnings = [];
  if (ri.exists && !ri.empty) warnings.push(`Repo ${owner}/${repo} sudah ada dan berisi file — isinya akan DIGANTI dengan zip ini.`);
  if (cfExists) warnings.push(`${target === 'pages' ? 'Proyek Pages' : 'Worker'} "${workerName}" sudah ada di Cloudflare — situsnya akan DITIMPA oleh proyek ini.`);
  if (warnings.length && !b.overwrite) return { needConfirm: true, warnings };

  const steps = [];
  let repoUrl = ri.url;
  if (!ri.exists) {
    const r = await gh.createRepo(env, repo, { private: b.private !== false, description: `${name} — dibuat dari Kantor Bos` });
    repoUrl = r.url;
    steps.push(`Repo ${owner}/${repo} dibuat (${b.private !== false ? 'private' : 'public'})`);
  } else steps.push(`Memakai repo ${owner}/${repo} yang sudah ada`);

  let secrets = false;
  if (env.CF_DEPLOY_TOKEN && env.CF_ACCOUNT_ID) {
    await installSecrets(env, owner, repo);
    secrets = true;
    steps.push('Kunci deploy Cloudflare dipasang di secret repo');
  } else {
    steps.push('⚠ CF_DEPLOY_TOKEN belum ada: secret repo harus diisi manual');
  }

  let siteUrl = '';
  if (target === 'pages') {
    if (cfExists) {
      siteUrl = `https://${cfx.subdomain}`;
      steps.push(`Memakai proyek Pages "${workerName}" yang sudah ada`);
    } else {
      const pg = await cf.createPagesProject(env, workerName);
      siteUrl = `https://${pg.subdomain}`;
      steps.push(`Proyek Pages baru "${workerName}" dibuat di Cloudflare`);
    }
  } else {
    const sub = await cf.workersSubdomain(env);
    siteUrl = sub ? `https://${workerName}.${sub}.workers.dev` : '';
    steps.push(cfExists ? `Worker "${workerName}" yang sudah ada akan diperbarui` : `Worker baru "${workerName}" akan dibuat otomatis saat deploy pertama`);
  }
  const project = await store.saveProject(env, {
    name, worker: b.worker || name, owner, repo, branch: 'main',
    ...(target === 'pages' ? { pagesProject: workerName } : { workerName }),
    siteUrl,
  });
  steps.push(`Karyawan "${project.worker}" direkrut`);

  const files = [];
  if (!b.hasOwnWorkflow) {
    files.push({ path: '.github/workflows/deploy.yml', content: workflowYaml({ hasPackage: !!b.hasPackage, hasLock: !!b.hasLock, buildCmd, deployScript, target, outDir, pagesName: workerName }) });
  }
  if (kind !== 'wrangler' && target === 'worker') {
    files.push({ path: 'wrangler.jsonc', content: wranglerJson({ workerName, outDir, spa: !!b.spa }) });
    if (outDir === '.') {
      files.push({ path: '.assetsignore', content: '.git\n.wrangler\n.github\n.assetsignore\nwrangler.jsonc\nnode_modules\npackage.json\npackage-lock.json\nREADME.md\n.gitignore\n' });
    }
  }
  if (!b.hasGitignore) files.push({ path: '.gitignore', content: 'node_modules/\n.wrangler/\n.dev.vars\n.env\n.DS_Store\n' });

  return {
    project, files, secrets, steps, repoUrl, target,
    actionsUrl: `https://github.com/${owner}/${repo}/actions`,
  };
}
