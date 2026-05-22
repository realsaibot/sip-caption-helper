/**
 * photo-db.js
 * IndexedDB wrapper for photo storage.
 * Photos are stored separately from person data, keyed by person id.
 * No meaningful size limit (unlike localStorage's 5MB cap).
 */
const PhotoDB = (() => {
  const DB_NAME   = 'sip-caption-photos';
  const STORE     = 'photos';
  const DESC_STORE = 'descriptors';
  const VERSION   = 2;

  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        const oldVersion = e.oldVersion;
        // Fresh install (oldVersion === 0) or upgrade from v1
        if (oldVersion < 1) {
          db.createObjectStore(STORE); // key = person id
        }
        if (oldVersion < 2) {
          db.createObjectStore(DESC_STORE); // key = person id, value = Array<number>
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  /** Get one photo by person id. Returns base64 string or null. */
  async function get(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  /** Store one photo (base64) for a person id. */
  async function set(id, base64) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(base64, id);
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    });
  }

  /** Delete photo for a person id. */
  async function remove(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    });
  }

  /**
   * Fetch multiple photos at once.
   * Returns { [id]: base64|null, ... }
   */
  async function getMany(ids) {
    const result = {};
    await Promise.all(ids.map(async id => {
      result[id] = await get(id);
    }));
    return result;
  }

  /**
   * Fetch all photos currently in the store.
   * Returns { [id]: base64, ... }
   */
  async function getAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const result  = {};
      const cursor  = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      cursor.onsuccess = e => {
        const c = e.target.result;
        if (c) { result[c.key] = c.value; c.continue(); }
        else   resolve(result);
      };
      cursor.onerror = e => reject(e.target.error);
    });
  }

  /**
   * Bulk-write { [id]: base64 } map.
   * Used when importing a JSON that contains photos.
   */
  async function setMany(map) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const [id, b64] of Object.entries(map)) {
        if (b64) store.put(b64, id);
      }
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // ── Descriptor store ─────────────────────────────────────────────────────────

  /** Store a plain Array descriptor for a person id. */
  async function setDescriptor(id, descriptorArray) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DESC_STORE, 'readwrite');
      tx.objectStore(DESC_STORE).put(descriptorArray, id);
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    });
  }

  /** Get descriptor Array for a person id. Returns Array or null. */
  async function getDescriptor(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(DESC_STORE, 'readonly').objectStore(DESC_STORE).get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  /** Returns { [id]: Array } for all stored descriptors. */
  async function getAllDescriptors() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const result = {};
      const cursor = db.transaction(DESC_STORE, 'readonly').objectStore(DESC_STORE).openCursor();
      cursor.onsuccess = e => {
        const c = e.target.result;
        if (c) { result[c.key] = c.value; c.continue(); }
        else   resolve(result);
      };
      cursor.onerror = e => reject(e.target.error);
    });
  }

  /** Delete descriptor for a person id. */
  async function removeDescriptor(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DESC_STORE, 'readwrite');
      tx.objectStore(DESC_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    });
  }

  /** Normalize stored value to Array<Array<number>> (handles legacy single flat-array descriptor). */
  function _normalizeDescriptors(raw) {
    if (!raw || !raw.length) return [];
    return typeof raw[0] === 'number' ? [raw] : raw;
  }

  /** Get descriptors for a person as Array<Array<number>>. */
  async function getDescriptors(id) {
    return _normalizeDescriptors(await getDescriptor(id));
  }

  /** Append one descriptor array to a person's stored list. */
  async function appendDescriptor(id, descriptorArray) {
    const existing = await getDescriptors(id);
    existing.push(descriptorArray);
    return setDescriptor(id, existing);
  }

  /** Get all descriptors as { [id]: Array<Array<number>> } — normalized. */
  async function getAllDescriptorsNormalized() {
    const raw = await getAllDescriptors();
    const out = {};
    for (const [id, val] of Object.entries(raw)) {
      const norm = _normalizeDescriptors(val);
      if (norm.length) out[id] = norm;
    }
    return out;
  }

  return { get, set, remove, getMany, getAll, setMany, setDescriptor, getDescriptor, getAllDescriptors, removeDescriptor, getDescriptors, appendDescriptor, getAllDescriptorsNormalized };
})();
