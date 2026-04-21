/**
 * github-sync.js
 *
 * Reads and writes people.json to a GitHub repository via the Contents API.
 * Photos are embedded as base64 in the JSON (same format as manual export).
 *
 * Storage keys in localStorage:
 *   gh_token   — Personal Access Token (fine-grained, contents R/W)
 *   gh_owner   — GitHub username / org
 *   gh_repo    — Repository name
 *   gh_branch  — Branch (default: main)
 *   gh_sha     — Cached SHA of people.json (needed for updates)
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

  // ── Config ───────────────────────────────────────────────────────────────

  function getConfig() {
    return {
      token:  localStorage.getItem(K.token)  || '',
      owner:  localStorage.getItem(K.owner)  || '',
      repo:   localStorage.getItem(K.repo)   || '',
      branch: localStorage.getItem(K.branch) || 'main',
      sha:    localStorage.getItem(K.sha)    || null,
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

  function isConfigured() {
    const c = getConfig();
    return !!(c.token && c.owner && c.repo);
  }

  // ── Encoding helpers ─────────────────────────────────────────────────────

  // btoa that handles Unicode (GitHub API needs base64 of UTF-8 bytes)
  function toBase64(str) {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16))
      )
    );
  }

  // Decode base64 back to UTF-8 string
  function fromBase64(b64) {
    return decodeURIComponent(
      atob(b64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')
    );
  }

  // ── GitHub API helpers ───────────────────────────────────────────────────

  function apiHeaders(token) {
    return {
      'Authorization': `Bearer ${token}`,
      'Accept':        'application/vnd.github+json',
      'Content-Type':  'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  /** Get current SHA of people.json (needed for PUT). Returns null if file doesn't exist. */
  async function fetchSha(config) {
    const { token, owner, repo, branch } = config;
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${FILE}?ref=${branch}`,
      { headers: apiHeaders(token) }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.sha;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Test connection — resolves with repo info or throws with a clear message.
   */
  async function testConnection() {
    const config = getConfig();
    if (!isConfigured()) throw new Error('Not configured.');

    const { token, owner, repo } = config;
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: apiHeaders(token) }
    );
    if (res.status === 401) throw new Error('Token invalid or expired.');
    if (res.status === 403) throw new Error('Token lacks permission for this repo.');
    if (res.status === 404) throw new Error('Repository not found. Check owner/repo name.');
    if (!res.ok)            throw new Error(`GitHub ${res.status}`);
    const data = await res.json();
    return data.full_name;
  }

  /**
   * Load people array from GitHub.
   * Uses raw URL (no size limit, no auth needed for public repos).
   * Returns array or null if file doesn't exist yet.
   */
  async function load() {
    if (!isConfigured()) return null;
    const { owner, repo, branch } = getConfig();

    // Cache-busting param so we always get the latest
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${FILE}?_=${Date.now()}`;
    const res = await fetch(url);
    if (res.status === 404) return null;   // file doesn't exist yet
    if (!res.ok) throw new Error(`Failed to load from GitHub: ${res.status}`);
    return await res.json();
  }

  /**
   * Save people array to GitHub.
   * people: plain array (no photo field — photos come from PhotoDB via caller)
   * photosMap: { [id]: base64 } — will be embedded into the JSON for transport
   *
   * On SHA conflict (409), automatically re-fetches SHA and retries once.
   */
  async function save(people, photosMap = {}) {
    if (!isConfigured()) throw new Error('GitHub not configured.');

    const config = getConfig();
    const { token, owner, repo, branch } = config;

    // Embed photos into export format
    const exportData = people.map(p => ({
      ...p,
      photo: photosMap[p.id] || ''
    }));

    const json    = JSON.stringify(exportData, null, 2);
    const content = toBase64(json);

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

      const data = await res.json();
      const newSha = data.content?.sha;
      if (newSha) localStorage.setItem(K.sha, newSha);
      return 'ok';
    };

    // Try with cached SHA first
    let result = await _doSave(config.sha);

    if (result === 'conflict') {
      // Re-fetch fresh SHA and retry once
      const freshSha = await fetchSha(config);
      localStorage.setItem(K.sha, freshSha || '');
      result = await _doSave(freshSha);
      if (result === 'conflict') throw new Error('Save conflict. Please reload and try again.');
    }
  }

  return { isConfigured, getConfig, setConfig, clearConfig, testConnection, load, save };
})();
