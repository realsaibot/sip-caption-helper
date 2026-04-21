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
  short:            document.getElementById("short"),
  category:         document.getElementById("category"),
  full:             document.getElementById("full"),
  add:              document.getElementById("add"),
  exportBtn:        document.getElementById("exportBtn"),
  importBtn:        document.getElementById("importBtn"),
  importFile:       document.getElementById("importFile"),
  resetBtn:         document.getElementById("resetBtn"),
  status:           document.getElementById("status"),
  tbody:            document.getElementById("tbody"),
  addPhotoInput:    document.getElementById("addPhotoInput"),
  addAvatarCircle:  document.getElementById("addAvatarCircle"),
  addInitials:      document.getElementById("addInitials"),
  addRemovePhoto:   document.getElementById("addRemovePhoto"),
  tableSearch:      document.getElementById("tableSearch"),
  clearTableSearch: document.getElementById("clearTableSearch"),
  tableCount:       document.getElementById("tableCount"),
  // GitHub UI
  ghToken:          document.getElementById("ghToken"),
  ghOwner:          document.getElementById("ghOwner"),
  ghRepo:           document.getElementById("ghRepo"),
  ghBranch:         document.getElementById("ghBranch"),
  ghSaveConfig:     document.getElementById("ghSaveConfig"),
  ghTest:           document.getElementById("ghTest"),
  ghDisconnect:     document.getElementById("ghDisconnect"),
  ghTestStatus:     document.getElementById("ghTestStatus"),
  ghStatusBadge:    document.getElementById("ghStatusBadge"),
  syncDot:          document.getElementById("syncDot"),
  syncLabel:        document.getElementById("syncLabel"),
};

let people = [];
let pendingPhoto = "";

// ── Sync UI helpers ───────────────────────────────────────────────────────────

function setSyncState(state, msg = "") {
  // state: 'idle' | 'syncing' | 'ok' | 'error'
  els.syncDot.className = "syncDot " + (state === 'idle' ? '' : state);
  els.syncLabel.textContent = msg;
}

function updateGhBadge() {
  const configured = GithubSync.isConfigured();
  els.ghStatusBadge.textContent    = configured ? "Connected" : "Not configured";
  els.ghStatusBadge.className      = "ghStatus " + (configured ? "connected" : "disconnected");
}

function populateGhFields() {
  const c = GithubSync.getConfig();
  if (c.token)  els.ghToken.value  = c.token;
  if (c.owner)  els.ghOwner.value  = c.owner;
  if (c.repo)   els.ghRepo.value   = c.repo;
  if (c.branch) els.ghBranch.value = c.branch;
}

// ── Core helpers ──────────────────────────────────────────────────────────────

function setStatus(msg, kind = "info") {
  els.status.textContent = msg;
  els.status.className   = "small" + (kind === "ok" ? " ok" : kind === "warn" ? " warn" : "");
  setTimeout(() => (els.status.textContent = ""), 2500);
}

function slugify(s) {
  return String(s || "").toLowerCase().trim()
    .replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "").slice(0, 40) || "person";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function attr(s) { return String(s || "").replaceAll('"', "&quot;"); }

function getInitials(short) {
  const parts = String(short || "?").trim().split(/\s+/);
  return parts.length === 1
    ? parts[0][0].toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function makeAvatarEl(photo, short, sizePx = 40, cssClass = "tAvatar") {
  const wrap = document.createElement("div");
  wrap.className = cssClass;
  wrap.style.width  = sizePx + "px";
  wrap.style.height = sizePx + "px";
  wrap.style.fontSize = Math.round(sizePx * 0.34) + "px";
  if (photo) {
    const img = document.createElement("img");
    img.src = photo; img.alt = short;
    wrap.appendChild(img);
  } else {
    wrap.textContent = getInitials(short);
  }
  return wrap;
}

function refreshAddAvatar() {
  els.addAvatarCircle.innerHTML = "";
  if (pendingPhoto) {
    const img = document.createElement("img");
    img.src = pendingPhoto;
    els.addAvatarCircle.appendChild(img);
    els.addRemovePhoto.style.display = "inline-block";
  } else {
    const span = document.createElement("span");
    span.textContent = els.short.value.trim() ? getInitials(els.short.value) : "?";
    els.addAvatarCircle.appendChild(span);
    els.addRemovePhoto.style.display = "none";
  }
}

function normalizePerson(x) {
  const short    = String(x.short    || "").trim();
  const full     = String(x.full     || "").trim();
  const category = String(x.category || "").trim();
  const id       = String(x.id       || "").trim() || slugify(short);
  return { id, short, full, category };
}

// ── Load / Save ───────────────────────────────────────────────────────────────

async function load() {
  // 1. Load from localStorage first so UI is instant
  const res = await storage.get(["people"]);
  people = Array.isArray(res.people)
    ? res.people.map(normalizePerson).filter(p => p.short && p.full)
    : [];

  // 2. If GitHub is configured, fetch fresh data from there
  if (GithubSync.isConfigured()) {
    setSyncState("syncing", "Fetching from GitHub…");
    try {
      const remote = await GithubSync.load();
      if (remote !== null) {
        // Extract photos from remote data → store in IndexedDB
        const photoMap = {};
        const cleanedRemote = remote.map(x => {
          if (x.photo) photoMap[x.id || slugify(x.short || "")] = x.photo;
          return normalizePerson(x);
        }).filter(p => p.short && p.full);

        if (Object.keys(photoMap).length) await PhotoDB.setMany(photoMap);

        people = cleanedRemote;
        await storage.set({ people });
      }
      setSyncState("ok", "Synced with GitHub");
    } catch (e) {
      setSyncState("error", "GitHub unreachable — using local data");
      console.warn("GitHub load failed:", e);
    }
  } else {
    setSyncState("idle", "");
  }

  await render();
}

async function saveLocal() {
  await storage.set({ people });
}

// Save to localStorage + GitHub (fire-and-forget for GitHub, non-blocking)
async function saveAll() {
  await saveLocal();

  if (!GithubSync.isConfigured()) return;

  setSyncState("syncing", "Saving…");
  try {
    const allPhotos = await PhotoDB.getAll();
    await GithubSync.save(people, allPhotos);
    setSyncState("ok", "Saved to GitHub ✓");
  } catch (e) {
    setSyncState("error", "GitHub save failed — saved locally");
    console.warn("GitHub save failed:", e);
  }
}

// ── Render table ──────────────────────────────────────────────────────────────

async function render() {
  els.tbody.innerHTML = "";

  const q = (els.tableSearch?.value || "").toLowerCase().trim();
  const filtered = q
    ? people.filter(p => `${p.short} ${p.full} ${p.category} ${p.id}`.toLowerCase().includes(q))
    : people;

  if (els.tableCount) {
    els.tableCount.textContent = q
      ? `${filtered.length} of ${people.length}`
      : `${people.length} total`;
  }

  const ids    = filtered.map(p => p.id);
  const photos = ids.length ? await PhotoDB.getMany(ids) : {};

  filtered.forEach((p) => {
    const trueIndex = people.indexOf(p);
    const tr = document.createElement("tr");

    const tdPhoto = document.createElement("td");
    tdPhoto.appendChild(makeAvatarEl(photos[p.id] || null, p.short, 40));
    tr.appendChild(tdPhoto);

    tr.insertAdjacentHTML("beforeend", `
      <td><strong>${escapeHtml(p.short)}</strong><div class="mono">${escapeHtml(p.id)}</div></td>
      <td>${escapeHtml(p.category || "")}</td>
      <td>${escapeHtml(p.full)}</td>
      <td><div class="actions">
        <button data-action="edit">Edit</button>
        <button data-action="delete">Delete</button>
      </div></td>
    `);

    tr.querySelector('[data-action="delete"]').onclick = async () => {
      await PhotoDB.remove(p.id);
      people.splice(trueIndex, 1);
      await saveAll();
      await render();
      setStatus("Deleted ✅", "ok");
    };

    tr.querySelector('[data-action="edit"]').onclick = () =>
      renderEditRow(trueIndex, photos[p.id] || null);

    els.tbody.appendChild(tr);
  });
}

// ── Inline edit row ───────────────────────────────────────────────────────────

function renderEditRow(i, currentPhoto) {
  const p  = people[i];
  const tr = els.tbody.children[
    // find the rendered row for this person
    Array.from(els.tbody.children).findIndex(row => {
      const strong = row.querySelector("strong");
      return strong && strong.textContent === p.short;
    })
  ];
  if (!tr) return;

  let editPhoto = currentPhoto;

  const tdPhoto = tr.children[0];
  tdPhoto.innerHTML = "";
  const avatarWrap = document.createElement("div");
  avatarWrap.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;gap:6px;";
  const avatarEl = makeAvatarEl(editPhoto, p.short, 48);
  avatarWrap.appendChild(avatarEl);

  const changeLabel = document.createElement("label");
  changeLabel.style.cssText = "font-size:12px;color:#3b82f6;font-weight:700;cursor:pointer;";
  changeLabel.textContent = "📷 Change";
  const fileInput = document.createElement("input");
  fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.hidden = true;
  changeLabel.appendChild(fileInput);
  avatarWrap.appendChild(changeLabel);

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "✕ Remove";
  removeBtn.style.cssText = "font-size:11px;color:#c00;background:none;border:none;padding:0;cursor:pointer;font-weight:700;display:" + (editPhoto ? "block" : "none");
  avatarWrap.appendChild(removeBtn);
  tdPhoto.appendChild(avatarWrap);

  function refreshEditAvatar() {
    avatarEl.innerHTML = "";
    if (editPhoto) {
      const img = document.createElement("img");
      img.src = editPhoto;
      avatarEl.appendChild(img);
    } else {
      const shortVal = tr.querySelector('[data-field="short"]')?.value || p.short;
      avatarEl.textContent = getInitials(shortVal);
    }
  }

  fileInput.addEventListener("change", async e => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    try {
      editPhoto = await CropPicker.open(file);
      if (editPhoto) { refreshEditAvatar(); removeBtn.style.display = "block"; }
    } catch { setStatus("Could not load image.", "warn"); }
  });

  removeBtn.onclick = () => { editPhoto = null; refreshEditAvatar(); removeBtn.style.display = "none"; };

  tr.children[1].innerHTML = `<input data-field="short" value="${attr(p.short)}" /><div class="mono">${escapeHtml(p.id)}</div>`;
  tr.children[2].innerHTML = `<input data-field="category" value="${attr(p.category || "")}" />`;
  tr.children[3].innerHTML = `<textarea data-field="full">${escapeHtml(p.full)}</textarea>`;
  tr.children[4].innerHTML = `<div class="actions"><button data-action="save" class="primary">Save</button><button data-action="cancel">Cancel</button></div>`;

  tr.querySelector('[data-field="short"]').addEventListener("input", () => { if (!editPhoto) refreshEditAvatar(); });
  tr.querySelector('[data-action="cancel"]').onclick = () => render();
  tr.querySelector('[data-action="save"]').onclick = async () => {
    const newShort    = tr.querySelector('[data-field="short"]').value.trim();
    const newCategory = tr.querySelector('[data-field="category"]').value.trim();
    const newFull     = tr.querySelector('[data-field="full"]').value.trim();
    if (!newShort || !newFull) { setStatus("Short and Full are required.", "warn"); return; }

    if (editPhoto) await PhotoDB.set(p.id, editPhoto);
    else           await PhotoDB.remove(p.id);

    people[i] = normalizePerson({ id: p.id, short: newShort, category: newCategory, full: newFull });
    await saveAll();
    await render();
    setStatus("Saved ✅", "ok");
  };
}

// ── Add form ──────────────────────────────────────────────────────────────────

els.addPhotoInput.addEventListener("change", async e => {
  const file = e.target.files?.[0]; e.target.value = "";
  if (!file) return;
  try {
    const result = await CropPicker.open(file);
    if (result) { pendingPhoto = result; refreshAddAvatar(); }
  } catch { setStatus("Could not load image.", "warn"); }
});

els.addRemovePhoto.addEventListener("click", () => { pendingPhoto = ""; refreshAddAvatar(); });
els.short.addEventListener("input", () => { if (!pendingPhoto) refreshAddAvatar(); });

els.add.onclick = async () => {
  const short    = els.short.value.trim();
  const category = els.category.value.trim();
  const full     = els.full.value.trim();
  if (!short || !full) { setStatus("Short and Full are required.", "warn"); return; }

  const person = normalizePerson({ short, category, full });
  if (pendingPhoto) await PhotoDB.set(person.id, pendingPhoto);
  people.unshift(person);

  els.short.value = ""; els.category.value = ""; els.full.value = "";
  pendingPhoto = ""; refreshAddAvatar();

  await saveAll();
  await render();
  setStatus("Added ✅", "ok");
};

// ── Export / Import ───────────────────────────────────────────────────────────

els.exportBtn.onclick = async () => {
  const allPhotos  = await PhotoDB.getAll();
  const exportData = people.map(p => ({ ...p, photo: allPhotos[p.id] || "" }));
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "sip-caption-people.json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setStatus("Exported ✅", "ok");
};

els.importBtn.onclick = () => els.importFile.click();

els.importFile.onchange = async () => {
  const file = els.importFile.files?.[0]; els.importFile.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) throw new Error("JSON must be an array.");
    const photoMap = {};
    const cleaned  = parsed.map(x => {
      if (x.photo) photoMap[x.id || slugify(x.short || "")] = x.photo;
      return normalizePerson(x);
    }).filter(p => p.short && p.full);
    if (!cleaned.length) throw new Error("No valid entries found.");

    if (Object.keys(photoMap).length) await PhotoDB.setMany(photoMap);

    let added = 0, updated = 0;
    cleaned.forEach(entry => {
      const idx = people.findIndex(p => p.id === entry.id);
      if (idx >= 0) { people[idx] = entry; updated++; }
      else          { people.push(entry); added++; }
    });

    await saveAll();
    await render();
    setStatus(`Import complete: ${added} added, ${updated} updated ✅`, "ok");
  } catch (e) {
    setStatus(`Import failed: ${e.message}`, "warn");
  }
};

// ── Clear all ─────────────────────────────────────────────────────────────────

els.resetBtn.onclick = async () => {
  if (!confirm("Clear all entries and photos? This cannot be undone.")) return;
  for (const p of people) await PhotoDB.remove(p.id);
  people = [];
  await saveAll();
  await render();
  setStatus("Database cleared ✅", "ok");
};

// ── Table search ──────────────────────────────────────────────────────────────

els.tableSearch?.addEventListener("input", () => render());
els.clearTableSearch?.addEventListener("click", () => {
  els.tableSearch.value = ""; render(); els.tableSearch.focus();
});

// ── GitHub settings UI ────────────────────────────────────────────────────────

els.ghSaveConfig.onclick = () => {
  GithubSync.setConfig({
    token:  els.ghToken.value,
    owner:  els.ghOwner.value,
    repo:   els.ghRepo.value,
    branch: els.ghBranch.value || "main",
  });
  updateGhBadge();
  els.ghTestStatus.textContent = "Settings saved.";
  setTimeout(() => (els.ghTestStatus.textContent = ""), 2000);
};

els.ghTest.onclick = async () => {
  els.ghTestStatus.textContent = "Testing…";
  try {
    const name = await GithubSync.testConnection();
    els.ghTestStatus.className = "small ok";
    els.ghTestStatus.textContent = `✅ Connected to ${name}`;
    updateGhBadge();
  } catch (e) {
    els.ghTestStatus.className = "small warn";
    els.ghTestStatus.textContent = `❌ ${e.message}`;
  }
  setTimeout(() => {
    els.ghTestStatus.textContent = "";
    els.ghTestStatus.className   = "small";
  }, 4000);
};

els.ghDisconnect.onclick = () => {
  if (!confirm("Disconnect GitHub? Your local data stays intact.")) return;
  GithubSync.clearConfig();
  populateGhFields();
  updateGhBadge();
  setSyncState("idle", "");
};

// ── Init ──────────────────────────────────────────────────────────────────────

populateGhFields();
updateGhBadge();
load();
