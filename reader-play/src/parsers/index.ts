// Punto de entrada del motor de parsing: detecta el formato y delega.

import type { BookFormat, ParsedBook } from "../core/types";
import { parseEpub } from "./epub";
import { parseFb2 } from "./fb2";
import { parseMobi } from "./mobi";

export function detectFormat(fileName: string, head: Uint8Array): BookFormat | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const ascii = String.fromCharCode(...head.subarray(0, 100));
  if (ascii.startsWith("PK")) return "epub";
  if (ascii.slice(60, 68) === "BOOKMOBI") return ext === "azw3" || ext === "azw" ? "azw3" : "mobi";
  if (/<FictionBook/i.test(new TextDecoder().decode(head.subarray(0, 1000))) || ext === "fb2") return "fb2";
  if (ext === "txt") return "txt";
  return null;
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** Texto plano: se divide en capítulos por encabezados tipo "Capítulo N" o cada ~8000 palabras. */
export function parseTxt(text: string, fileName: string): ParsedBook {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const heading = /^\s*(cap[ií]tulo|chapter|parte|part|libro)\b.{0,60}$/i;
  const chunks: { title: string; lines: string[] }[] = [{ title: "Inicio", lines: [] }];
  let words = 0;
  for (const l of lines) {
    const cur = chunks[chunks.length - 1];
    if ((heading.test(l) && cur.lines.some((x) => x.trim())) || words > 8000) {
      chunks.push({ title: heading.test(l) ? l.trim() : `Parte ${chunks.length + 1}`, lines: [] });
      words = 0;
    }
    chunks[chunks.length - 1].lines.push(l);
    words += l.split(/\s+/).length;
  }
  const chapters = chunks
    .filter((c) => c.lines.some((l) => l.trim()))
    .map((c, i) => ({
      id: `t${i}`,
      title: c.title,
      html: c.lines.filter((l) => l.trim()).map((l) => `<p>${escapeHtml(l.trim())}</p>`).join(""),
      text: c.lines.join("\n").trim(),
    }));
  return {
    format: "txt",
    metadata: { title: fileName.replace(/\.[^.]+$/, ""), author: "Autor desconocido", synopsis: "" },
    chapters,
    css: "",
    fonts: [],
    footnotes: {},
    printedPages: [],
  };
}

export async function parseBook(fileName: string, buf: ArrayBuffer): Promise<ParsedBook> {
  const fmt = detectFormat(fileName, new Uint8Array(buf.slice(0, 1000)));
  switch (fmt) {
    case "epub":
      return parseEpub(buf);
    case "mobi":
    case "azw3":
      return parseMobi(buf, fmt);
    case "fb2":
      return parseFb2(buf);
    case "txt":
      return parseTxt(new TextDecoder().decode(buf), fileName);
    default:
      throw new Error("Formato no soportado. Usa EPUB, AZW3, MOBI, FB2 o TXT.");
  }
}

/** Huella estable del archivo (SHA-256 de los primeros 1 MB + tamaño) para sincronizar. */
export async function fingerprint(buf: ArrayBuffer): Promise<string> {
  const head = buf.slice(0, 1024 * 1024);
  const hash = await crypto.subtle.digest("SHA-256", head);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 24)}-${buf.byteLength}`;
}
