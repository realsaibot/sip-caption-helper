/**
 * github-sync.js
 *
 * Two-tier config:
 *   canRead()  — owner + repo known (explicit config OR auto-derived from GitHub Pages URL)
 *   canWrite() — token + owner + repo set explicitly
 *
 * This means a fresh PWA install on any device will ALWAYS auto-load
 * people.json from the public repo with zero setup.
 * The token is only needed to save changes.
 *
 * Auto-derivation: if the app is hosted at realsaibot.github.io/sip-caption-helper,
 * owner = "realsaibot", repo = "sip-caption-helper" — no config needed for reads.
 */
const GithubSync = (() => {

  const K = {
    token:  'gh_token',
    owner:  'gh_owner',
    repo:   'gh_repo',
    branch: 'gh_branch',
    sha:    'gh_sha',
  };

  const FILE = 'people.json';

  // ── Auto-derive owner/repo from GitHub Pages URL ─────────────────────────

  function deriveFromUrl() {
    const host = window.location.hostname;
    if (!host.endsWith('.github.io')) return null;
    const owner = host.replace('.github.io', '');
    // Path: /repo-name/... or just / for username.github.io
    const firstSegment = window.location.pathname.split('/').filter(Boolean)[0] || '';
    // If firstSegment looks like a repo name (not a page path like index.html)
    const repo = firstSegment && !firstSegment.includes('.') ? firstSegment : '';
    return { owner, repo: repo || owner + '.github.io' };
  }

  // ── Config ────────────────────────────────────────────────────────────────

  function getConfig() {
    return {
      token:  localStorage.getItem(K.token)  || '',
      owner:  localStorage.getItem(K.owner)  || '',
      repo:   localStorage.getItem(K.repo)   || '',
      branch: localStorage.getItem(K.branch) || 'main',
      sha:    localStorage.getItem(K.sha)    || null,
    };
  }

  /** Resolved owner/repo/branch — explicit config takes priority, URL-derived as fallback */
  function getReadConfig() {
    const c = getConfig();
    const derived = deriveFromUrl();
    return {
      owner:  c.owner  || derived?.owner  || '',
      repo:   c.repo   || derived?.repo   || '',
      branch: c.branch || 'main',
    };
  }

  function setConfig({ token, owner, repo, branch }) {
    if (token  !== undefined) localStorage.setItem(K.token,  token.trim());
    if (owner  !== undefined) localStorage.setItem(K.owner,  owner.trim());
    if (repo   !== undefined) localStorage.setItem(K.repo,   repo.trim());
    if (branch !== undefined) localStorage.setItem(K.branch, (branch || 'main').trim());
  }

  function clearConfig() {
    [K.token, K.owner, K.repo, K.branch, K.sha].forEach(k => localStorage.removeItem(k));
  }

  /** Can we READ? Just needs owner + repo (auto-derived is fine) */
  function canRead() {
    const r = getReadConfig();
    return !!(r.owner && r.repo);
  }

  /** Can we WRITE? Needs explicit token + owner + repo */
  function canWrite() {
    const c = getConfig();
    return !!(c.token && c.owner && c.repo);
  }

  /** Legacy alias used by options.js UI */
  function isConfigured() { return canWrite(); }

  // ── Encoding helpers ──────────────────────────────────────────────────────

  function toBase64(str) {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16))
      )
    );
  }

  // ── GitHub API helpers ────────────────────────────────────────────────────

  function apiHeaders(token) {
    return {
      'Authorization':         `Bearer ${token}`,
      'Accept':                'application/vnd.github+json',
      'Content-Type':          'application/json',
      'X-GitHub-Api-Version':  '2022-11-28',
    };
  }

  async function fetchSha(config) {
    const { token, owner, repo, branch } = config;
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${FILE}?ref=${branch}`,
      { headers: apiHeaders(token) }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    return (await res.json()).sha;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async function testConnection() {
    if (!canWrite()) throw new Error('Token not configured.');
    const { token, owner, repo } = getConfig();
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: apiHeaders(token) }
    );
    if (res.status === 401) throw new Error('Token invalid or expired.');
    if (res.status === 403) throw new Error('Token lacks permission for this repo.');
    if (res.status === 404) throw new Error('Repository not found. Check owner/repo name.');
    if (!res.ok)            throw new Error(`GitHub ${res.status}`);
    return (await res.json()).full_name;
  }

  /**
   * Load people.json from GitHub.
   * Works on ANY device/install — no token needed, uses public raw URL.
   * Returns parsed array, or null if unreachable / file missing.
   */
  async function load() {
    if (!canRead()) return null;
    const { owner, repo, branch } = getReadConfig();
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${FILE}?_=${Date.now()}`;
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn('GithubSync.load failed:', e);
      return null;
    }
  }

  /**
   * Save people.json to GitHub.
   * Requires token (canWrite()). Embeds photos from photosMap.
   * Auto-retries once on SHA conflict.
   */
  async function save(people, photosMap = {}) {
    if (!canWrite()) throw new Error('GitHub token not configured.');

    const config = getConfig();
    const { token, owner, repo, branch } = config;

    const exportData = people.map(p => ({ ...p, photo: photosMap[p.id] || '' }));
    const content    = toBase64(JSON.stringify(exportData, null, 2));

    const _doSave = async (sha) => {
      const body = {
        message: `Update people (${new Date().toISOString().slice(0, 10)})`,
        content,
        branch,
      };
      if (sha) body.sha = sha;
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${FILE}`,
        { method: 'PUT', headers: apiHeaders(token), body: JSON.stringify(body) }
      );
      if (res.status === 409) return 'conflict';
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
      const newSha = (await res.json()).content?.sha;
      if (newSha) localStorage.setItem(K.sha, newSha);
      return 'ok';
    };

    let result = await _doSave(config.sha);
    if (result === 'conflict') {
      const freshSha = await fetchSha(config);
      localStorage.setItem(K.sha, freshSha || '');
      result = await _doSave(freshSha);
      if (result === 'conflict') throw new Error('Save conflict — please reload and retry.');
    }
  }

  return { canRead, canWrite, isConfigured, getConfig, getReadConfig, setConfig, clearConfig, testConnection, load, save };
})();
