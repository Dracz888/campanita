// Parser MOBI (Mobipocket 6) y AZW3 (KF8). Soporta registros sin comprimir y
// con compresión PalmDOC (LZ77). La compresión HUFF/CDIC no está soportada.
// Los archivos con DRM no pueden abrirse.

import type { Chapter, ParsedBook } from "../core/types";
import { parseHtml, processChapterBody, toPrinted } from "./html";
import type { PrintedPageMark } from "../core/types";

export function palmDocDecompress(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i++];
    if (c === 0 || (c >= 0x09 && c <= 0x7f)) out.push(c);
    else if (c >= 0x01 && c <= 0x08) {
      for (let k = 0; k < c && i < src.length; k++) out.push(src[i++]);
    } else if (c >= 0xc0) {
      out.push(0x20, c ^ 0x80);
    } else {
      // 0x80..0xbf: par distancia/longitud.
      const pair = ((c << 8) | src[i++]) & 0x3fff;
      const dist = pair >> 3;
      const len = (pair & 7) + 3;
      for (let k = 0; k < len; k++) out.push(out[out.length - dist]);
    }
  }
  return Uint8Array.from(out);
}

/** Tamaño de los datos extra al final de un registro de texto (MOBI trailing entries). */
function trailingSize(rec: Uint8Array, flags: number): number {
  let size = 0;
  let end = rec.length;
  for (let bit = 15; bit > 0; bit--) {
    if (!(flags & (1 << bit))) continue;
    // Entero de longitud variable leído hacia atrás.
    let v = 0;
    let shift = 0;
    for (let k = 1; k <= 4 && end - k >= 0; k++) {
      const b = rec[end - k];
      v |= (b & 0x7f) << shift;
      shift += 7;
      if (b & 0x80) break;
    }
    size += v;
    end -= v;
  }
  if (flags & 1 && end > 0) size += (rec[end - 1] & 3) + 1;
  return size;
}

const SIG = (u8: Uint8Array, at: number) => String.fromCharCode(...u8.subarray(at, at + 4));

export async function parseMobi(buf: ArrayBuffer, fmt: "mobi" | "azw3" = "mobi"): Promise<ParsedBook> {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const numRecords = dv.getUint16(76);
  const offsets: number[] = [];
  for (let i = 0; i < numRecords; i++) offsets.push(dv.getUint32(78 + i * 8));
  offsets.push(u8.length);
  const record = (i: number) => u8.subarray(offsets[i], offsets[i + 1]);

  const readHeader = (recIdx: number) => {
    const base = offsets[recIdx];
    if (SIG(u8, base + 16) !== "MOBI") throw new Error("Cabecera MOBI no encontrada");
    const headerLen = dv.getUint32(base + 20);
    const exth: Record<number, Uint8Array[]> = {};
    if (dv.getUint32(base + 128) & 0x40) {
      const e = base + 16 + headerLen;
      if (SIG(u8, e) === "EXTH") {
        const count = dv.getUint32(e + 8);
        let p = e + 12;
        for (let k = 0; k < count; k++) {
          const type = dv.getUint32(p);
          const len = dv.getUint32(p + 4);
          (exth[type] ??= []).push(u8.subarray(p + 8, p + len));
          p += len;
        }
      }
    }
    return {
      base,
      compression: dv.getUint16(base),
      textRecords: dv.getUint16(base + 8),
      encryption: dv.getUint16(base + 12),
      encoding: dv.getUint32(base + 28),
      version: dv.getUint32(base + 36),
      firstImage: dv.getUint32(base + 108),
      nameOffset: dv.getUint32(base + 84),
      nameLength: dv.getUint32(base + 88),
      extraFlags: headerLen >= 0xe4 ? dv.getUint16(base + 242) : 0,
      exth,
    };
  };

  let hdr = readHeader(0);
  let recBase = 0;
  const boundary = hdr.exth[121]?.[0];
  if (boundary) {
    const b = new DataView(boundary.buffer, boundary.byteOffset).getUint32(0);
    if (b !== 0xffffffff && b < numRecords) {
      const kf8 = readHeader(b);
      hdr = { ...kf8, exth: { ...hdr.exth, ...kf8.exth } };
      recBase = b;
    }
  }
  if (hdr.encryption !== 0) throw new Error("Este libro tiene DRM y no puede abrirse.");
  if (hdr.compression === 17480) throw new Error("Compresión HUFF/CDIC no soportada.");

  const dec = new TextDecoder(hdr.encoding === 1252 ? "windows-1252" : "utf-8");
  const exthStr = (t: number) => (hdr.exth[t]?.[0] ? new TextDecoder("utf-8").decode(hdr.exth[t][0]) : "");

  const parts: Uint8Array[] = [];
  for (let i = 1; i <= hdr.textRecords; i++) {
    let r = record(recBase + i);
    r = r.subarray(0, r.length - trailingSize(r, hdr.extraFlags));
    parts.push(hdr.compression === 2 ? palmDocDecompress(r) : r);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  let html = dec.decode(all);

  // Imágenes (los índices de KF8 son relativos al límite KF8). MOBI6 usa recindex="00001"; KF8 usa kindle:embed:XXXX (base 32).
  const img = (idx1: number) => {
    const r = record(recBase + hdr.firstImage + idx1 - 1);
    if (!r || r.length < 4) return "";
    const mime = r[0] === 0x89 ? "image/png" : r[0] === 0x47 ? "image/gif" : "image/jpeg";
    let s = "";
    for (let i = 0; i < r.length; i += 0x8000) s += String.fromCharCode(...r.subarray(i, i + 0x8000));
    return `data:${mime};base64,${btoa(s)}`;
  };
  html = html
    .replace(/recindex=["']?(\d+)["']?/gi, (_m, n) => `src="${img(parseInt(n, 10))}"`)
    .replace(/kindle:embed:([0-9A-V]{4})(\?[^"')]*)?/g, (_m, n) => img(parseInt(n, 32)));

  const isKf8 = hdr.version >= 8;
  const pieces = isKf8
    ? html.split(/(?=<html[\s>])/i).filter((s) => s.trim())
    : html.split(/<mbp:pagebreak\s*\/?>/i).filter((s) => s.replace(/<[^>]+>/g, "").trim());

  const chapters: Chapter[] = [];
  const printedPages: PrintedPageMark[] = [];
  let css = "";
  for (const piece of pieces) {
    const doc = parseHtml(piece.includes("<body") ? piece : `<html><body>${piece}</body></html>`);
    for (const st of [...doc.getElementsByTagName("style")]) css += `\n${st.textContent ?? ""}`;
    const body = doc.body;
    if (!body) continue;
    const p = processChapterBody(body, { footnotes: {} });
    if (!p.text.trim() && !/<img/.test(p.html)) continue;
    const idx = chapters.length;
    printedPages.push(...toPrinted(idx, p.pages));
    const h = body.querySelector("h1, h2, h3")?.textContent?.trim();
    chapters.push({ id: `c${idx}`, title: h || `Capítulo ${idx + 1}`, html: p.html, text: p.text });
  }

  const fullName = dec.decode(u8.subarray(hdr.base + hdr.nameOffset, hdr.base + hdr.nameOffset + hdr.nameLength));
  return {
    format: isKf8 ? "azw3" : fmt,
    metadata: {
      title: exthStr(503) || fullName || "Sin título",
      author: exthStr(100) || "Autor desconocido",
      synopsis: (exthStr(103) || "").replace(/<[^>]+>/g, "").trim(),
    },
    chapters,
    css,
    fonts: [],
    footnotes: {},
    printedPages,
  };
}
