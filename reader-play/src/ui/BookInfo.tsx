import { useMemo } from "react";
import {
  averageWpm,
  bookCounts,
  dailyHistory,
  formatDuration,
  formatSize,
  percentOf,
  timeRemaining,
  totalReadingMs,
} from "../core/stats";
import type { BookRecord, ParsedBook, Position } from "../core/types";
import { Modal } from "./widgets";

interface Props {
  record: BookRecord;
  book: ParsedBook;
  position: Position;
  estimatedPages: number;
  wpmFallback: number;
  onClose: () => void;
}

/** Panel de estadísticas y metadatos del libro activo (Módulo 6). */
export function BookInfo({ record, book, position, estimatedPages, wpmFallback, onClose }: Props) {
  const counts = useMemo(() => bookCounts(book), [book]);
  const wpm = averageWpm(record.sessions, wpmFallback);
  const left = timeRemaining(counts, position, wpm);
  const history = dailyHistory(record.sessions);
  const totalMs = totalReadingMs(record.sessions);
  const pagesPerMin = estimatedPages > 0 && counts.words > 0 ? (wpm / (counts.words / estimatedPages)).toFixed(2) : "—";
  const rows: [string, string][] = [
    ["Autor", book.metadata.author],
    ["Ubicación (path)", record.path],
    ["Formato", record.format.toUpperCase()],
    ["Tamaño", formatSize(record.sizeBytes)],
    ["Páginas (estimadas)", String(estimatedPages)],
    ["Páginas impresas", book.printedPages.length ? book.printedPages[book.printedPages.length - 1].label : "—"],
    ["Capítulos", String(book.chapters.length)],
    ["Palabras", counts.words.toLocaleString("es")],
    ["Caracteres", counts.chars.toLocaleString("es")],
    ["Progreso", `${percentOf(counts, position).toFixed(1)} %`],
    ["Tiempo total de lectura", `${(totalMs / 3_600_000).toFixed(2)} h`],
    ["Velocidad media", `${wpm} PPM · ${pagesPerMin} pág/min`],
    ["Restante del capítulo", formatDuration(left.chapterMin)],
    ["Restante del libro", formatDuration(left.bookMin)],
  ];
  return (
    <Modal title={book.metadata.title} onClose={onClose} wide>
      {book.metadata.synopsis && <p className="rp-synopsis">{book.metadata.synopsis}</p>}
      <dl className="rp-dl">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <h3>Historial de lectura</h3>
      {history.length === 0 ? (
        <p className="muted">Aún no hay sesiones registradas.</p>
      ) : (
        <table className="rp-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tiempo</th>
              <th>PPM</th>
              <th>Avance</th>
            </tr>
          </thead>
          <tbody>
            {history.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{formatDuration(d.durationMs, "ms")}</td>
                <td>{d.wpm}</td>
                <td>{d.percentAdvanced} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
