// Sincronización bidireccional y copias de seguridad (Módulo 5). Puro:
// los proveedores (Dropbox, WebDAV, Google Drive, FTP) solo transportan el
// documento; la fusión se resuelve aquí.

import { normalizeSettings, type Settings } from "./settings";
import type { Bookmark, BookRecord, Note, Position, ReadingSession } from "./types";

export const SYNC_VERSION = 1;

/** Estado sincronizable de un libro (se identifica por id = huella del archivo). */
export interface BookSyncState {
  id: string;
  title: string;
  position: Position;
  positionUpdatedAt: string;
  bookmarks: Bookmark[];
  notes: Note[];
  sessions: ReadingSession[];
  /** Ids borrados localmente (lápidas), para que no reaparezcan al fusionar. */
  deleted?: string[];
}

export interface SyncDocument {
  version: number;
  updatedAt: string;
  books: Record<string, BookSyncState>;
}

export function toSyncState(b: BookRecord, deleted: string[] = []): BookSyncState {
  return {
    id: b.id,
    title: b.metadata.title,
    position: b.position,
    positionUpdatedAt: b.positionUpdatedAt,
    bookmarks: b.bookmarks,
    notes: b.notes,
    sessions: b.sessions,
    deleted,
  };
}

function mergeById<T extends { id: string; updatedAt: string }>(a: T[], b: T[], deleted: Set<string>): T[] {
  const map = new Map<string, T>();
  for (const item of [...a, ...b]) {
    if (deleted.has(item.id)) continue;
    const prev = map.get(item.id);
    if (!prev || item.updatedAt > prev.updatedAt) map.set(item.id, item);
  }
  return [...map.values()].sort((x, y) => x.id.localeCompare(y.id));
}

const sessionKey = (s: ReadingSession) => `${s.bookId}|${s.start}`;

export function mergeBookState(local: BookSyncState, remote: BookSyncState): BookSyncState {
  const deleted = new Set([...(local.deleted ?? []), ...(remote.deleted ?? [])]);
  const newer = remote.positionUpdatedAt > local.positionUpdatedAt ? remote : local;
  const sessions = new Map<string, ReadingSession>();
  for (const s of [...local.sessions, ...remote.sessions]) sessions.set(sessionKey(s), s);
  return {
    id: local.id,
    title: local.title || remote.title,
    position: newer.position,
    positionUpdatedAt: newer.positionUpdatedAt,
    bookmarks: mergeById(local.bookmarks, remote.bookmarks, deleted),
    notes: mergeById(local.notes, remote.notes, deleted),
    sessions: [...sessions.values()].sort((a, b) => a.start.localeCompare(b.start)),
    deleted: [...deleted].sort(),
  };
}

/** Fusión bidireccional: el resultado se guarda localmente y se sube a la nube. */
export function mergeSyncDocuments(local: SyncDocument, remote: SyncDocument | null, now: string): SyncDocument {
  if (!remote) return { ...local, updatedAt: now };
  const books: Record<string, BookSyncState> = { ...remote.books };
  for (const [id, state] of Object.entries(local.books)) {
    books[id] = books[id] ? mergeBookState(state, books[id]) : state;
  }
  return { version: SYNC_VERSION, updatedAt: now, books };
}

export function parseSyncDocument(raw: string): SyncDocument | null {
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object" || typeof d.books !== "object") return null;
    return { version: Number(d.version) || SYNC_VERSION, updatedAt: String(d.updatedAt ?? ""), books: d.books };
  } catch {
    return null;
  }
}

// ---- Copias de seguridad de configuración ----

export interface Backup {
  app: "reader-play";
  version: number;
  createdAt: string;
  settings: Settings;
  sync?: SyncDocument;
}

export function createBackup(settings: Settings, sync: SyncDocument | undefined, now: string): string {
  const b: Backup = { app: "reader-play", version: SYNC_VERSION, createdAt: now, settings, sync };
  return JSON.stringify(b, null, 2);
}

export function restoreBackup(raw: string): { settings: Settings; sync?: SyncDocument } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("El archivo de copia de seguridad no es JSON válido.");
  }
  const b = data as Partial<Backup>;
  if (!b || b.app !== "reader-play") throw new Error("El archivo no es una copia de seguridad de Reader Play.");
  return {
    settings: normalizeSettings(b.settings),
    sync: b.sync ? parseSyncDocument(JSON.stringify(b.sync)) ?? undefined : undefined,
  };
}
