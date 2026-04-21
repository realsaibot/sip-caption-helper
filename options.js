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
  short:        document.getElementById("short"),
  category:     document.getElementById("category"),
  full:         document.getElementById("full"),
  add:          document.getElementById("add"),
  exportBtn:    document.getElementById("exportBtn"),
  importBtn:    document.getElementById("importBtn"),
  importFile:   document.getElementById("importFile"),
  resetBtn:     document.getElementById("resetBtn"),
  status:       document.getElementById("status"),
  tbody:        document.getElementById("tbody"),
  addPhotoInput:    document.getElementById("addPhotoInput"),
  addAvatarCircle:  document.getElementById("addAvatarCircle"),
  addInitials:      document.getElementById("addInitials"),
  addRemovePhoto:   document.getElementById("addRemovePhoto"),
};

let people = [];
let pendingPhoto = ""; // base64 staged for the add form

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(msg, kind = "info") {
  els.status.textContent = msg;
  els.status.className = "small" + (kind === "ok" ? " ok" : kind === "warn" ? " warn" : "");
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

// Build an avatar <div> with optional image inside
function makeAvatarEl(photo, short, sizePx = 40, cssClass = "tAvatar") {
  const wrap = document.createElement("div");
  wrap.className = cssClass;
  wrap.style.width  = sizePx + "px";
  wrap.style.height = sizePx + "px";
  wrap.style.fontSize = Math.round(sizePx * 0.34) + "px";

  if (photo) {
    const img = document.createElement("img");
    img.src = photo;
    img.alt = short;
    wrap.appendChild(img);
  } else {
    wrap.textContent = getInitials(short);
  }
  return wrap;
}

// Update the add-form avatar preview
function refreshAddAvatar() {
  els.addAvatarCircle.innerHTML = "";
  if (pendingPhoto) {
    const img = document.createElement("img");
    img.src = pendingPhoto;
    els.addAvatarCircle.appendChild(img);
    els.addRemovePhoto.style.display = "inline-block";
  } else {
    const span = document.createElement("span");
    span.id = "addInitials";
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
  // Note: no photo field here — photos live in IndexedDB
  return { id, short, full, category };
}

function validatePeopleArray(arr) {
  if (!Array.isArray(arr)) throw new Error("JSON must be an array.");
  const cleaned = arr.map(normalizePerson).filter(p => p.short && p.full);
  if (!cleaned.length) throw new Error("No valid entries (need short + full).");
  return cleaned;
}

// ── Load / Save ───────────────────────────────────────────────────────────────

async function load() {
  const res = await storage.get(["people"]);
  people = Array.isArray(res.people)
    ? res.people.map(normalizePerson).filter(p => p.short && p.full)
    : [];
  await render();
}

async function save() {
  await storage.set({ people });
}

// ── Render table ──────────────────────────────────────────────────────────────

async function render() {
  els.tbody.innerHTML = "";

  // Load all photos in one shot
  const ids    = people.map(p => p.id);
  const photos = ids.length ? await PhotoDB.getMany(ids) : {};

  people.forEach((p, i) => {
    const tr = document.createElement("tr");

    // Photo cell
    const tdPhoto = document.createElement("td");
    tdPhoto.appendChild(makeAvatarEl(photos[p.id] || null, p.short, 40));
    tr.appendChild(tdPhoto);

    // Data cells
    tr.insertAdjacentHTML("beforeend", `
      <td>
        <strong>${escapeHtml(p.short)}</strong>
        <div class="mono">${escapeHtml(p.id)}</div>
      </td>
      <td>${escapeHtml(p.category || "")}</td>
      <td>${escapeHtml(p.full)}</td>
      <td>
        <div class="actions">
          <button data-action="edit">Edit</button>
          <button data-action="delete">Delete</button>
        </div>
      </td>
    `);

    tr.querySelector('[data-action="delete"]').onclick = async () => {
      await PhotoDB.remove(p.id);
      people.splice(i, 1);
      await save();
      await render();
      setStatus("Deleted ✅", "ok");
    };

    tr.querySelector('[data-action="edit"]').onclick = () => renderEditRow(i, photos[p.id] || null);

    els.tbody.appendChild(tr);
  });
}

// ── Inline edit row ───────────────────────────────────────────────────────────

function renderEditRow(i, currentPhoto) {
  const p  = people[i];
  const tr = els.tbody.children[i];
  let editPhoto = currentPhoto; // may change during edit session

  // Photo cell
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
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      editPhoto = await CropPicker.open(file);
      if (editPhoto) { refreshEditAvatar(); removeBtn.style.display = "block"; }
    } catch { setStatus("Could not load image.", "warn"); }
  });

  removeBtn.onclick = () => {
    editPhoto = null;
    refreshEditAvatar();
    removeBtn.style.display = "none";
  };

  // Remaining cells
  tr.children[1].innerHTML = `
    <input data-field="short" value="${attr(p.short)}" />
    <div class="mono">${escapeHtml(p.id)}</div>
  `;
  tr.children[2].innerHTML = `<input data-field="category" value="${attr(p.category || "")}" />`;
  tr.children[3].innerHTML = `<textarea data-field="full">${escapeHtml(p.full)}</textarea>`;
  tr.children[4].innerHTML = `
    <div class="actions">
      <button data-action="save" class="primary">Save</button>
      <button data-action="cancel">Cancel</button>
    </div>
  `;

  // Live initials update
  tr.querySelector('[data-field="short"]').addEventListener("input", () => {
    if (!editPhoto) refreshEditAvatar();
  });

  tr.querySelector('[data-action="cancel"]').onclick = () => render();

  tr.querySelector('[data-action="save"]').onclick = async () => {
    const newShort    = tr.querySelector('[data-field="short"]').value.trim();
    const newCategory = tr.querySelector('[data-field="category"]').value.trim();
    const newFull     = tr.querySelector('[data-field="full"]').value.trim();

    if (!newShort || !newFull) { setStatus("Short and Full are required.", "warn"); return; }

    // Persist photo change
    if (editPhoto) await PhotoDB.set(p.id, editPhoto);
    else           await PhotoDB.remove(p.id);

    people[i] = normalizePerson({ id: p.id, short: newShort, category: newCategory, full: newFull });
    await save();
    await render();
    setStatus("Saved ✅", "ok");
  };
}

// ── Add form photo picker ─────────────────────────────────────────────────────

els.addPhotoInput.addEventListener("change", async e => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const result = await CropPicker.open(file);
    if (result) { pendingPhoto = result; refreshAddAvatar(); }
  } catch { setStatus("Could not load image.", "warn"); }
});

els.addRemovePhoto.addEventListener("click", () => {
  pendingPhoto = "";
  refreshAddAvatar();
});

els.short.addEventListener("input", () => {
  if (!pendingPhoto) refreshAddAvatar();
});

// ── Add ───────────────────────────────────────────────────────────────────────

els.add.onclick = async () => {
  const short    = els.short.value.trim();
  const category = els.category.value.trim();
  const full     = els.full.value.trim();

  if (!short || !full) { setStatus("Short and Full are required.", "warn"); return; }

  const person = normalizePerson({ short, category, full });
  if (pendingPhoto) await PhotoDB.set(person.id, pendingPhoto);

  people.unshift(person);

  // Reset form
  els.short.value = "";
  els.category.value = "";
  els.full.value = "";
  pendingPhoto = "";
  refreshAddAvatar();

  await save();
  await render();
  setStatus("Added ✅", "ok");
};

// ── Export (photos embedded as base64 for cross-device transfer) ──────────────

els.exportBtn.onclick = async () => {
  // Fetch all photos from IndexedDB
  const allPhotos = await PhotoDB.getAll();

  // Embed photos into person objects just for the export
  const exportData = people.map(p => ({
    ...p,
    photo: allPhotos[p.id] || ""
  }));

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "sip-caption-people.json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setStatus("Exported ✅", "ok");
};

// ── Import (merge; photos extracted into IndexedDB) ───────────────────────────

els.importBtn.onclick = () => els.importFile.click();

els.importFile.onchange = async () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = "";
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) throw new Error("JSON must be an array.");

    // Separate photos from person data
    const photoMap = {};
    const cleaned  = parsed
      .map(x => {
        if (x.photo) photoMap[x.id || slugify(x.short || "")] = x.photo;
        return normalizePerson(x);
      })
      .filter(p => p.short && p.full);

    if (!cleaned.length) throw new Error("No valid entries found.");

    // Store photos in IndexedDB
    if (Object.keys(photoMap).length) await PhotoDB.setMany(photoMap);

    // Merge people
    let added = 0, updated = 0;
    cleaned.forEach(entry => {
      const idx = people.findIndex(p => p.id === entry.id);
      if (idx >= 0) { people[idx] = entry; updated++; }
      else          { people.push(entry);  added++;   }
    });

    await save();
    await render();
    setStatus(`Import complete: ${added} added, ${updated} updated ✅`, "ok");
  } catch (e) {
    setStatus(`Import failed: ${e.message}`, "warn");
  }
};

// ── Clear all ─────────────────────────────────────────────────────────────────

els.resetBtn.onclick = async () => {
  if (!confirm("Clear all entries and photos? This cannot be undone.")) return;
  // Remove all photos from IndexedDB
  for (const p of people) await PhotoDB.remove(p.id);
  people = [];
  await save();
  await render();
  setStatus("Database cleared ✅", "ok");
};

// ── Init ──────────────────────────────────────────────────────────────────────

load();
