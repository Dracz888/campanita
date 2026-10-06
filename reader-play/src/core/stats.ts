// Estadísticas y telemetría de lectura (Módulo 6). Puro.

import { countChars, countWords } from "./text";
import type { ParsedBook, Position, ReadingSession } from "./types";

export interface BookCounts {
  words: number;
  chars: number;
  chapterWords: number[];
  /** Palabras acumuladas antes de cada capítulo. */
  cumulative: number[];
}

export function bookCounts(book: Pick<ParsedBook, "chapters">): BookCounts {
  const chapterWords = book.chapters.map((c) => countWords(c.text));
  const cumulative: number[] = [];
  let acc = 0;
  for (const w of chapterWords) {
    cumulative.push(acc);
    acc += w;
  }
  return {
    words: acc,
    chars: book.chapters.reduce((n, c) => n + countChars(c.text), 0),
    chapterWords,
    cumulative,
  };
}

/** Porcentaje global [0,100] de una posición ponderado por palabras. */
export function percentOf(counts: BookCounts, pos: Position): number {
  if (counts.words === 0) return 0;
  const i = Math.min(Math.max(pos.chapterIndex, 0), counts.chapterWords.length - 1);
  const read = counts.cumulative[i] + counts.chapterWords[i] * pos.progress;
  return Math.min(100, (read / counts.words) * 100);
}

/** Posición correspondiente a un porcentaje global. */
export function positionAtPercent(counts: BookCounts, percent: number): Position {
  const target = (Math.min(100, Math.max(0, percent)) / 100) * counts.words;
  for (let i = counts.chapterWords.length - 1; i >= 0; i--) {
    if (target >= counts.cumulative[i] || i === 0) {
      const w = counts.chapterWords[i];
      return { chapterIndex: i, progress: w ? Math.min(1, (target - counts.cumulative[i]) / w) : 0 };
    }
  }
  return { chapterIndex: 0, progress: 0 };
}

export function wordsRemaining(counts: BookCounts, pos: Position) {
  const i = pos.chapterIndex;
  const chapter = Math.round((counts.chapterWords[i] ?? 0) * (1 - pos.progress));
  const read = (counts.cumulative[i] ?? 0) + (counts.chapterWords[i] ?? 0) * pos.progress;
  return { chapter, book: Math.max(0, Math.round(counts.words - read)) };
}

/** Velocidad media (palabras/minuto) en las sesiones; ignora sesiones muy cortas. */
export function averageWpm(sessions: ReadingSession[], fallback = 230): number {
  const valid = sessions.filter((s) => s.durationMs >= 30_000 && s.wordsRead > 0);
  const ms = valid.reduce((n, s) => n + s.durationMs, 0);
  const words = valid.reduce((n, s) => n + s.wordsRead, 0);
  if (ms === 0) return fallback;
  return Math.round(words / (ms / 60_000));
}

export function timeRemaining(counts: BookCounts, pos: Position, wpm: number) {
  const r = wordsRemaining(counts, pos);
  const safe = Math.max(wpm, 1);
  return { chapterMin: r.chapter / safe, bookMin: r.book / safe };
}

export function totalReadingMs(sessions: ReadingSession[]): number {
  return sessions.reduce((n, s) => n + s.durationMs, 0);
}

export interface DayHistory {
  date: string; // YYYY-MM-DD (local)
  durationMs: number;
  wpm: number;
  percentAdvanced: number;
}

function localDay(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Historial cronológico por días (más reciente primero). */
export function dailyHistory(sessions: ReadingSession[]): DayHistory[] {
  const byDay = new Map<string, ReadingSession[]>();
  for (const s of sessions) {
    const k = localDay(s.start);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  return [...byDay.entries()]
    .map(([date, list]) => {
      const durationMs = totalReadingMs(list);
      const words = list.reduce((n, s) => n + s.wordsRead, 0);
      return {
        date,
        durationMs,
        wpm: durationMs > 0 ? Math.round(words / (durationMs / 60_000)) : 0,
        percentAdvanced: Math.max(
          0,
          Math.round(list.reduce((n, s) => n + (s.endPercent - s.startPercent), 0) * 10) / 10,
        ),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function formatDuration(minutesOrMs: number, unit: "min" | "ms" = "min"): string {
  const totalMin = Math.round(unit === "ms" ? minutesOrMs / 60_000 : minutesOrMs);
  if (totalMin < 1) return "<1 min";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
