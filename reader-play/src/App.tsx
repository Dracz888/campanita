import { useCallback, useEffect, useState } from "react";
import { themeColors } from "./core/settings";
import type { BookRecord, ParsedBook } from "./core/types";
import { fingerprint, parseBook } from "./parsers";
import { getFile, listBooks, putBook, putFile } from "./store/db";
import { useSettings } from "./store/settingsContext";
import { Library } from "./ui/Library";
import { Reader } from "./ui/Reader";
import { SettingsPanel } from "./ui/SettingsPanel";
import { ConfirmDialog } from "./ui/widgets";

interface Open {
  record: BookRecord;
  book: ParsedBook;
  persist: boolean;
}

interface Pending {
  file: File;
  buf: ArrayBuffer;
}

export default function App() {
  const { settings } = useSettings();
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [open, setOpen] = useState<Open | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const list = await listBooks();
    list.sort((a, b) => b.positionUpdatedAt.localeCompare(a.positionUpdatedAt));
    setBooks(list);
    return list;
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  // Tema global.
  useEffect(() => {
    const c = themeColors(settings);
    const r = document.documentElement.style;
    r.setProperty("--bg", c.background);
    r.setProperty("--fg", c.foreground);
    r.setProperty("--accent", c.accent);
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  const importFile = useCallback(
    async (file: File, buf: ArrayBuffer, save: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const book = await parseBook(file.name, buf);
        const id = await fingerprint(buf);
        const existing = books.find((b) => b.id === id);
        const now = new Date().toISOString();
        const record: BookRecord = existing ?? {
          id,
          fileName: file.name,
          path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          sizeBytes: buf.byteLength,
          format: book.format,
          addedAt: now,
          metadata: book.metadata,
          position: { chapterIndex: 0, progress: 0 },
          positionUpdatedAt: now,
          bookmarks: [],
          notes: [],
          sessions: [],
        };
        if (save) {
          await putFile(id, buf);
          await putBook(record);
          await refresh();
        }
        setOpen({ record, book, persist: save || !!existing });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [books, refresh],
  );

  // Archivos abiertos desde otras apps (File Handling API de PWA): confirmar guardado.
  useEffect(() => {
    const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: { files: FileSystemFileHandle[] }) => void): void } }).launchQueue;
    lq?.setConsumer(async (params) => {
      const h = params.files[0];
      if (!h) return;
      const file = await h.getFile();
      const buf = await file.arrayBuffer();
      if (settings.confirmSaveExternal) setPending({ file, buf });
      else importFile(file, buf, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openRecord = useCallback(async (record: BookRecord) => {
    setBusy(true);
    try {
      const buf = await getFile(record.id);
      if (!buf) throw new Error("El archivo del libro no está guardado en este dispositivo.");
      setOpen({ record, book: await parseBook(record.fileName, buf), persist: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!open) return;
      const i = books.findIndex((b) => b.id === open.record.id);
      const next = books[i + dir];
      if (next) openRecord(next);
    },
    [books, open, openRecord],
  );

  return (
    <>
      {open ? (
        <Reader
          key={open.record.id}
          record={open.record}
          book={open.book}
          persist={open.persist}
          onClose={() => {
            setOpen(null);
            refresh();
          }}
          onOpenSettings={() => setShowSettings(true)}
          onPrevFile={() => step(-1)}
          onNextFile={() => step(1)}
        />
      ) : (
        <Library
          books={books}
          busy={busy}
          error={error}
          onImport={(f, buf) => importFile(f, buf, true)}
          onOpen={openRecord}
          onChanged={refresh}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}
      {showSettings && <SettingsPanel books={books} onClose={() => setShowSettings(false)} onSynced={refresh} />}
      {pending && (
        <ConfirmDialog
          title="Guardar archivo de libro"
          message={`¿Quieres guardar «${pending.file.name}» en tu biblioteca?`}
          confirmLabel="Guardar y abrir"
          cancelLabel="Solo abrir"
          onConfirm={() => {
            importFile(pending.file, pending.buf, true);
            setPending(null);
          }}
          onCancel={() => {
            importFile(pending.file, pending.buf, false);
            setPending(null);
          }}
        />
      )}
    </>
  );
}
