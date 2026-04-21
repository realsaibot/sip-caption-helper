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
  search:       document.getElementById("search"),
  clearSearch:  document.getElementById("clearSearch"),
  peopleList:   document.getElementById("peopleList"),
  emptyState:   document.getElementById("emptyState"),
  count:        document.getElementById("count"),
  selection:    document.getElementById("selection"),
  selCount:     document.getElementById("selCount"),
  copyBtn:      document.getElementById("copyBtn"),
  clearBtn:     document.getElementById("clearBtn"),
  prefixToggle: document.getElementById("prefixToggle"),
  openOptions:  document.getElementById("openOptions"),
  toast:        document.getElementById("toast")
};

let people       = [];
let selection    = [];
let prefixEnabled = false;
let photoCache   = {}; // { [personId]: base64 } — loaded once from IndexedDB

// ── Photo / avatar ────────────────────────────────────────────────────────────

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
    img.src = photo;
    img.alt = p.short;
    img.style.cssText = `
      width:${size}px; height:${size}px; border-radius:50%;
      object-fit:cover; flex-shrink:0;
      border:2px solid rgba(255,255,255,0.15);
    `;
    return img;
  }

  const div = document.createElement("div");
  div.textContent = getInitials(p.short);
  div.style.cssText = `
    width:${size}px; height:${size}px; border-radius:50%; flex-shrink:0;
    background:rgba(255,255,255,0.07);
    border:2px solid rgba(255,255,255,0.12);
    display:flex; align-items:center; justify-content:center;
    font-weight:700; font-size:${Math.round(size * 0.34)}px;
    color:rgba(255,255,255,0.45);
  `;
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

// ── Data ──────────────────────────────────────────────────────────────────────

async function loadData() {
  const res = await storage.get(["people", "prefixEnabled", "selectionDraft"]);

  people       = Array.isArray(res.people) ? res.people : [];
  prefixEnabled = !!res.prefixEnabled;
  selection    = Array.isArray(res.selectionDraft) ? res.selectionDraft : [];

  els.prefixToggle.checked = prefixEnabled;

  // Normalize schema (no photo field — handled by photoCache)
  const norm = p => ({
    id:       p.id       || "",
    short:    p.short    || "",
    full:     p.full     || "",
    category: p.category || ""
  });

  people    = people.map(norm).filter(p => p.short && p.full);
  selection = selection.map(norm).filter(p => p.short && p.full);

  await storage.set({ people, selectionDraft: selection });

  // Load all photos from IndexedDB into memory cache
  if (people.length) {
    photoCache = await PhotoDB.getMany(people.map(p => p.id));
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
    row.style.cssText = "display:flex; align-items:center; gap:10px;";

    const textWrap = document.createElement("div");
    textWrap.style.cssText = "min-width:0; flex:1;";
    const cat = p.category
      ? `<span class="personCat">${escapeHtml(p.category)}</span>`
      : "";
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

// ── Render selection panel ────────────────────────────────────────────────────

function renderSelection() {
  els.selCount.textContent = `${selection.length}`;
  els.selection.innerHTML = "";

  for (let i = 0; i < selection.length; i++) {
    const p = selection[i];

    const item = document.createElement("div");
    item.className = "selItem";
    item.style.cssText = "display:flex; align-items:center; gap:10px;";

    const left = document.createElement("div");
    left.className = "selTextWrap";
    left.style.cssText = "min-width:0; flex:1;";
    left.innerHTML = `
      <div class="selMeta">#${i + 1} · ${escapeHtml(p.short)}${p.category ? " · " + escapeHtml(p.category) : ""}</div>
      <div class="selText">${escapeHtml(p.full)}</div>
    `;

    const btns = document.createElement("div");
    btns.className = "selBtns";

    const up = document.createElement("button");
    up.className = "iconBtn"; up.textContent = "↑"; up.title = "Move up";
    up.disabled = i === 0;
    up.addEventListener("click", () => {
      if (i === 0) return;
      [selection[i - 1], selection[i]] = [selection[i], selection[i - 1]];
      persistSelection(); renderSelection();
    });

    const down = document.createElement("button");
    down.className = "iconBtn"; down.textContent = "↓"; down.title = "Move down";
    down.disabled = i === selection.length - 1;
    down.addEventListener("click", () => {
      if (i === selection.length - 1) return;
      [selection[i + 1], selection[i]] = [selection[i], selection[i + 1]];
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
  els.copyBtn.disabled = !has;
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

// ── Events ────────────────────────────────────────────────────────────────────

els.search.addEventListener("input", renderPeople);
els.clearSearch.addEventListener("click", () => {
  els.search.value = ""; renderPeople(); els.search.focus();
});

els.copyBtn.addEventListener("click", copyCaption);
els.clearBtn.addEventListener("click", () => {
  selection = []; persistSelection(); renderSelection();
});
els.prefixToggle.addEventListener("change", () => {
  prefixEnabled = els.prefixToggle.checked; persistPrefix();
});
els.openOptions.addEventListener("click", () => {
  window.location.href = "options.html";
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  await loadData();
  renderPeople();
  renderSelection();
})();
