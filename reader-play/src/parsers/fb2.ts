// Parser FictionBook 2 (XML). Convierte secciones a HTML.

import type { Chapter, Footnote, ParsedBook } from "../core/types";
import { processChapterBody } from "./html";

const TAGS: Record<string, string> = {
  p: "p",
  emphasis: "em",
  strong: "strong",
  strikethrough: "s",
  sub: "sub",
  sup: "sup",
  code: "code",
  cite: "blockquote",
  epigraph: "blockquote",
  poem: "div",
  stanza: "div",
  v: "p",
  "text-author": "p",
  subtitle: "h3",
  "empty-line": "br",
  table: "table",
  tr: "tr",
  td: "td",
  th: "th",
};

function decodeFb2(buf: ArrayBuffer): string {
  const head = new TextDecoder("ascii").decode(new Uint8Array(buf).subarray(0, 200));
  const enc = /encoding=["']([\w-]+)["']/i.exec(head)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

export async function parseFb2(buf: ArrayBuffer): Promise<ParsedBook> {
  const doc = new DOMParser().parseFromString(decodeFb2(buf), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("FB2 no válido");
  const all = (root: ParentNode, name: string) =>
    [...(root as Element).getElementsByTagName("*")].filter((e) => e.localName === name);
  const first = (root: ParentNode, name: string) => all(root, name)[0];

  const images: Record<string, string> = {};
  for (const b of all(doc, "binary")) {
    images[b.getAttribute("id") ?? ""] = `data:${b.getAttribute("content-type") ?? "image/jpeg"};base64,${(b.textContent ?? "").replace(/\s+/g, "")}`;
  }

  const out = document.implementation.createHTMLDocument("");
  const convert = (node: Node): Node | null => {
    if (node.nodeType === 3) return out.createTextNode(node.nodeValue ?? "");
    if (node.nodeType !== 1) return null;
    const el = node as Element;
    const name = el.localName;
    if (name === "image") {
      const href = el.getAttribute("l:href") ?? el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? el.getAttribute("href") ?? "";
      const img = out.createElement("img");
      img.setAttribute("src", images[href.replace(/^#/, "")] ?? "");
      return img;
    }
    if (name === "a") {
      const a = out.createElement("a");
      const href = el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? el.getAttribute("l:href") ?? "";
      a.setAttribute("href", href);
      el.childNodes.forEach((c) => {
        const k = convert(c);
        if (k) a.appendChild(k);
      });
      return a;
    }
    if (name === "title") {
      const h = out.createElement("h2");
      h.textContent = el.textContent?.trim().replace(/\s+/g, " ") ?? "";
      return h;
    }
    const tag = name === "section" ? "section" : TAGS[name] ?? "span";
    const h = out.createElement(tag);
    if (el.getAttribute("id")) h.id = el.getAttribute("id")!;
    el.childNodes.forEach((c) => {
      const k = convert(c);
      if (k) h.appendChild(k);
    });
    return h;
  };

  const info = first(doc, "title-info");
  const authorEl = info ? first(info, "author") : undefined;
  const author = authorEl
    ? ["first-name", "middle-name", "last-name"].map((n) => first(authorEl, n)?.textContent?.trim()).filter(Boolean).join(" ")
    : "";
  const metadata = {
    title: (info && first(info, "book-title")?.textContent?.trim()) || "Sin título",
    author: author || "Autor desconocido",
    synopsis: (info && first(info, "annotation")?.textContent?.trim().replace(/\s+/g, " ")) || "",
    language: (info && first(info, "lang")?.textContent?.trim()) || undefined,
  };

  const bodies = all(doc, "body");
  const footnotes: Record<string, Footnote> = {};
  for (const b of bodies.filter((b) => b.getAttribute("name") === "notes")) {
    for (const s of all(b, "section")) {
      const id = s.getAttribute("id");
      if (!id) continue;
      const div = convert(s) as HTMLElement;
      div.querySelector("h2")?.remove();
      footnotes[id] = { id, html: div.innerHTML };
    }
  }

  const chapters: Chapter[] = [];
  const main = bodies.find((b) => b.getAttribute("name") !== "notes");
  if (main) {
    const topSections = [...main.children].filter((c) => c.localName === "section");
    const units = topSections.length ? topSections : [main];
    for (const sec of units) {
      const body = out.createElement("div");
      const conv = convert(sec);
      if (conv) body.appendChild(conv);
      const p = processChapterBody(body);
      const title = body.querySelector("h2")?.textContent?.trim();
      chapters.push({ id: `s${chapters.length}`, title: title || `Capítulo ${chapters.length + 1}`, html: p.html, text: p.text });
    }
  }
  return { format: "fb2", metadata, chapters, css: "", fonts: [], footnotes, printedPages: [], images };
}
