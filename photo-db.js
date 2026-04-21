/**
 * photo-db.js
 * IndexedDB wrapper for photo storage.
 * Photos are stored separately from person data, keyed by person id.
 * No meaningful size limit (unlike localStorage's 5MB cap).
 */
const PhotoDB = (() => {
  const DB_NAME  = 'sip-caption-photos';
  const STORE    = 'photos';
  const VERSION  = 1;

  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(STORE); // key = person id
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

  return { get, set, remove, getMany, getAll, setMany };
})();
