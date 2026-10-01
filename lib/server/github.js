import { HttpError, mapLimit, shortText } from './util.js';

const GH = 'https://api.github.com';

async function ghFetch(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) throw new HttpError(400, 'GITHUB_TOKEN belum diatur');
  const res = await fetch(GH + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kantor-bos',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch {}
    if (res.status === 404 && path.includes('/workflows')) msg += ' (token butuh izin Workflows)';
    if (/workflow/i.test(msg) && res.status !== 404) msg += ' — tambahkan izin "Workflows: Read and write" di token GitHub.';
    // Status GitHub tidak diteruskan apa adanya, supaya 401 GitHub tidak dikira sesi dashboard habis.
    const err = new HttpError(502, `GitHub ${res.status}: ${shortText(msg)}`);
    err.ghStatus = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

const repoPath = (p) => `/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}`;
const branchPath = (b) => b.split('/').map(encodeURIComponent).join('/');

export async function whoami(env) {
  return ghFetch(env, '/user');
}

async function getHead(env, p, branch) {
  try {
    const ref = await ghFetch(env, `${repoPath(p)}/git/ref/heads/${branchPath(branch)}`);
    const commit = await ghFetch(env, `${repoPath(p)}/git/commits/${ref.object.sha}`);
    return { sha: ref.object.sha, tree: commit.tree.sha };
  } catch (e) {
    if (e.ghStatus === 404 || e.ghStatus === 409) return null; // branch belum ada / repo kosong
    throw e;
  }
}

/** Ambil commit terakhir + isi tree (path -> sha) untuk dibandingkan di browser. */
export async function pushStart(env, p) {
  let repo;
  try {
    repo = await ghFetch(env, repoPath(p));
  } catch (e) {
    if (e.ghStatus === 404) throw new HttpError(404, `Repo ${p.owner}/${p.repo} tidak ditemukan, atau token GitHub tidak punya akses ke repo ini.`);
    throw e;
  }

  let head = await getHead(env, p, p.branch);
  let newBranch = false;
  if (!head) {
    let def = await getHead(env, p, repo.default_branch);
    if (!def) {
      // Repo masih kosong: buat commit pertama supaya Git Data API bisa dipakai.
      await ghFetch(env, `${repoPath(p)}/contents/.kantor-bos`, {
        method: 'PUT',
        body: JSON.stringify({ message: 'Inisialisasi repo dari Kantor Bos', content: btoa('dibuat oleh Kantor Bos\n') }),
      });
      repo = await ghFetch(env, repoPath(p));
      def = await getHead(env, p, repo.default_branch);
      if (!def) throw new HttpError(502, 'Gagal menginisialisasi repo kosong');
    }
    head = def;
    newBranch = p.branch !== repo.default_branch;
  }

  const t = await ghFetch(env, `${repoPath(p)}/git/trees/${head.tree}?recursive=1`);
  const tree = {};
  for (const e of t.tree || []) if (e.type === 'blob') tree[e.path] = { sha: e.sha, mode: e.mode };
  return { parentSha: head.sha, parentTree: head.tree, newBranch, truncated: !!t.truncated, tree, branch: p.branch };
}

export async function pushBlobs(env, p, files) {
  if (!Array.isArray(files) || !files.length) throw new HttpError(400, 'Tidak ada file');
  if (files.length > 40) throw new HttpError(400, 'Maksimal 40 file per batch');
  return mapLimit(files, 6, async (f) => {
    checkPath(f.path);
    const r = await ghFetch(env, `${repoPath(p)}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: String(f.b64 || ''), encoding: 'base64' }),
    });
    return { path: f.path, sha: r.sha };
  });
}

function checkPath(path) {
  if (typeof path !== 'string' || !path || path.length > 400 || path.startsWith('/') ||
      path.split('/').some((s) => s === '' || s === '.' || s === '..' || s === '.git')) {
    throw new HttpError(400, `Path file tidak valid: ${shortText(path, 80)}`);
  }
}

export async function pushFinish(env, p, body) {
  const { parentSha, parentTree, newBranch, base, entries } = body;
  const message = String(body.message || '').trim().slice(0, 500) || 'Update dari Kantor Bos';
  if (!/^[0-9a-f]{40}$/.test(parentSha || '') || !/^[0-9a-f]{40}$/.test(parentTree || '')) {
    throw new HttpError(400, 'parentSha / parentTree tidak valid');
  }
  if (!Array.isArray(entries)) throw new HttpError(400, 'entries harus array');
  if (!base && !entries.length) throw new HttpError(400, 'Zip kosong — tidak ada file untuk di-push');

  const tree = entries.map((e) => {
    checkPath(e.path);
    if (!/^[0-9a-f]{40}$/.test(e.sha || '')) throw new HttpError(400, `SHA tidak valid untuk ${e.path}`);
    const mode = ['100644', '100755', '120000'].includes(e.mode) ? e.mode : '100644';
    return { path: e.path, mode, type: 'blob', sha: e.sha };
  });
  for (const d of body.deletions || []) {
    checkPath(d);
    tree.push({ path: d, mode: '100644', type: 'blob', sha: null });
  }

  const newTree = await ghFetch(env, `${repoPath(p)}/git/trees`, {
    method: 'POST',
    body: JSON.stringify(base ? { base_tree: parentTree, tree } : { tree }),
  });
  if (newTree.sha === parentTree) return { unchanged: true };

  const commit = await ghFetch(env, `${repoPath(p)}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [parentSha] }),
  });

  if (newBranch) {
    await ghFetch(env, `${repoPath(p)}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${p.branch}`, sha: commit.sha }),
    });
  } else {
    try {
      await ghFetch(env, `${repoPath(p)}/git/refs/heads/${branchPath(p.branch)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
    } catch (e) {
      if (e.ghStatus === 422) throw new HttpError(409, 'Branch berubah sejak upload dimulai (ada commit lain). Ulangi upload.');
      throw e;
    }
  }
  return { sha: commit.sha, url: `https://github.com/${p.owner}/${p.repo}/commit/${commit.sha}`, message };
}

export async function latestRuns(env, p) {
  const r = await ghFetch(env, `${repoPath(p)}/actions/runs?per_page=6&branch=${encodeURIComponent(p.branch)}`);
  return (r.workflow_runs || []).map((w) => ({
    id: w.id,
    name: w.name,
    title: w.display_title,
    status: w.status,
    conclusion: w.conclusion,
    created_at: w.created_at,
    url: w.html_url,
  }));
}
