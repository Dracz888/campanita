// Formato de texto y herramientas de lectura enfocada (Módulos 2 y 4). Puro.

export interface Segment {
  text: string;
  /** Prefijo resaltado (Bionic Reading). */
  bold?: boolean;
  /** Primera palabra de una oración. */
  sentenceStart?: boolean;
}

/** Colapsa espacios dobles (sin tocar saltos de línea). */
export function collapseSpaces(text: string): string {
  return text.replace(/[ \t ]{2,}/g, " ");
}

/** Elimina líneas vacías consecutivas o sueltas en texto plano. */
export function removeEmptyLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .join("\n");
}

export function cleanPlainText(text: string, opts: { collapseSpaces: boolean; removeEmptyLines: boolean }): string {
  let t = text;
  if (opts.collapseSpaces) t = collapseSpaces(t);
  if (opts.removeEmptyLines) t = removeEmptyLines(t);
  return t;
}

/** Número de letras a resaltar en una palabra para Bionic Reading. */
export function bionicPrefixLength(word: string, ratio = 0.45): number {
  const letters = [...word].length;
  if (letters <= 1) return letters;
  if (letters <= 3) return 1;
  return Math.max(1, Math.round(letters * ratio));
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const SENTENCE_END_RE = /[.!?¡¿…]["»”’)\]]*\s*$/u;

/**
 * Divide un fragmento de texto en segmentos con marcas de Bionic Reading y de
 * inicio de oración. `atSentenceStart` indica si el fragmento empieza una
 * oración (se propaga entre nodos de texto); se devuelve el estado final.
 */
export function segmentText(
  text: string,
  opts: { bionic: boolean; sentenceStart: boolean; ratio?: number },
  atSentenceStart = true,
): { segments: Segment[]; atSentenceStart: boolean } {
  const segments: Segment[] = [];
  let last = 0;
  let start = atSentenceStart;
  const push = (s: Segment) => {
    if (!s.text) return;
    const prev = segments[segments.length - 1];
    if (prev && !prev.bold && !prev.sentenceStart && !s.bold && !s.sentenceStart) prev.text += s.text;
    else segments.push(s);
  };
  for (const m of text.matchAll(WORD_RE)) {
    const idx = m.index ?? 0;
    const between = text.slice(last, idx);
    if (/[.!?…]/.test(between) && SENTENCE_END_RE.test(text.slice(0, idx))) start = true;
    push({ text: between });
    const word = m[0];
    const isStart = start && /\p{L}/u.test(word);
    if (isStart && opts.sentenceStart) {
      push({ text: word, sentenceStart: true });
    } else if (opts.bionic) {
      const n = bionicPrefixLength(word, opts.ratio);
      const chars = [...word];
      push({ text: chars.slice(0, n).join(""), bold: true });
      push({ text: chars.slice(n).join("") });
    } else {
      push({ text: word });
    }
    if (isStart || /\p{L}/u.test(word)) start = false;
    last = idx + word.length;
  }
  const tail = text.slice(last);
  push({ text: tail });
  if (SENTENCE_END_RE.test(text)) start = true;
  return { segments, atSentenceStart: start };
}

export function countWords(text: string): number {
  return (text.match(WORD_RE) ?? []).length;
}

/** Caracteres sin contar espacios en blanco. */
export function countChars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

/** Búsqueda insensible a mayúsculas y acentos. Devuelve offsets de coincidencia. */
export function searchText(text: string, query: string, limit = 200): number[] {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const q = norm(query.trim());
  if (!q) return [];
  // NFD puede cambiar longitudes: normalizamos carácter a carácter para mantener offsets.
  const chars = [...text];
  const flat: string[] = [];
  const map: number[] = [];
  let off = 0;
  for (const c of chars) {
    for (const n of norm(c)) {
      flat.push(n);
      map.push(off);
    }
    off += c.length;
  }
  const hay = flat.join("");
  const out: number[] = [];
  let i = hay.indexOf(q);
  while (i !== -1 && out.length < limit) {
    out.push(map[i]);
    i = hay.indexOf(q, i + q.length);
  }
  return out;
}

/** Extracto alrededor de un offset, para resultados de búsqueda y marcadores. */
export function excerptAt(text: string, offset: number, radius = 40): string {
  const a = Math.max(0, offset - radius);
  const b = Math.min(text.length, offset + radius);
  return (a > 0 ? "…" : "") + text.slice(a, b).replace(/\s+/g, " ").trim() + (b < text.length ? "…" : "");
}
