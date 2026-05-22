// localStorage-backed storage shim
const storage = {
  async get(keys) {
    const result = {};
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      result[k] = raw !== null ? JSON.parse(raw) : undefined;
    }
    return result;
  },
  async set(obj) {
    for (const [k, v] of Object.entries(obj)) {
      localStorage.setItem(k, JSON.stringify(v));
    }
  }
};

const els = {
  search:        document.getElementById("search"),
  clearSearch:   document.getElementById("clearSearch"),
  peopleList:    document.getElementById("peopleList"),
  emptyState:    document.getElementById("emptyState"),
  count:         document.getElementById("count"),
  selection:     document.getElementById("selection"),
  selCount:      document.getElementById("selCount"),
  copyBtn:       document.getElementById("copyBtn"),
  clearBtn:      document.getElementById("clearBtn"),
  prefixToggle:  document.getElementById("prefixToggle"),
  openOptions:   document.getElementById("openOptions"),
  toast:         document.getElementById("toast"),
  recognizeBtn:  document.getElementById("recognizeBtn"),
  recognizeFile: document.getElementById("recognizeFile"),
};

let people       = [];
let selection    = [];
let prefixEnabled = false;
let photoCache   = {};

// ── Photo lightbox ────────────────────────────────────────────────────────────

function openPhotoLightbox(src, name) {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    background:rgba(0,0,0,0.85);
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
    -webkit-tap-highlight-color:transparent;cursor:pointer;
  `;

  const img = document.createElement("img");
  img.src = src;
  img.style.cssText = `
    width:220px;height:220px;border-radius:50%;object-fit:cover;
    border:3px solid rgba(255,255,255,0.3);
    box-shadow:0 8px 40px rgba(0,0,0,0.6);
  `;

  const label = document.createElement("div");
  label.textContent = name;
  label.style.cssText = `
    color:#fff;font:700 16px/1 system-ui;
    text-shadow:0 1px 4px rgba(0,0,0,0.5);
  `;

  const hint = document.createElement("div");
  hint.textContent = "Tap anywhere to close";
  hint.style.cssText = "color:rgba(255,255,255,0.4);font:13px system-ui;";

  overlay.appendChild(img);
  overlay.appendChild(label);
  overlay.appendChild(hint);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", () => document.body.removeChild(overlay));
}

// ── Avatar helpers ────────────────────────────────────────────────────────────

function getInitials(short) {
  const parts = String(short || "?").trim().split(/\s+/);
  return parts.length === 1
    ? parts[0][0].toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function makeAvatar(p, size) {
  const photo = photoCache[p.id] || null;
  if (photo) {
    const img = document.createElement("img");
    img.src = photo; img.alt = p.short;
    img.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid rgba(255,255,255,0.15);cursor:pointer;`;
    img.title = `View ${p.short}`;
    img.addEventListener("click", e => {
      e.stopPropagation(); // don't also trigger row click
      openPhotoLightbox(photo, p.short);
    });
    return img;
  }
  const div = document.createElement("div");
  div.textContent = getInitials(p.short);
  div.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0;background:rgba(255,255,255,0.07);border:2px solid rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size*0.34)}px;color:rgba(255,255,255,0.45);`;
  return div;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s)
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function normalize(s) { return String(s || "").toLowerCase().trim(); }

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");
  setTimeout(() => els.toast.classList.add("hidden"), 1200);
}

function slugify(s) {
  return String(s || "").toLowerCase().trim()
    .replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "").slice(0, 40) || "person";
}

function normalizePerson(x) {
  const short    = String(x.short    || "").trim();
  const full     = String(x.full     || "").trim();
  const category = String(x.category || "").trim();
  const id       = String(x.id       || "").trim() || slugify(short);
  return { id, short, full, category };
}

// ── Data ──────────────────────────────────────────────────────────────────────

async function loadData() {
  const res = await storage.get(["people", "prefixEnabled", "selectionDraft"]);

  people        = Array.isArray(res.people) ? res.people.map(normalizePerson).filter(p => p.short && p.full) : [];
  prefixEnabled = !!res.prefixEnabled;
  selection     = Array.isArray(res.selectionDraft) ? res.selectionDraft.map(normalizePerson).filter(p => p.short && p.full) : [];

  els.prefixToggle.checked = prefixEnabled;
  await storage.set({ people, selectionDraft: selection });

  // Load photos from IndexedDB into cache
  if (people.length) {
    photoCache = await PhotoDB.getMany(people.map(p => p.id));
  }

  // If GitHub can read (public URL — works even on fresh install with no token),
  // refresh data in background then re-render
  if (GithubSync.canRead()) {
    GithubSync.load()
      .then(async remote => {
        if (!remote) return;

        // If local data hasn't synced to GitHub yet, don't overwrite it
        if (localStorage.getItem('gh_pending_save') === '1') {
          console.info('Skipping GitHub overwrite — local has unsaved changes.');
          return;
        }

        const photoMap = {};
        const cleanedRemote = remote.map(x => {
          if (x.photo) photoMap[x.id || slugify(x.short || "")] = x.photo;
          return normalizePerson(x);
        }).filter(p => p.short && p.full);

        if (Object.keys(photoMap).length) await PhotoDB.setMany(photoMap);

        people = cleanedRemote;
        await storage.set({ people });
        photoCache = await PhotoDB.getMany(people.map(p => p.id));

        renderPeople();
      })
      .catch(e => console.warn("GitHub fetch failed on builder load:", e));
  }
}

function persistPrefix()    { storage.set({ prefixEnabled }); }
function persistSelection() { storage.set({ selectionDraft: selection }); }

function matchesPerson(p, query) {
  if (!query) return true;
  const q   = normalize(query);
  const hay = normalize(`${p.short} ${p.full} ${p.category || ""} ${p.id || ""}`);
  return hay.includes(q);
}

// ── Render people list ────────────────────────────────────────────────────────

function renderPeople() {
  const q        = els.search.value;
  const filtered = people.filter(p => matchesPerson(p, q));

  els.count.textContent = `${filtered.length}`;
  els.peopleList.innerHTML = "";
  els.emptyState.classList.toggle("hidden", filtered.length !== 0);

  for (const p of filtered) {
    const row = document.createElement("div");
    row.className = "person";
    row.style.cssText = "display:flex;align-items:center;gap:10px;";

    const textWrap = document.createElement("div");
    textWrap.style.cssText = "min-width:0;flex:1;";
    const cat = p.category ? `<span class="personCat">${escapeHtml(p.category)}</span>` : "";
    textWrap.innerHTML = `
      <div class="personName">${escapeHtml(p.short)}${cat}</div>
      <div class="personFull">${escapeHtml(p.full)}</div>
    `;

    row.appendChild(makeAvatar(p, 38));
    row.appendChild(textWrap);

    row.addEventListener("click", () => {
      selection.push({ ...p });
      persistSelection();
      renderSelection();
    });

    els.peopleList.appendChild(row);
  }
}

// ── Render selection ──────────────────────────────────────────────────────────

function renderSelection() {
  els.selCount.textContent = `${selection.length}`;
  els.selection.innerHTML = "";

  for (let i = 0; i < selection.length; i++) {
    const p = selection[i];

    const item = document.createElement("div");
    item.className = "selItem";
    item.style.cssText = "display:flex;align-items:center;gap:10px;";

    const left = document.createElement("div");
    left.className = "selTextWrap";
    left.style.cssText = "min-width:0;flex:1;";
    left.innerHTML = `
      <div class="selMeta">#${i+1} · ${escapeHtml(p.short)}${p.category ? " · " + escapeHtml(p.category) : ""}</div>
      <div class="selText">${escapeHtml(p.full)}</div>
    `;

    const btns = document.createElement("div");
    btns.className = "selBtns";

    const up = document.createElement("button");
    up.className = "iconBtn"; up.textContent = "↑"; up.title = "Move up"; up.disabled = i === 0;
    up.addEventListener("click", () => {
      if (i === 0) return;
      [selection[i-1], selection[i]] = [selection[i], selection[i-1]];
      persistSelection(); renderSelection();
    });

    const down = document.createElement("button");
    down.className = "iconBtn"; down.textContent = "↓"; down.title = "Move down"; down.disabled = i === selection.length - 1;
    down.addEventListener("click", () => {
      if (i === selection.length - 1) return;
      [selection[i+1], selection[i]] = [selection[i], selection[i+1]];
      persistSelection(); renderSelection();
    });

    const del = document.createElement("button");
    del.className = "iconBtn"; del.textContent = "✕"; del.title = "Remove";
    del.addEventListener("click", () => {
      selection.splice(i, 1);
      persistSelection(); renderSelection();
    });

    btns.appendChild(up); btns.appendChild(down); btns.appendChild(del);
    item.appendChild(makeAvatar(p, 36));
    item.appendChild(left);
    item.appendChild(btns);
    els.selection.appendChild(item);
  }

  const has = selection.length > 0;
  els.copyBtn.disabled  = !has;
  els.clearBtn.disabled = !has;
}

// ── Caption ───────────────────────────────────────────────────────────────────

function buildCaption() {
  const parts  = selection.map(p => String(p.full || "").trim()).filter(Boolean);
  const joined = parts.join(" ; ");
  if (!joined) return "";
  return prefixEnabled ? `De gauche à droite : ${joined}` : joined;
}

async function copyCaption() {
  const text = buildCaption();
  if (!text) return;
  const old = els.copyBtn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    els.copyBtn.textContent = "Copied ✅";
    showToast("Caption copied");
    setTimeout(() => (els.copyBtn.textContent = old), 900);
  } catch {
    showToast("Copy failed (clipboard blocked).");
  }
}

// ── RecognizeModal ────────────────────────────────────────────────────────────

const RecognizeModal = (() => {
  let _overlay = null;

  function _remove() {
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
  }

  function open(results, people) {
    _remove();

    // Build a quick id → person lookup
    const byId = {};
    for (const p of people) byId[p.id] = p;

    _overlay = document.createElement('div');
    _overlay.style.cssText = [
      'position:fixed;inset:0;z-index:9999;',
      'background:rgba(0,0,0,0.92);',
      'display:flex;flex-direction:column;',
      'align-items:center;justify-content:flex-start;',
      'overflow-y:auto;',
      '-webkit-tap-highlight-color:transparent;',
    ].join('');

    // ── Modal card ──────────────────────────────────────────────────────────
    const card = document.createElement('div');
    card.style.cssText = [
      'background:#1a1b20;border-radius:18px;',
      'padding:24px 20px 20px;margin:24px 16px;',
      'width:100%;max-width:480px;box-sizing:border-box;',
      'display:flex;flex-direction:column;gap:16px;',
    ].join('');
    card.addEventListener('click', e => e.stopPropagation());

    // Title
    const title = document.createElement('div');
    title.style.cssText = 'font:700 17px/1.3 system-ui;color:#fff;';
    title.textContent = `\uD83D\uDD0D Face Recognition \u2014 ${results.length} face${results.length !== 1 ? 's' : ''} detected`;
    card.appendChild(title);

    // Face rows
    const rows = []; // { el, matchId, checked }

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    for (const det of results) {
      const person   = det.matchId ? byId[det.matchId] || null : null;
      const isMatch  = !!person;
      const conf     = Math.round((1 - det.distance) * 100);
      const confColor = det.distance < 0.35 ? '#22c55e' : det.distance < 0.52 ? '#f59e0b' : '#9ca3af';

      const row = document.createElement('div');
      row.style.cssText = [
        'display:flex;align-items:center;gap:12px;',
        'background:rgba(255,255,255,0.05);border-radius:12px;padding:10px 12px;',
      ].join('');

      // Face thumbnail
      const thumb = document.createElement('div');
      thumb.style.cssText = [
        'width:48px;height:48px;border-radius:50%;flex-shrink:0;overflow:hidden;',
        'background:#374151;border:2px solid rgba(255,255,255,0.12);',
        'display:flex;align-items:center;justify-content:center;',
      ].join('');
      if (det.faceDataUrl) {
        const img = document.createElement('img');
        img.src = det.faceDataUrl;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        thumb.appendChild(img);
      } else {
        thumb.style.color = '#9ca3af';
        thumb.style.fontSize = '18px';
        thumb.textContent = '?';
      }

      // Info column
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';

      const nameEl = document.createElement('div');
      nameEl.style.cssText = `font:700 14px/1.3 system-ui;color:${isMatch ? '#fff' : '#9ca3af'};`;
      nameEl.textContent = isMatch ? person.short : 'Unknown';

      const confRow = document.createElement('div');
      confRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:4px;';

      const confBar = document.createElement('div');
      confBar.style.cssText = [
        `width:${Math.max(4, conf)}%;height:4px;border-radius:2px;`,
        `background:${confColor};transition:width 0.3s;`,
        'max-width:120px;',
      ].join('');

      const confLabel = document.createElement('div');
      confLabel.style.cssText = `font:12px system-ui;color:${confColor};`;
      confLabel.textContent = `${conf}%`;

      confRow.appendChild(confBar);
      confRow.appendChild(confLabel);
      info.appendChild(nameEl);
      info.appendChild(confRow);

      row.appendChild(thumb);
      row.appendChild(info);

      // Checkbox (only for matched faces)
      let checkbox = null;
      if (isMatch) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.style.cssText = 'width:18px;height:18px;flex-shrink:0;accent-color:#3b82f6;cursor:pointer;';
        checkbox.addEventListener('change', () => updateConfirmBtn());
        row.appendChild(checkbox);
      }

      list.appendChild(row);
      rows.push({ matchId: det.matchId, checkbox });
    }
    card.appendChild(list);

    // ── Bottom actions ──────────────────────────────────────────────────────
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;';

    const confirmBtn = document.createElement('button');
    confirmBtn.style.cssText = [
      'flex:1;padding:12px;border-radius:12px;border:none;cursor:pointer;',
      'background:#3b82f6;color:#fff;font:700 15px system-ui;',
    ].join('');

    function countChecked() {
      return rows.filter(r => r.checkbox && r.checkbox.checked).length;
    }
    function updateConfirmBtn() {
      const n = countChecked();
      confirmBtn.textContent = `Add ${n} ${n === 1 ? 'person' : 'people'} to selection`;
      confirmBtn.disabled = n === 0;
    }
    updateConfirmBtn();

    confirmBtn.addEventListener('click', () => {
      for (const r of rows) {
        if (r.checkbox && r.checkbox.checked && r.matchId) {
          const p = byId[r.matchId];
          if (p) selection.push({ ...p });
        }
      }
      persistSelection();
      renderSelection();
      _remove();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = [
      'padding:12px 18px;border-radius:12px;border:1.5px solid rgba(255,255,255,0.2);',
      'background:transparent;color:rgba(255,255,255,0.7);font:700 15px system-ui;cursor:pointer;',
    ].join('');
    cancelBtn.addEventListener('click', _remove);

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    card.appendChild(actions);

    _overlay.appendChild(card);
    _overlay.addEventListener('click', _remove);
    document.body.appendChild(_overlay);
  }

  return { open };
})();

// ── Events ────────────────────────────────────────────────────────────────────

els.search.addEventListener("input", renderPeople);
els.clearSearch.addEventListener("click", () => { els.search.value = ""; renderPeople(); els.search.focus(); });
els.copyBtn.addEventListener("click", copyCaption);
els.clearBtn.addEventListener("click", () => { selection = []; persistSelection(); renderSelection(); });
els.prefixToggle.addEventListener("change", () => { prefixEnabled = els.prefixToggle.checked; persistPrefix(); });
els.openOptions.addEventListener("click", () => { window.location.href = "options.html"; });

// ── Recognition trigger ───────────────────────────────────────────────────────

els.recognizeBtn.addEventListener('click', () => els.recognizeFile.click());

els.recognizeFile.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  showToast('Analyzing faces\u2026');

  try {
    const allDescriptors = await PhotoDB.getAllDescriptors();
    const peopleWithDesc = people
      .map(p => ({ ...p, descriptor: allDescriptors[p.id] || null }))
      .filter(p => p.descriptor);

    if (!peopleWithDesc.length) {
      showToast('No face data yet \u2014 add photos to people in Options first.');
      return;
    }

    const results = await FaceEngine.recognizeGroup(file, peopleWithDesc);

    if (!results.length) {
      showToast('No faces detected in this photo.');
      return;
    }

    RecognizeModal.open(results, people);
  } catch (err) {
    console.error(err);
    showToast('Recognition failed: ' + err.message);
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  els.search.value = ""; // clear any browser-retained filter value
  await loadData();
  renderPeople();
  renderSelection();
}

// Re-run init when browser restores the page from bfcache (back/forward nav).
// Without this: selection array is intact in memory but the right panel DOM
// was never re-rendered, so items appear missing until the first click.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) init();
});

init();
