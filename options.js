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
  short: document.getElementById("short"),
  category: document.getElementById("category"),
  full: document.getElementById("full"),
  add: document.getElementById("add"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),
  resetBtn: document.getElementById("resetBtn"),
  status: document.getElementById("status"),
  tbody: document.getElementById("tbody")
};


let people = [];

function setStatus(msg, kind = "info") {
  els.status.textContent = msg;
  els.status.className = "small";
  if (kind === "ok") els.status.className = "small ok";
  if (kind === "warn") els.status.className = "small warn";
  setTimeout(() => (els.status.textContent = ""), 2200);
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .slice(0, 40) || "person";
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function attr(s) {
  return String(s || "").replaceAll('"', "&quot;");
}

function normalizePerson(x) {
  const short = String(x.short || "").trim();
  const full = String(x.full || "").trim();
  const category = String(x.category || "").trim();
  const id = String(x.id || "").trim() || slugify(short);

  return { id, short, full, category };
}

function validatePeopleArray(arr) {
  if (!Array.isArray(arr)) throw new Error("JSON must be an array of people objects.");
  const cleaned = arr
    .map(normalizePerson)
    .filter(p => p.short && p.full);

  if (!cleaned.length) throw new Error("No valid entries found (need short + full).");
  return cleaned;
}

async function load() {
  const res = await storage.get(["people"]);
  people = Array.isArray(res.people)
    ? res.people.map(normalizePerson).filter(p => p.short && p.full)
    : [];
  render();
}

async function save() {
  await storage.set({ people });
}

function render() {
  els.tbody.innerHTML = "";

  people.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
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
    `;

    tr.querySelector('[data-action="delete"]').onclick = async () => {
      people.splice(i, 1);
      await save();
      render();
      setStatus("Deleted ✅", "ok");
    };

    tr.querySelector('[data-action="edit"]').onclick = () => renderEditRow(i);

    els.tbody.appendChild(tr);
  });
}

function renderEditRow(i) {
  const p = people[i];
  const tr = els.tbody.children[i];

  tr.innerHTML = `
    <td>
      <input data-field="short" value="${attr(p.short)}" />
      <div class="mono">${escapeHtml(p.id)}</div>
    </td>
    <td><input data-field="category" value="${attr(p.category || "")}" /></td>
    <td><textarea data-field="full">${escapeHtml(p.full)}</textarea></td>
    <td>
      <div class="actions">
        <button data-action="save" class="primary">Save</button>
        <button data-action="cancel">Cancel</button>
      </div>
    </td>
  `;

  tr.querySelector('[data-action="cancel"]').onclick = () => render();

  tr.querySelector('[data-action="save"]').onclick = async () => {
    const newShort = tr.querySelector('[data-field="short"]').value.trim();
    const newCategory = tr.querySelector('[data-field="category"]').value.trim();
    const newFull = tr.querySelector('[data-field="full"]').value.trim();

    if (!newShort || !newFull) {
      setStatus("Short and Full are required.", "warn");
      return;
    }

    people[i] = normalizePerson({
      id: people[i].id, // keep stable id
      short: newShort,
      category: newCategory,
      full: newFull
    });

    await save();
    render();
    setStatus("Saved ✅", "ok");
  };
}

els.add.onclick = async () => {
  const short = els.short.value.trim();
  const category = els.category.value.trim();
  const full = els.full.value.trim();

  if (!short || !full) {
    setStatus("Short and Full are required.", "warn");
    return;
  }

  people.unshift(normalizePerson({ short, category, full }));
  els.short.value = "";
  els.category.value = "";
  els.full.value = "";

  await save();
  render();
  setStatus("Added ✅", "ok");
};

// Export database as JSON
els.exportBtn.onclick = () => {
  const data = JSON.stringify(people, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "sip-caption-people.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
  setStatus("Exported database ✅", "ok");
};

// Import (MERGE instead of replace)
els.importBtn.onclick = () => els.importFile.click();

els.importFile.onchange = async () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const cleaned = validatePeopleArray(parsed);

    let added = 0;
    let updated = 0;

    cleaned.forEach(newEntry => {
      const index = people.findIndex(p => p.id === newEntry.id);

      if (index >= 0) {
        people[index] = newEntry;
        updated++;
      } else {
        people.push(newEntry);
        added++;
      }
    });

    await save();
    render();

    setStatus(`Import complete: ${added} added, ${updated} updated ✅`, "ok");

  } catch (e) {
    setStatus(`Import failed: ${e.message}`, "warn");
  }
};

// Clear all entries
els.resetBtn.onclick = async () => {
  const ok = confirm("Clear all entries? This cannot be undone.");
  if (!ok) return;

  people = [];
  await save();
  render();
  setStatus("Database cleared ✅", "ok");
};

load();
