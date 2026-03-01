// localStorage-backed storage shim (mirrors browser.storage.local API)
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
  search: document.getElementById("search"),
  clearSearch: document.getElementById("clearSearch"),
  peopleList: document.getElementById("peopleList"),
  emptyState: document.getElementById("emptyState"),
  count: document.getElementById("count"),
  selection: document.getElementById("selection"),
  selCount: document.getElementById("selCount"),
  copyBtn: document.getElementById("copyBtn"),
  clearBtn: document.getElementById("clearBtn"),
  prefixToggle: document.getElementById("prefixToggle"),
  openOptions: document.getElementById("openOptions"),
  toast: document.getElementById("toast")
};

let people = [];
let selection = [];
let prefixEnabled = false;

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(s) {
  return String(s || "").toLowerCase().trim();
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");
  setTimeout(() => els.toast.classList.add("hidden"), 1200);
}

async function loadData() {
  const res = await storage.get(["people", "prefixEnabled", "selectionDraft"]);
  people = Array.isArray(res.people) ? res.people : [];
  prefixEnabled = !!res.prefixEnabled;
  selection = Array.isArray(res.selectionDraft) ? res.selectionDraft : [];

  els.prefixToggle.checked = prefixEnabled;

  // normalize schema
  people = people.map(p => ({
    id: p.id || "",
    short: p.short || "",
    full: p.full || "",
    category: p.category || ""
  })).filter(p => p.short && p.full);

  selection = selection.map(p => ({
    id: p.id || "",
    short: p.short || "",
    full: p.full || "",
    category: p.category || ""
  })).filter(p => p.short && p.full);

  await storage.set({ people, selectionDraft: selection });
}

function persistPrefix() {
  storage.set({ prefixEnabled });
}

function persistSelection() {
  storage.set({ selectionDraft: selection });
}

function matchesPerson(p, query) {
  if (!query) return true;
  const q = normalize(query);
  const hay = normalize(`${p.short} ${p.full} ${p.category || ""} ${p.id || ""}`);
  return hay.includes(q);
}

function renderPeople() {
  const q = els.search.value;
  const filtered = people.filter(p => matchesPerson(p, q));

  els.count.textContent = `${filtered.length}`;
  els.peopleList.innerHTML = "";
  els.emptyState.classList.toggle("hidden", filtered.length !== 0);

  for (const p of filtered) {
    const row = document.createElement("div");
    row.className = "person";
    const cat = p.category ? `<span class="personCat">${escapeHtml(p.category)}</span>` : "";
    row.innerHTML = `
      <div class="personName">${escapeHtml(p.short)}${cat}</div>
      <div class="personFull">${escapeHtml(p.full)}</div>
    `;
    row.addEventListener("click", () => {
      selection.push(p);
      persistSelection();
      renderSelection();
    });
    els.peopleList.appendChild(row);
  }
}

function renderSelection() {
  els.selCount.textContent = `${selection.length}`;
  els.selection.innerHTML = "";

  for (let i = 0; i < selection.length; i++) {
    const p = selection[i];

    const item = document.createElement("div");
    item.className = "selItem";

    const left = document.createElement("div");
    left.className = "selTextWrap";
    left.innerHTML = `
      <div class="selMeta">#${i + 1} · ${escapeHtml(p.short)}${p.category ? " · " + escapeHtml(p.category) : ""}</div>
      <div class="selText">${escapeHtml(p.full)}</div>
    `;

    const btns = document.createElement("div");
    btns.className = "selBtns";

    const up = document.createElement("button");
    up.className = "iconBtn";
    up.textContent = "↑";
    up.title = "Move up";
    up.disabled = i === 0;
    up.addEventListener("click", () => {
      if (i === 0) return;
      [selection[i - 1], selection[i]] = [selection[i], selection[i - 1]];
      persistSelection();
      renderSelection();
    });

    const down = document.createElement("button");
    down.className = "iconBtn";
    down.textContent = "↓";
    down.title = "Move down";
    down.disabled = i === selection.length - 1;
    down.addEventListener("click", () => {
      if (i === selection.length - 1) return;
      [selection[i + 1], selection[i]] = [selection[i], selection[i + 1]];
      persistSelection();
      renderSelection();
    });

    const del = document.createElement("button");
    del.className = "iconBtn";
    del.textContent = "✕";
    del.title = "Remove";
    del.addEventListener("click", () => {
      selection.splice(i, 1);
      persistSelection();
      renderSelection();
    });

    btns.appendChild(up);
    btns.appendChild(down);
    btns.appendChild(del);

    item.appendChild(left);
    item.appendChild(btns);
    els.selection.appendChild(item);
  }

  const has = selection.length > 0;
  els.copyBtn.disabled = !has;
  els.clearBtn.disabled = !has;
}

function buildCaption() {
  const parts = selection.map(p => String(p.full || "").trim()).filter(Boolean);
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
  } catch (e) {
    showToast("Copy failed (clipboard blocked).");
  }
}

// Events
els.search.addEventListener("input", renderPeople);
els.clearSearch.addEventListener("click", () => {
  els.search.value = "";
  renderPeople();
  els.search.focus();
});

els.copyBtn.addEventListener("click", copyCaption);
els.clearBtn.addEventListener("click", () => {
  selection = [];
  persistSelection();
  renderSelection();
});

els.prefixToggle.addEventListener("change", () => {
  prefixEnabled = els.prefixToggle.checked;
  persistPrefix();
});

els.openOptions.addEventListener("click", () => {
  window.location.href = "options.html";
});

// Init
(async function init() {
  await loadData();
  renderPeople();
  renderSelection();
})();
