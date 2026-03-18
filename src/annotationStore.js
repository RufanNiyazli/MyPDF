/**
 * annotationStore.js
 *
 * Persists per-PDF annotation data using IndexedDB (localStorage fallback).
 *
 * DB structure:
 *   Database : "mypdf-annotations"  (version 2)
 *   Object store : "annotations"    keyed by filePath
 *   Value shape  : {
 *     filePath     : string,
 *     pageStates   : { [pageNumber]: fabricJsonString },
 *     pristineBytes: ArrayBuffer | null   ← original PDF bytes (never overwritten)
 *   }
 */

const DB_NAME    = "mypdf-annotations";
const DB_VERSION = 2;          // bumped from 1 → 2 to handle schema upgrade
const STORE_NAME = "annotations";

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "filePath" });
      }
      // v1 → v2: existing records simply gain a null pristineBytes field on first read.
    };

    request.onsuccess  = (event) => resolve(event.target.result);
    request.onerror    = (event) => reject(event.target.error);
  });
}

async function idbGet(filePath) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(filePath);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(record);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function idbDelete(filePath) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(filePath);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ─── localStorage fallback ────────────────────────────────────────────────────

const LS_PREFIX = "mypdf-annotations::";

function lsGet(filePath) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + filePath);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function lsPut(record) {
  try {
    // pristineBytes is an ArrayBuffer/Uint8Array — not JSON-serialisable.
    // Store a shallow clone without the binary field.
    const { pristineBytes: _ignored, ...rest } = record;
    localStorage.setItem(LS_PREFIX + record.filePath, JSON.stringify(rest));
  } catch (e) {
    console.warn("annotationStore: localStorage write failed:", e);
  }
}

// ─── Feature detection ────────────────────────────────────────────────────────

function isIDBAvailable() {
  try { return typeof indexedDB !== "undefined" && indexedDB !== null; }
  catch { return false; }
}

// ─── Internal: get full record (with pristineBytes) ───────────────────────────

async function getRecord(filePath) {
  if (isIDBAvailable()) {
    try { return await idbGet(filePath); }
    catch (e) { console.warn("annotationStore: IDB read error:", e); }
  }
  return lsGet(filePath);
}

async function putRecord(record) {
  if (isIDBAvailable()) {
    try { await idbPut(record); return; }
    catch (e) { console.warn("annotationStore: IDB write error, falling back:", e); }
  }
  lsPut(record);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Store the pristine (un-annotated) PDF bytes for a file.
 * Only writes if no pristine bytes are already stored for this path,
 * so the first-ever open is always preserved.
 *
 * @param {string}     filePath
 * @param {Uint8Array} bytes
 */
export async function savePristineBytes(filePath, bytes) {
  const existing = await getRecord(filePath);
  if (existing && existing.pristineBytes) return; // already stored — never overwrite

  const record = existing
    ? { ...existing, pristineBytes: bytes.buffer }
    : { filePath, pageStates: {}, pristineBytes: bytes.buffer };

  await putRecord(record);
}

/**
 * Load pristine PDF bytes for a file.
 *
 * @param {string} filePath
 * @returns {Promise<Uint8Array|null>}
 */
export async function loadPristineBytes(filePath) {
  const record = await getRecord(filePath);
  if (!record || !record.pristineBytes) return null;
  // IndexedDB returns the ArrayBuffer directly; construct a Uint8Array copy.
  return new Uint8Array(record.pristineBytes);
}

/**
 * Save Fabric.js canvas state (per page) for a file.
 *
 * @param {string} filePath
 * @param {{ [pageNumber: number]: string }} pageStates  Fabric JSON per page
 */
export async function saveAnnotations(filePath, pageStates) {
  const existing = await getRecord(filePath);
  const record   = existing
    ? { ...existing, pageStates }
    : { filePath, pageStates, pristineBytes: null };
  await putRecord(record);
}

/**
 * Load Fabric.js canvas state for a file.
 *
 * @param {string} filePath
 * @returns {Promise<{ [pageNumber: number]: string }|null>}
 */
export async function loadAnnotations(filePath) {
  const record = await getRecord(filePath);
  return record?.pageStates ?? null;
}

/**
 * Delete all stored data for a file (annotations + pristine bytes).
 *
 * @param {string} filePath
 */
export async function deleteAnnotations(filePath) {
  if (isIDBAvailable()) {
    try { await idbDelete(filePath); }
    catch (e) { console.warn("annotationStore: IDB delete error:", e); }
  }
  try { localStorage.removeItem(LS_PREFIX + filePath); } catch {}
}
