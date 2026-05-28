# SIP Caption Helper — Project Context

## What this is
A PWA (Progressive Web App) hosted on **GitHub Pages** for building photo captions at the Service Information et Presse (SIP), Luxembourg.  
Live URL: https://realsaibot.github.io/sip-caption-helper/index.html  
Repo: https://github.com/realsaibot/sip-caption-helper

## Local working directory
`C:\Users\CGM422\Documents\sip-caption-helper-mobile\`  
This folder **is** the repo — edit here, then `git pull --rebase && git push` (or just `git push`, pulling if rejected).

## File map
| File | Purpose |
|------|---------|
| `index.html` | Builder UI (main page) |
| `builder.js` | Builder logic — loads people, renders search list, manages selection, copies caption |
| `options.html` | Options/database management UI |
| `options.js` | Options logic — add/edit/delete/import/export people, GitHub sync settings |
| `github-sync.js` | GitHub API sync — reads `people.json` from repo, writes it back with a token |
| `photo-db.js` | IndexedDB wrapper for storing face photos and face descriptors |
| `face-engine.js` | Face recognition (face-api.js) — extract descriptors, match faces in group photos |
| `crop-picker.js` | In-browser image crop UI |
| `sw.js` | Service worker for PWA offline support |
| `people.json` | The canonical people database committed to the repo (source of truth for GitHub sync) |

## Storage architecture
- **localStorage** — `people` array (JSON), `prefixEnabled`, `selectionDraft`, GitHub config (`gh_token`, `gh_owner`, `gh_repo`, `gh_branch`, `gh_sha`), `gh_pending_save` flag
- **IndexedDB** (via `photo-db.js`) — face photos (base64) and face descriptors per person ID
- **GitHub** — `people.json` in the repo is the cross-device sync source, read via raw CDN, written via GitHub Contents API

## Key design rules
- `gh_pending_save=1` in localStorage means local data is ahead of GitHub — the builder must NOT overwrite localStorage from a GitHub fetch while this flag is set
- `GithubSync.canRead()` = owner + repo known (auto-derived from the github.io hostname, no token needed)
- `GithubSync.canWrite()` = explicit token + owner + repo set
- The builder fetches from GitHub in the background after loading from localStorage — always protect local changes with `gh_pending_save`
- Person IDs are slugified from the `short` name and are stable (used as keys in IndexedDB)

## People data shape
```json
{ "id": "bettel", "short": "Xavier Bettel", "full": "Vice-Premier Ministre..., Xavier Bettel", "category": "Luxembourg", "photo": "" }
```

## Caption format
Entries joined with ` ; ` — optionally prefixed with `De gauche à droite : `

## Language
UI is in French. Caption text is in French.
