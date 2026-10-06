// Aplica en el DOM las herramientas de lectura enfocada calculadas en core/text.

import { segmentText } from "../core/text";

export function decorateFocus(root: HTMLElement, opts: { bionic: boolean; sentenceStart: boolean; ratio: number }) {
  if (!opts.bionic && !opts.sentenceStart) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest("script,style,code,pre,.rp-inline-note,sup") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  let atStart = true;
  let lastBlock: Element | null = null;
  for (const t of nodes) {
    const block = t.parentElement?.closest("p,div,li,h1,h2,h3,h4,h5,h6,blockquote") ?? null;
    if (block !== lastBlock) {
      atStart = true;
      lastBlock = block;
    }
    const { segments, atSentenceStart } = segmentText(t.nodeValue ?? "", opts, atStart);
    atStart = atSentenceStart;
    if (segments.length === 1 && !segments[0].bold && !segments[0].sentenceStart) continue;
    const frag = document.createDocumentFragment();
    for (const s of segments) {
      if (s.bold) {
        const b = document.createElement("b");
        b.className = "rp-bionic";
        b.textContent = s.text;
        frag.appendChild(b);
      } else if (s.sentenceStart) {
        const m = document.createElement("span");
        m.className = "rp-sentence-start";
        m.textContent = s.text;
        frag.appendChild(m);
      } else frag.appendChild(document.createTextNode(s.text));
    }
    t.replaceWith(frag);
  }
}

/** Localiza el nodo/offset DOM correspondiente a un offset en el texto plano del contenedor. */
export function rangeAtTextOffset(root: HTMLElement, offset: number, length = 1): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.nodeValue?.length ?? 0;
    if (acc + len > offset) {
      const r = document.createRange();
      r.setStart(n, offset - acc);
      r.setEnd(n, Math.min(len, offset - acc + length));
      return r;
    }
    acc += len;
  }
  return null;
}
