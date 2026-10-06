// Normalización HTML compartida por todos los formatos: saneado, notas al pie,
// páginas impresas y limpieza de formato. Requiere DOMParser (navegador/jsdom).

import type { Footnote, PrintedPageMark } from "../core/types";

const BLOCKED = "script,iframe,object,embed,form,input,button,link,meta,base,frame,frameset";
const NOTE_TYPES = /\b(footnote|endnote|rearnote|note)\b/;

export interface ProcessedChapter {
  html: string;
  text: string;
  pages: { label: string; charOffset: number }[];
}

export interface ProcessOptions {
  /** Resuelve src de imágenes internas a data URLs. */
  resolveImage?: (src: string) => string | undefined;
  /** Notas encontradas se acumulan aquí. */
  footnotes?: Record<string, Footnote>;
}

const epubType = (el: Element) =>
  el.getAttribute("epub:type") ?? el.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? "";

export function parseHtml(html: string): Document {
  const isXml = /^\s*<\?xml|xmlns=/.test(html);
  if (isXml) {
    const doc = new DOMParser().parseFromString(html, "application/xhtml+xml");
    if (!doc.querySelector("parsererror")) return doc;
  }
  return new DOMParser().parseFromString(html, "text/html");
}

/** Sanea y normaliza el <body> de un documento de capítulo. */
export function processChapterBody(body: Element, opts: ProcessOptions = {}): ProcessedChapter {
  body.querySelectorAll(BLOCKED).forEach((n) => n.remove());
  body.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      if (n.startsWith("on") || (/^(href|src|xlink:href)$/.test(n) && /^\s*javascript:/i.test(attr.value)))
        el.removeAttribute(attr.name);
    }
  });

  // Imágenes internas -> data URLs.
  body.querySelectorAll("img, image").forEach((img) => {
    const src = img.getAttribute("src") ?? img.getAttribute("xlink:href") ?? img.getAttribute("href") ?? "";
    const data = opts.resolveImage?.(src);
    if (data) {
      if (img.tagName.toLowerCase() === "image") {
        const repl = img.ownerDocument.createElement("img");
        repl.setAttribute("src", data);
        img.replaceWith(repl);
      } else img.setAttribute("src", data);
    }
  });

  // Notas al pie: se extraen y se retiran del flujo.
  if (opts.footnotes) {
    body.querySelectorAll("aside, [epub\\:type], [role='doc-footnote'], [role='doc-endnote']").forEach((el) => {
      const t = epubType(el);
      const role = el.getAttribute("role") ?? "";
      if (NOTE_TYPES.test(t) || /doc-(foot|end)note/.test(role)) {
        const id = el.getAttribute("id");
        if (id) {
          opts.footnotes![id] = { id, html: el.innerHTML };
          el.remove();
        }
      }
    });
  }

  // Marcadores de página impresa.
  body.querySelectorAll("[epub\\:type], [role='doc-pagebreak']").forEach((el) => {
    if (/\bpagebreak\b/.test(epubType(el)) || el.getAttribute("role") === "doc-pagebreak") {
      const label = el.getAttribute("title") ?? el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.id;
      const span = el.ownerDocument.createElement("span");
      span.setAttribute("data-printed-page", label || "?");
      if (el.id) span.id = el.id;
      el.replaceWith(span);
    }
  });

  // Calcular offsets de páginas impresas sobre el texto plano.
  const pages: { label: string; charOffset: number }[] = [];
  let text = "";
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      text += node.nodeValue ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const label = el.getAttribute("data-printed-page");
    if (label) pages.push({ label, charOffset: text.length });
    const block = /^(p|div|h[1-6]|li|br|blockquote|section|tr)$/i.test(el.tagName);
    el.childNodes.forEach(walk);
    if (block && !text.endsWith("\n")) text += "\n";
  };
  walk(body);

  return { html: body.innerHTML, text: text.replace(/[ \t]+\n/g, "\n").trim(), pages };
}

export function toPrinted(chapterIndex: number, pages: ProcessedChapter["pages"]): PrintedPageMark[] {
  return pages.map((p) => ({ ...p, chapterIndex }));
}

export interface RenderOptions {
  removeEmptyLines: boolean;
  collapseSpaces: boolean;
  inlineFootnotes: boolean;
  footnotes: Record<string, Footnote>;
}

/**
 * Transformaciones dependientes de ajustes antes de pintar un capítulo:
 * limpieza de párrafos vacíos/espacios dobles y notas al pie en línea.
 */
export function prepareChapterHtml(html: string, o: RenderOptions): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;
  if (o.removeEmptyLines) {
    body.querySelectorAll("p, div").forEach((el) => {
      if (!el.textContent?.trim() && !el.querySelector("img, svg, hr, [data-printed-page]")) el.remove();
    });
    body.querySelectorAll("br + br").forEach((br) => br.remove());
  }
  if (o.collapseSpaces) {
    const w = doc.createTreeWalker(body, 4 /* SHOW_TEXT */);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      n.nodeValue = (n.nodeValue ?? "").replace(/[ \t ]{2,}/g, " ");
    }
  }
  // Las notas se muestran en línea o como desplegable al pulsar.
  body.querySelectorAll("a[href*='#']").forEach((a) => {
    const target = (a.getAttribute("href") ?? "").split("#")[1];
    const note = target ? o.footnotes[target] : undefined;
    if (!note) return;
    a.setAttribute("data-note", note.id);
    a.classList.add("rp-noteref");
    if (o.inlineFootnotes) {
      const span = doc.createElement("span");
      span.className = "rp-inline-note";
      span.innerHTML = note.html;
      a.after(span);
    }
  });
  return body.innerHTML;
}
