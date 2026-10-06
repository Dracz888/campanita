import { useRef } from "react";
import type { BookRecord } from "../core/types";
import { deleteBook } from "../store/db";

interface Props {
  books: BookRecord[];
  busy: boolean;
  error: string | null;
  onImport: (f: File, buf: ArrayBuffer) => void;
  onOpen: (b: BookRecord) => void;
  onChanged: () => void;
  onOpenSettings: () => void;
}

export function Library({ books, busy, error, onImport, onOpen, onChanged, onOpenSettings }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <main className="rp-library">
      <header className="rp-lib-head">
        <h1>📖 Reader Play</h1>
        <div className="rp-row">
          <button className="primary" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? "Abriendo…" : "＋ Añadir libro"}
          </button>
          <button className="icon" aria-label="Ajustes" onClick={onOpenSettings}>
            ⚙️
          </button>
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept=".epub,.azw3,.azw,.mobi,.fb2,.txt"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f, await f.arrayBuffer());
            e.target.value = "";
          }}
        />
      </header>
      {error && <p className="rp-error">⚠️ {error}</p>}
      {books.length === 0 ? (
        <p className="rp-empty">Tu biblioteca está vacía. Añade un archivo EPUB, AZW3, MOBI, FB2 o TXT.</p>
      ) : (
        <ul className="rp-books">
          {books.map((b) => (
            <li key={b.id}>
              <button className="rp-book" onClick={() => onOpen(b)}>
                <span className="rp-cover">{b.format.toUpperCase()}</span>
                <span className="rp-book-meta">
                  <b>{b.metadata.title}</b>
                  <small>{b.metadata.author}</small>
                </span>
              </button>
              <button
                className="icon"
                aria-label={`Eliminar ${b.metadata.title}`}
                onClick={async () => {
                  if (confirm(`¿Eliminar «${b.metadata.title}» de la biblioteca?`)) {
                    await deleteBook(b.id);
                    onChanged();
                  }
                }}
              >
                🗑️
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
