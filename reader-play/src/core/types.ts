// Modelo de datos de Reader Play. Puro: sin React ni DOM.

export type BookFormat = "epub" | "azw3" | "mobi" | "fb2" | "txt";

export interface Chapter {
  id: string;
  title: string;
  /** HTML saneado del capítulo (ya con notas al pie resueltas si procede). */
  html: string;
  /** Texto plano, para conteos, búsqueda y TTS. */
  text: string;
}

/** Marca de página de la edición impresa (EPUB page-list / epub:type="pagebreak"). */
export interface PrintedPageMark {
  label: string;
  chapterIndex: number;
  /** Desplazamiento en caracteres dentro del texto plano del capítulo. */
  charOffset: number;
}

export interface Footnote {
  id: string;
  html: string;
}

export interface BookMetadata {
  title: string;
  author: string;
  synopsis: string;
  language?: string;
}

export interface ParsedBook {
  format: BookFormat;
  metadata: BookMetadata;
  chapters: Chapter[];
  /** CSS embebido en el libro (concatenado). */
  css: string;
  /** Familias tipográficas declaradas por el libro. */
  fonts: string[];
  footnotes: Record<string, Footnote>;
  printedPages: PrintedPageMark[];
  /** Imágenes como data URLs, indexadas por ruta interna. */
  images?: Record<string, string>;
}

/** Posición de lectura: capítulo + fracción [0,1] dentro del capítulo. */
export interface Position {
  chapterIndex: number;
  progress: number;
}

export interface Bookmark {
  id: string;
  position: Position;
  excerpt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  position: Position;
  quote: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/** Sesión de lectura continua registrada para telemetría. */
export interface ReadingSession {
  bookId: string;
  start: string; // ISO
  durationMs: number;
  wordsRead: number;
  startPercent: number;
  endPercent: number;
}

export interface BookRecord {
  id: string;
  fileName: string;
  path: string;
  sizeBytes: number;
  format: BookFormat;
  addedAt: string;
  metadata: BookMetadata;
  position: Position;
  positionUpdatedAt: string;
  bookmarks: Bookmark[];
  notes: Note[];
  sessions: ReadingSession[];
}
