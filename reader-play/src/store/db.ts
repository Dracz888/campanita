// Persistencia local: IndexedDB para archivos y registros de libros,
// localStorage para ajustes y configuración de sincronización.

import { normalizeSettings, type Settings } from "../core/settings";
import type { BookRecord } from "../core/types";
import type { ProviderConfig } from "../sync/providers";

const DB = "reader-play";
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("books", { keyPath: "id" });
      req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction(store, mode).objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const listBooks = () => tx<BookRecord[]>("books", "readonly", (s) => s.getAll() as IDBRequest<BookRecord[]>);
export const putBook = (b: BookRecord) => tx("books", "readwrite", (s) => s.put(b));
export const deleteBook = async (id: string) => {
  await tx("books", "readwrite", (s) => s.delete(id));
  await tx("files", "readwrite", (s) => s.delete(id));
};
export const putFile = (id: string, buf: ArrayBuffer) => tx("files", "readwrite", (s) => s.put(buf, id));
export const getFile = (id: string) => tx<ArrayBuffer | undefined>("files", "readonly", (s) => s.get(id));

function readLS<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}
function writeLS(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* almacenamiento no disponible */
  }
}

export const loadSettings = (): Settings => normalizeSettings(readLS("rp.settings"));
export const saveSettings = (s: Settings) => writeLS("rp.settings", s);
export const loadSyncConfig = () => readLS<ProviderConfig>("rp.sync");
export const saveSyncConfig = (c: ProviderConfig) => writeLS("rp.sync", c);
export const loadDeleted = () => readLS<Record<string, string[]>>("rp.deleted") ?? {};
export const saveDeleted = (d: Record<string, string[]>) => writeLS("rp.deleted", d);
