// Parser EPUB 2/3: OPF (metadatos, spine), CSS, fuentes, notas y page-list.

import type { Chapter, Footnote, ParsedBook, PrintedPageMark } from "../core/types";
import { parseHtml, processChapterBody, toPrinted } from "./html";
import { openZip, resolvePath, type ZipArchive } from "./zip";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

function toBase64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
const byLocal = (root: ParentNode, name: string) =>
  [...(root as Element).getElementsByTagName("*")].filter((e) => e.localName === name);
const firstText = (root: ParentNode, name: string) => byLocal(root, name)[0]?.textContent?.trim() ?? "";

export async function parseEpub(buf: ArrayBuffer): Promise<ParsedBook> {
  const zip: ZipArchive = openZip(buf);
  const container = xml(await zip.text("META-INF/container.xml"));
  const opfPath = byLocal(container, "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("EPUB sin rootfile");
  const opf = xml(await zip.text(opfPath));

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const it of byLocal(opf, "item")) {
    manifest.set(it.getAttribute("id") ?? "", {
      href: resolvePath(opfPath, it.getAttribute("href") ?? ""),
      type: it.getAttribute("media-type") ?? "",
      props: it.getAttribute("properties") ?? "",
    });
  }

  const description = firstText(opf, "description");
  const metadata = {
    title: firstText(opf, "title") || "Sin título",
    author: firstText(opf, "creator") || "Autor desconocido",
    synopsis: description ? parseHtml(`<div>${description}</div>`).body?.textContent?.trim() ?? description : "",
    language: firstText(opf, "language") || undefined,
  };

  // Imágenes -> data URLs.
  const images: Record<string, string> = {};
  for (const m of manifest.values()) {
    if (m.type.startsWith("image/") && zip.has(m.href)) {
      const ext = m.href.split(".").pop()?.toLowerCase() ?? "";
      images[m.href] = `data:${m.type || MIME[ext]};base64,${toBase64(await zip.bytes(m.href))}`;
    }
  }

  // CSS y fuentes embebidas.
  let css = "";
  const fonts = new Set<string>();
  for (const m of manifest.values()) {
    if (m.type === "text/css" && zip.has(m.href)) {
      const sheet = await zip.text(m.href);
      css += `\n/* ${m.href} */\n${sheet}`;
      for (const f of sheet.matchAll(/font-family\s*:\s*([^;}]+)/gi)) fonts.add(f[1].trim());
    }
  }

  // Títulos desde la tabla de contenidos (nav EPUB3 o NCX).
  const titles = new Map<string, string>();
  const nav = [...manifest.values()].find((m) => /\bnav\b/.test(m.props));
  let printedFromNav: { href: string; label: string }[] = [];
  if (nav && zip.has(nav.href)) {
    const doc = parseHtml(await zip.text(nav.href));
    for (const navEl of [...doc.getElementsByTagName("nav")]) {
      const t = navEl.getAttribute("epub:type") ?? "";
      const links = [...navEl.getElementsByTagName("a")].map((a) => ({
        href: resolvePath(nav.href, a.getAttribute("href") ?? ""),
        frag: (a.getAttribute("href") ?? "").split("#")[1] ?? "",
        label: a.textContent?.trim() ?? "",
      }));
      if (/page-list/.test(t)) printedFromNav = links.map((l) => ({ href: `${l.href}#${l.frag}`, label: l.label }));
      else if (/toc/.test(t)) for (const l of links) if (!titles.has(l.href)) titles.set(l.href, l.label);
    }
  } else {
    const ncxId = byLocal(opf, "spine")[0]?.getAttribute("toc");
    const ncx = ncxId ? manifest.get(ncxId) : undefined;
    if (ncx && zip.has(ncx.href)) {
      const doc = xml(await zip.text(ncx.href));
      for (const np of byLocal(doc, "navPoint")) {
        const src = byLocal(np, "content")[0]?.getAttribute("src") ?? "";
        const href = resolvePath(ncx.href, src);
        if (!titles.has(href)) titles.set(href, firstText(np, "text"));
      }
    }
  }

  const footnotes: Record<string, Footnote> = {};
  const chapters: Chapter[] = [];
  const printedPages: PrintedPageMark[] = [];
  const spine = byLocal(opf, "itemref").map((r) => manifest.get(r.getAttribute("idref") ?? ""));
  for (const item of spine) {
    if (!item || !zip.has(item.href)) continue;
    const doc = parseHtml(await zip.text(item.href));
    const body = doc.body ?? doc.getElementsByTagName("body")[0];
    if (!body) continue;
    // Las hojas <style> internas se añaden al CSS global del libro.
    for (const st of [...doc.getElementsByTagName("style")]) css += `\n${st.textContent ?? ""}`;
    const p = processChapterBody(body, {
      footnotes,
      resolveImage: (src) => images[resolvePath(item.href, src)],
    });
    const idx = chapters.length;
    // Páginas impresas declaradas en page-list que apunten a este capítulo.
    for (const pl of printedFromNav) {
      const [href, frag] = pl.href.split("#");
      if (href !== item.href) continue;
      if (!p.pages.some((x) => x.label === pl.label)) {
        const off = frag ? findOffsetOfId(body, frag) : 0;
        if (off >= 0) p.pages.push({ label: pl.label, charOffset: off });
      }
    }
    printedPages.push(...toPrinted(idx, p.pages.sort((a, b) => a.charOffset - b.charOffset)));
    const h = body.querySelector("h1, h2, h3")?.textContent?.trim();
    chapters.push({
      id: item.href,
      title: titles.get(item.href) || h || `Capítulo ${idx + 1}`,
      html: p.html,
      text: p.text,
    });
  }
  // Capítulos que solo contienen notas ya extraídas no aportan nada.
  const kept = chapters.filter((c) => c.text.trim() || /<img/.test(c.html));
  return { format: "epub", metadata, chapters: kept.length ? kept : chapters, css, fonts: [...fonts], footnotes, printedPages, images };
}

function findOffsetOfId(body: Element, id: string): number {
  let off = 0;
  let found = -1;
  const walk = (n: Node): boolean => {
    if (n.nodeType === 1 && (n as Element).getAttribute("id") === id) {
      found = off;
      return true;
    }
    if (n.nodeType === 3) off += n.nodeValue?.length ?? 0;
    for (const c of [...n.childNodes]) if (walk(c)) return true;
    return false;
  };
  walk(body);
  return found;
}
