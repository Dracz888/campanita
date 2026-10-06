import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { continuousAlertDue, scheduledAlertDue } from "../core/alerts";
import { kelvinToRgb, type Orientation } from "../core/settings";
import { averageWpm, bookCounts, formatDuration, percentOf, positionAtPercent, timeRemaining } from "../core/stats";
import { excerptAt, searchText } from "../core/text";
import type { Bookmark, BookRecord, Note, ParsedBook, Position } from "../core/types";
import { prepareChapterHtml } from "../parsers/html";
import { loadDeleted, putBook, saveDeleted } from "../store/db";
import { useSettings } from "../store/settingsContext";
import { BookInfo } from "./BookInfo";
import { decorateFocus, rangeAtTextOffset } from "./decorate";
import {
  applyOrientation,
  applySystemBar,
  notify,
  playPageSound,
  requestTiltPermission,
  useTilt,
  useWakeLock,
} from "./device";
import { Modal, Range } from "./widgets";

interface Props {
  record: BookRecord;
  book: ParsedBook;
  persist: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onPrevFile: () => void;
  onNextFile: () => void;
}

type Panel = null | "toc" | "search" | "bookmarks" | "info" | "edit" | "brightness" | "font";

const IDLE_CAP_MS = 2 * 60_000;
const uid = () => Math.random().toString(36).slice(2, 10);

export function Reader({ record: initial, book, persist, onClose, onOpenSettings, onPrevFile, onNextFile }: Props) {
  const { settings: s, update } = useSettings();
  const [record, setRecord] = useState(initial);
  const [chapter, setChapter] = useState(Math.min(initial.position.chapterIndex, book.chapters.length - 1));
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [rulerY, setRulerY] = useState(0.4);
  const [now, setNow] = useState(() => new Date());

  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pendingProgress = useRef<number>(initial.position.progress);
  const searchJump = useRef<{ query: string; nth: number } | null>(null);

  const counts = useMemo(() => bookCounts(book), [book]);
  const ch = book.chapters[chapter];
  const vertical = s.verticalScroll;
  const dual = !vertical && (s.dualPage === "on" || (s.dualPage === "auto" && size.w >= 900 && size.w > size.h));
  const pad = Math.max(16, Math.round(size.w * 0.05));
  const colStep = size.w; // ancho de una "pantalla" de columnas

  const progress = vertical ? scrollProgress : pageCount > 1 ? page / (pageCount - 1) : 0;
  const position: Position = useMemo(() => ({ chapterIndex: chapter, progress }), [chapter, progress]);
  const percent = percentOf(counts, position);
  const wpm = averageWpm(record.sessions, s.wpmFallback);
  const left = timeRemaining(counts, position, wpm);
  const charsPerPage = ch && pageCount > 0 ? Math.max(1, ch.text.length / pageCount) : 1500;
  const totalChars = book.chapters.reduce((n, c) => n + c.text.length, 0);
  const estimatedPages = Math.max(1, Math.round(totalChars / charsPerPage));
  const charsBefore = book.chapters.slice(0, chapter).reduce((n, c) => n + c.text.length, 0);
  const globalPage = Math.min(estimatedPages, Math.floor((charsBefore + progress * (ch?.text.length ?? 0)) / charsPerPage) + 1);
  const printed = useMemo(() => {
    const off = progress * (ch?.text.length ?? 0);
    let label: string | null = null;
    for (const m of book.printedPages) {
      if (m.chapterIndex < chapter || (m.chapterIndex === chapter && m.charOffset <= off)) label = m.label;
    }
    return label;
  }, [book.printedPages, chapter, progress, ch]);

  // ---------- Persistencia de posición ----------
  const save = useCallback(
    (r: BookRecord) => {
      if (persist) putBook(r).catch(() => {});
    },
    [persist],
  );
  useEffect(() => {
    const t = setTimeout(() => {
      setRecord((r) => {
        const next = { ...r, position, positionUpdatedAt: new Date().toISOString() };
        save(next);
        return next;
      });
    }, 600);
    return () => clearTimeout(t);
  }, [position, save]);

  // ---------- Telemetría de sesión ----------
  const session = useRef({ start: Date.now(), last: Date.now(), active: 0, startPercent: percent, alerts: 0 });
  const percentRef = useRef(percent);
  percentRef.current = percent;
  const touchActivity = useCallback(() => {
    const t = Date.now();
    session.current.active += Math.min(t - session.current.last, IDLE_CAP_MS);
    session.current.last = t;
  }, []);
  const flushSession = useCallback(() => {
    touchActivity();
    const ses = session.current;
    if (ses.active >= 10_000) {
      const endPercent = percentRef.current;
      const entry = {
        bookId: initial.id,
        start: new Date(ses.start).toISOString(),
        durationMs: ses.active,
        wordsRead: Math.max(0, Math.round(((endPercent - ses.startPercent) / 100) * counts.words)),
        startPercent: ses.startPercent,
        endPercent,
      };
      setRecord((r) => {
        const next = { ...r, sessions: [...r.sessions, entry] };
        save(next);
        return next;
      });
    }
    session.current = { start: Date.now(), last: Date.now(), active: 0, startPercent: percentRef.current, alerts: 0 };
  }, [counts.words, initial.id, save, touchActivity]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") flushSession();
      else session.current.last = Date.now();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      flushSession();
    };
  }, [flushSession]);

  // ---------- Dispositivo / SO ----------
  useWakeLock(s.keepScreenOn);
  useEffect(() => {
    applyOrientation(s.orientation);
  }, [s.orientation]);
  useEffect(() => {
    if (s.showSystemBar) applySystemBar(true);
  }, [s.showSystemBar]);

  // Reloj, recordatorios de descanso y alertas programadas.
  const fired = useRef(new Set<string>());
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNow(d);
      const c = continuousAlertDue(session.current.start, d.getTime(), s.continuousReadingAlertMin, session.current.alerts);
      session.current.alerts = c.count;
      const msg = c.due
        ? `Llevas ${s.continuousReadingAlertMin * c.count} min leyendo. Descansa la vista: mira a lo lejos 20 segundos.`
        : scheduledAlertDue(s.scheduledAlerts, d, fired.current)
          ? "Recordatorio programado: es hora de hacer una pausa."
          : null;
      if (msg) {
        setToast(msg);
        notify("Reader Play", msg);
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [s.continuousReadingAlertMin, s.scheduledAlerts]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------- Medidas ----------
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ---------- Renderizado del capítulo ----------
  const html = useMemo(
    () =>
      ch
        ? prepareChapterHtml(overrides[chapter] ?? ch.html, {
            removeEmptyLines: s.removeEmptyLines,
            collapseSpaces: s.collapseSpaces,
            inlineFootnotes: s.inlineFootnotes,
            footnotes: book.footnotes,
          })
        : "",
    [ch, chapter, overrides, s.removeEmptyLines, s.collapseSpaces, s.inlineFootnotes, book.footnotes],
  );

  const measure = useCallback(() => {
    const el = content.current;
    if (!el || vertical || colStep === 0) return;
    const count = Math.max(1, Math.ceil((el.scrollWidth - 1) / colStep));
    setPageCount(count);
    return count;
  }, [vertical, colStep]);

  const restore = useCallback(
    (count: number) => {
      const p = pendingProgress.current;
      pendingProgress.current = NaN;
      const vp = viewport.current;
      if (Number.isNaN(p)) return;
      if (vertical && vp) {
        vp.scrollTop = p * (vp.scrollHeight - vp.clientHeight);
        setScrollProgress(p);
      } else setPage(Math.round(p * (count - 1)));
    },
    [vertical],
  );

  useLayoutEffect(() => {
    const el = content.current;
    if (!el || size.w === 0) return;
    // Conservar la posición relativa si cambia la maquetación del mismo capítulo.
    if (Number.isNaN(pendingProgress.current)) pendingProgress.current = progress;
    el.innerHTML = html;
    decorateFocus(el, { bionic: s.bionicReading, sentenceStart: s.highlightSentenceStart, ratio: s.bionicRatio });
    const count = measure() ?? 1;
    restore(count);
    const imgs = [...el.querySelectorAll("img")];
    const onLoad = () => measure();
    imgs.forEach((i) => i.addEventListener("load", onLoad));
    // Salto a un resultado de búsqueda.
    const sj = searchJump.current;
    if (sj) {
      searchJump.current = null;
      const domText = el.textContent ?? "";
      const off = searchText(domText, sj.query)[sj.nth] ?? searchText(domText, sj.query)[0];
      const r = off !== undefined ? rangeAtTextOffset(el, off, sj.query.length) : null;
      if (r) {
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
        const rect = r.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        if (vertical && viewport.current) viewport.current.scrollTop += rect.top - box.top - size.h / 3;
        else setPage(Math.max(0, Math.floor((rect.left - box.left) / colStep)));
      }
    }
    return () => imgs.forEach((i) => i.removeEventListener("load", onLoad));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, size.w, size.h, dual, vertical, s.fontSize, s.lineHeight, s.fontFamily, s.bionicReading, s.highlightSentenceStart, s.bionicRatio, s.autoIndent, s.trimPageTop, s.disableBookCss, s.fontPolicy]);

  // ---------- Navegación ----------
  const goChapter = useCallback(
    (i: number, p = 0) => {
      if (i < 0 || i >= book.chapters.length) return;
      touchActivity();
      pendingProgress.current = p;
      if (i === chapter) restore(pageCount);
      setChapter(i);
      setPage(0);
    },
    [book.chapters.length, chapter, pageCount, restore, touchActivity],
  );

  const turn = useCallback(
    (dir: 1 | -1) => {
      touchActivity();
      if (s.pageTurnSound) playPageSound();
      if (vertical) {
        const vp = viewport.current!;
        const atEnd = vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 2;
        const atStart = vp.scrollTop <= 0;
        if (dir === 1 && atEnd) return goChapter(chapter + 1, 0);
        if (dir === -1 && atStart) return goChapter(chapter - 1, 1);
        vp.scrollBy({ top: dir * (vp.clientHeight - s.fontSize * s.lineHeight * 2), behavior: "smooth" });
        return;
      }
      const next = page + dir;
      if (next >= pageCount) goChapter(chapter + 1, 0);
      else if (next < 0) goChapter(chapter - 1, 1);
      else setPage(next);
    },
    [chapter, goChapter, page, pageCount, s.fontSize, s.lineHeight, s.pageTurnSound, touchActivity, vertical],
  );

  useTilt(s.tiltToTurn, s.tiltSensitivity, turn);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) turn(1);
      else if (["ArrowLeft", "PageUp"].includes(e.key)) turn(-1);
      else if (e.key === "Escape") setMenu((m) => !m);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [turn]);

  // ---------- Gestos táctiles y bordes ----------
  const gesture = useRef<{ x: number; y: number; t: number; zone: "left" | "right" | "mid"; start: number; adjusting: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (panel || (e.target as HTMLElement).closest(".rp-ruler, .rp-popup")) return;
    const rect = viewport.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const dead = s.disableEdgesOnCurved ? 28 : 0;
    if (x < dead || x > rect.width - dead) {
      gesture.current = null;
      return;
    }
    const edge = Math.max(36, rect.width * 0.1);
    const zone = x < dead + edge ? "left" : x > rect.width - dead - edge ? "right" : "mid";
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      zone,
      start: zone === "left" ? s.brightness : s.fontSize,
      adjusting: false,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.zone === "mid" || selectMode) return;
    const dy = g.y - e.clientY;
    if (!g.adjusting && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(e.clientX - g.x)) {
      if ((g.zone === "left" && s.edgeBrightnessGesture) || (g.zone === "right" && s.edgeFontSizeGesture)) g.adjusting = true;
    }
    if (!g.adjusting) return;
    const frac = dy / size.h;
    if (g.zone === "left") {
      const b = Math.min(1, Math.max(0.2, g.start + frac));
      update({ brightness: Math.round(b * 100) / 100 });
      setHint(`☀️ Brillo ${Math.round(b * 100)} %`);
    } else {
      const f = Math.min(48, Math.max(10, Math.round(g.start + frac * 30)));
      if (f !== s.fontSize) update({ fontSize: f });
      setHint(`🔠 Fuente ${f} px`);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.adjusting) {
      setTimeout(() => setHint(null), 700);
      return;
    }
    if (selectMode && getSelection()?.toString()) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!vertical && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && Date.now() - g.t < 800) {
      turn(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    // Toque: nota al pie, zonas de paso de página o menú.
    const ref = (e.target as HTMLElement).closest(".rp-noteref") as HTMLElement | null;
    if (ref) {
      e.preventDefault();
      if (!s.inlineFootnotes) setNote(book.footnotes[ref.dataset.note ?? ""]?.html ?? null);
      return;
    }
    if ((e.target as HTMLElement).closest("a")) return;
    const rect = viewport.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (menu) setMenu(false);
    else if (x < 0.3) turn(-1);
    else if (x > 0.7) turn(1);
    else setMenu(true);
    if (!s.showSystemBar) applySystemBar(false);
  };

  // ---------- Selección de texto + diccionario ----------
  useEffect(() => {
    if (!selectMode) return;
    const h = () => {
      const sel = getSelection();
      const text = sel?.toString().trim();
      if (!sel || !text || !content.current?.contains(sel.anchorNode)) return setSelection(null);
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setSelection({ text, x: r.left + r.width / 2, y: r.top });
    };
    document.addEventListener("selectionchange", h);
    return () => document.removeEventListener("selectionchange", h);
  }, [selectMode]);

  // ---------- Desplazamiento automático ----------
  useEffect(() => {
    if (!autoScroll) return;
    if (vertical) {
      let raf = 0;
      let last = performance.now();
      const tick = (t: number) => {
        const vp = viewport.current!;
        vp.scrollTop += (s.autoScrollSpeed * (t - last)) / 1000;
        last = t;
        if (vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 1) {
          if (chapter < book.chapters.length - 1) goChapter(chapter + 1, 0);
          else setAutoScroll(false);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    const id = setInterval(() => turn(1), Math.max(2, size.h / Math.max(1, s.autoScrollSpeed)) * 1000);
    return () => clearInterval(id);
  }, [autoScroll, vertical, s.autoScrollSpeed, size.h, turn, chapter, book.chapters.length, goChapter]);

  // ---------- Texto a voz ----------
  const ttsToken = useRef(0);
  const speakFrom = useCallback(
    (ci: number, fromProgress: number) => {
      const synth = window.speechSynthesis;
      if (!synth) return setToast("Tu navegador no soporta texto a voz.");
      synth.cancel();
      const token = ++ttsToken.current;
      const text = book.chapters[ci]?.text ?? "";
      const start = Math.floor(fromProgress * text.length);
      const chunks: { at: number; text: string }[] = [];
      const re = /[^.!?¡¿…\n]+[.!?…]*\s*/g;
      re.lastIndex = start;
      for (let m = re.exec(text); m; m = re.exec(text)) if (m[0].trim()) chunks.push({ at: m.index, text: m[0] });
      let i = 0;
      const next = () => {
        if (token !== ttsToken.current) return;
        if (i >= chunks.length) {
          if (ci + 1 < book.chapters.length) {
            goChapter(ci + 1, 0);
            speakFrom(ci + 1, 0);
          } else setSpeaking(false);
          return;
        }
        const c = chunks[i++];
        const u = new SpeechSynthesisUtterance(c.text);
        u.lang = book.metadata.language ?? "es";
        u.rate = s.ttsRate;
        u.onend = () => {
          if (token !== ttsToken.current) return;
          pendingProgress.current = Math.min(1, (c.at + c.text.length) / Math.max(1, text.length));
          restore(pageCountRef.current);
          touchActivity();
          next();
        };
        synth.speak(u);
      };
      next();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book, goChapter, s.ttsRate, touchActivity],
  );
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;
  const toggleSpeak = () => {
    if (speaking) {
      ttsToken.current++;
      speechSynthesis.cancel();
      setSpeaking(false);
    } else {
      setSpeaking(true);
      speakFrom(chapter, progress);
    }
  };
  useEffect(
    () => () => {
      ttsToken.current++;
      window.speechSynthesis?.cancel();
    },
    [],
  );

  // ---------- Marcadores y notas ----------
  const tombstone = (id: string) => {
    const d = loadDeleted();
    d[record.id] = [...(d[record.id] ?? []), id];
    saveDeleted(d);
  };
  const currentBookmark = record.bookmarks.find(
    (b) => b.position.chapterIndex === chapter && Math.abs(b.position.progress - progress) < 0.5 / Math.max(1, pageCount),
  );
  const toggleBookmark = () => {
    const t = new Date().toISOString();
    setRecord((r) => {
      let bookmarks: Bookmark[];
      if (currentBookmark) {
        tombstone(currentBookmark.id);
        bookmarks = r.bookmarks.filter((b) => b.id !== currentBookmark.id);
      } else {
        const ex = excerptAt(ch.text, Math.floor(progress * ch.text.length), 50);
        bookmarks = [...r.bookmarks, { id: uid(), position, excerpt: ex, createdAt: t, updatedAt: t }];
      }
      const next = { ...r, bookmarks };
      save(next);
      return next;
    });
  };
  const addNote = (quote: string) => {
    const text = prompt("Nota:", "") ?? "";
    const t = new Date().toISOString();
    const n: Note = { id: uid(), position, quote, text, createdAt: t, updatedAt: t };
    setRecord((r) => {
      const next = { ...r, notes: [...r.notes, n] };
      save(next);
      return next;
    });
  };

  // ---------- Estilos ----------
  const [r, g, b] = kelvinToRgb(s.blueFilterTemperature);
  const contentStyle: CSSProperties = {
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    ...(s.fontPolicy === "global" ? { fontFamily: s.fontFamily } : {}),
    ...(vertical
      ? { padding: `${pad}px` }
      : {
          height: size.h - pad * 2,
          width: size.w - pad * 2,
          columnWidth: dual ? (size.w - pad * 4) / 2 : size.w - pad * 2,
          columnGap: pad * 2,
          columnFill: "auto",
          transform: `translateX(${-page * colStep}px)`,
          transition: s.pageTransition === "slide" ? "transform 0.28s ease" : "none",
          margin: pad,
        }),
  };
  const bookCss = s.disableBookCss ? "" : scopeCss(book.css, s.fontPolicy === "global");
  const showTime = s.showTimeLeft;
  const progressLabel = s.progressDisplay === "percent" ? `${percent.toFixed(1)} %` : `p. ${globalPage} / ${estimatedPages}`;

  if (!ch) return <p className="rp-empty">Este libro no tiene contenido legible.</p>;

  return (
    <div className={`rp-reader ${s.toolbarLayout === "double" ? "tb-double" : ""}`} style={{ fontFamily: s.fontFamily }}>
      <style>{bookCss}</style>
      <style>{`
        .rp-content p { text-indent: ${s.autoIndent ? "1.5em" : "0"}; ${s.trimPageTop ? "margin: 0 0 .25em;" : ""} }
        .rp-content [data-printed-page]::after { ${s.showPrintedPages ? "" : "display:none;"} }
      `}</style>

      {/* Barra superior */}
      {menu && (
        <header className="rp-topbar">
          <button className="icon" aria-label="Volver a la biblioteca" onClick={onClose}>
            ←
          </button>
          <div className="rp-title">
            <b>{book.metadata.title}</b>
            <small>{ch.title}</small>
          </div>
          <button className="icon" aria-label="Vista de edición" title="Vista de edición" onClick={() => setPanel("edit")}>
            ✏️
          </button>
          <button className={`icon ${currentBookmark ? "on" : ""}`} aria-label="Marcador" onClick={toggleBookmark}>
            🔖
          </button>
          <button className="icon" aria-label="Información del libro" onClick={() => setPanel("info")}>
            ℹ️
          </button>
          <button className="icon" aria-label="Ajustes" onClick={onOpenSettings}>
            ⚙️
          </button>
        </header>
      )}

      <div
        ref={viewport}
        className={`rp-viewport ${vertical ? "vertical" : "paged"} ${selectMode ? "selectable" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onScroll={(e) => {
          if (!vertical) return;
          const el = e.currentTarget;
          setScrollProgress(el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0);
          touchActivity();
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) e.preventDefault();
        }}
      >
        <div ref={content} className="rp-content" style={contentStyle} />
      </div>

      {/* Capas de salud visual */}
      <div className="rp-dim" style={{ opacity: 1 - s.brightness }} />
      {s.blueFilter && <div className="rp-bluefilter" style={{ background: `rgb(${r},${g},${b})`, opacity: s.blueFilterOpacity }} />}
      {s.readingRuler && (
        <div
          className="rp-ruler"
          style={{ top: `${rulerY * 100}%`, height: s.fontSize * s.lineHeight + 6 }}
          onPointerDown={(e) => (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)}
          onPointerMove={(e) => {
            if (e.buttons || e.pointerType === "touch") setRulerY(Math.min(0.95, Math.max(0.02, e.clientY / window.innerHeight)));
          }}
        />
      )}

      {hint && <div className="rp-hint">{hint}</div>}
      {toast && (
        <div className="rp-toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}

      {/* Barra de estado */}
      {!menu && s.miniStatusBar && (
        <footer className="rp-ministatus">
          <span>{ch.title}</span>
          {printed && s.showPrintedPages && <span>impr. {printed}</span>}
          {showTime && <span>⏱ cap. {formatDuration(left.chapterMin)} · libro {formatDuration(left.bookMin)}</span>}
          <span>{now.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</span>
          <button className="link" onClick={() => update({ progressDisplay: s.progressDisplay === "percent" ? "page" : "percent" })}>
            {progressLabel}
          </button>
        </footer>
      )}

      {/* Barra de herramientas rápidas */}
      {menu && (
        <nav className="rp-toolbar" aria-label="Herramientas">
          <div className="rp-progress">
            <span>{progressLabel}</span>
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(percent * 10)}
              aria-label="Progreso"
              onChange={(e) => {
                const p = positionAtPercent(counts, Number(e.target.value) / 10);
                goChapter(p.chapterIndex, p.progress);
              }}
            />
            {showTime && <small>Cap.: {formatDuration(left.chapterMin)} · Libro: {formatDuration(left.bookMin)}</small>}
          </div>
          <div className="rp-tools">
            <Tool label="Índice" icon="☰" onClick={() => setPanel("toc")} />
            <Tool label="Seleccionar" icon="✂️" on={selectMode} onClick={() => setSelectMode((v) => !v)} />
            <Tool label="Buscar" icon="🔍" onClick={() => setPanel("search")} />
            <Tool label="Auto-scroll" icon="⏬" on={autoScroll} onClick={() => setAutoScroll((v) => !v)} />
            <Tool label="Hablar" icon={speaking ? "⏹" : "🔊"} on={speaking} onClick={toggleSpeak} />
            <Tool label="Cap. ant." icon="⏮" onClick={() => goChapter(chapter - 1, 0)} />
            <Tool label="Cap. sig." icon="⏭" onClick={() => goChapter(chapter + 1, 0)} />
            <Tool label="Archivo ant." icon="📕" onClick={onPrevFile} />
            <Tool label="Archivo sig." icon="📗" onClick={onNextFile} />
            <Tool label="Marcadores" icon="🔖" onClick={() => setPanel("bookmarks")} />
            <Tool label="Brillo" icon="☀️" onClick={() => setPanel("brightness")} />
            <Tool label="Fuente" icon="🔠" onClick={() => setPanel("font")} />
            <Tool
              label="Orientación"
              icon="🔄"
              onClick={() => {
                const order: Orientation[] = ["auto", "portrait", "landscape"];
                const o = order[(order.indexOf(s.orientation) + 1) % order.length];
                update({ orientation: o });
                setToast(`Orientación: ${{ auto: "automática", portrait: "vertical", landscape: "horizontal" }[o]}`);
              }}
            />
            <Tool
              label="Inclinación"
              icon="📐"
              on={s.tiltToTurn}
              onClick={async () => {
                if (!s.tiltToTurn && !(await requestTiltPermission())) return setToast("Permiso de sensores denegado.");
                update({ tiltToTurn: !s.tiltToTurn });
              }}
            />
          </div>
        </nav>
      )}

      {/* Popup de selección */}
      {selection && selectMode && (
        <div className="rp-popup" style={{ left: Math.max(8, selection.x - 140), top: Math.max(8, selection.y - 56) }}>
          <button onClick={() => navigator.clipboard?.writeText(selection.text)}>Copiar</button>
          <button
            onClick={() => {
              const w = selection.text.toLowerCase();
              const def = s.dictionary[w];
              setNote(
                def
                  ? `<b>${escapeHtml(w)}</b>: ${escapeHtml(def)}`
                  : `<b>${escapeHtml(w)}</b> no está en tu diccionario. <a href="https://es.wiktionary.org/wiki/${encodeURIComponent(w)}" target="_blank" rel="noopener">Buscar en Wikcionario</a>`,
              );
            }}
          >
            Diccionario
          </button>
          <button
            onClick={() => {
              const def = prompt(`Definición para «${selection.text}»:`, s.dictionary[selection.text.toLowerCase()] ?? "");
              if (def != null) update({ dictionary: { ...s.dictionary, [selection.text.toLowerCase()]: def } });
            }}
          >
            ＋Def.
          </button>
          <button onClick={() => addNote(selection.text)}>Nota</button>
          <button
            onClick={() => {
              const u = new SpeechSynthesisUtterance(selection.text);
              u.lang = book.metadata.language ?? "es";
              speechSynthesis.speak(u);
            }}
          >
            Hablar
          </button>
        </div>
      )}

      {note && (
        <Modal title="Nota" onClose={() => setNote(null)}>
          <div className="rp-note" dangerouslySetInnerHTML={{ __html: note }} />
        </Modal>
      )}

      {panel === "info" && (
        <BookInfo record={record} book={book} position={position} estimatedPages={estimatedPages} wpmFallback={s.wpmFallback} onClose={() => setPanel(null)} />
      )}
      {panel === "toc" && (
        <Modal title="Índice" onClose={() => setPanel(null)}>
          <ol className="rp-list">
            {book.chapters.map((c, i) => (
              <li key={c.id} className={i === chapter ? "current" : ""}>
                <button
                  className="link"
                  onClick={() => {
                    goChapter(i, 0);
                    setPanel(null);
                  }}
                >
                  {c.title}
                </button>
              </li>
            ))}
          </ol>
        </Modal>
      )}
      {panel === "search" && (
        <SearchPanel
          book={book}
          onClose={() => setPanel(null)}
          onPick={(ci, prog, query, nth) => {
            searchJump.current = { query, nth };
            goChapter(ci, prog);
            setPanel(null);
            setMenu(false);
          }}
        />
      )}
      {panel === "bookmarks" && (
        <Modal title="Marcadores y notas" onClose={() => setPanel(null)}>
          {record.bookmarks.length + record.notes.length === 0 && <p className="muted">Sin marcadores ni notas.</p>}
          <ul className="rp-list">
            {[...record.bookmarks.map((b) => ({ ...b, kind: "🔖", body: b.excerpt })), ...record.notes.map((n) => ({ ...n, kind: "📝", body: `«${n.quote}» — ${n.text}` }))]
              .sort((a, b) => a.position.chapterIndex - b.position.chapterIndex || a.position.progress - b.position.progress)
              .map((it) => (
                <li key={it.id} className="rp-row">
                  <button
                    className="link grow"
                    onClick={() => {
                      goChapter(it.position.chapterIndex, it.position.progress);
                      setPanel(null);
                    }}
                  >
                    {it.kind} <small>{book.chapters[it.position.chapterIndex]?.title}</small>
                    <br />
                    {it.body}
                  </button>
                  <button
                    className="icon"
                    aria-label="Eliminar"
                    onClick={() => {
                      tombstone(it.id);
                      setRecord((r) => {
                        const next = { ...r, bookmarks: r.bookmarks.filter((x) => x.id !== it.id), notes: r.notes.filter((x) => x.id !== it.id) };
                        save(next);
                        return next;
                      });
                    }}
                  >
                    🗑️
                  </button>
                </li>
              ))}
          </ul>
        </Modal>
      )}
      {panel === "brightness" && (
        <Modal title="Brillo" onClose={() => setPanel(null)}>
          <Range label="Brillo" value={s.brightness} min={0.2} max={1} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => update({ brightness: v })} />
        </Modal>
      )}
      {panel === "font" && (
        <Modal title="Fuente" onClose={() => setPanel(null)}>
          <Range label="Tamaño" value={s.fontSize} min={10} max={48} format={(v) => `${v} px`} onChange={(v) => update({ fontSize: v })} />
          <Range label="Interlineado" value={s.lineHeight} min={1} max={2.5} step={0.05} onChange={(v) => update({ lineHeight: v })} />
        </Modal>
      )}
      {panel === "edit" && (
        <EditPanel
          html={overrides[chapter] ?? ch.html}
          onClose={() => setPanel(null)}
          onApply={(h) => {
            pendingProgress.current = progress;
            setOverrides((o) => ({ ...o, [chapter]: h }));
            setPanel(null);
          }}
        />
      )}
    </div>
  );
}

function Tool({ label, icon, on, onClick }: { label: string; icon: string; on?: boolean; onClick: () => void }) {
  return (
    <button className={`rp-tool ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}>
      <span aria-hidden>{icon}</span>
      <small>{label}</small>
    </button>
  );
}

function SearchPanel({ book, onClose, onPick }: { book: ParsedBook; onClose: () => void; onPick: (ci: number, p: number, q: string, nth: number) => void }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    const out: { ci: number; off: number; nth: number; ex: string }[] = [];
    book.chapters.forEach((c, ci) => {
      searchText(c.text, q, 50).forEach((off, nth) => out.push({ ci, off, nth, ex: excerptAt(c.text, off) }));
    });
    return out.slice(0, 300);
  }, [book, q]);
  return (
    <Modal title="Buscar en el libro" onClose={onClose}>
      <input autoFocus className="rp-input" placeholder="Texto a buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="muted">{q.trim().length >= 2 ? `${results.length} resultados` : "Escribe al menos 2 caracteres."}</p>
      <ul className="rp-list">
        {results.map((r) => (
          <li key={`${r.ci}-${r.off}`}>
            <button className="link" onClick={() => onPick(r.ci, r.off / Math.max(1, book.chapters[r.ci].text.length), q, r.nth)}>
              <small>{book.chapters[r.ci].title}</small>
              <br />
              {r.ex}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function EditPanel({ html, onClose, onApply }: { html: string; onClose: () => void; onApply: (h: string) => void }) {
  const [v, setV] = useState(html);
  return (
    <Modal title="Vista de edición del capítulo" onClose={onClose} wide>
      <p className="muted">Edita el HTML del capítulo. Los cambios se aplican a la sesión actual.</p>
      <textarea className="rp-code" value={v} onChange={(e) => setV(e.target.value)} spellCheck={false} />
      <div className="rp-row end">
        <button onClick={() => setV(html)}>Deshacer</button>
        <button className="primary" onClick={() => onApply(v)}>
          Aplicar
        </button>
      </div>
    </Modal>
  );
}

function escapeHtml(t: string) {
  return t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Limita el CSS del libro al contenedor de lectura y, si se fuerzan las
 * fuentes globales, elimina las declaraciones font-family del libro.
 */
export function scopeCss(css: string, stripFonts: boolean): string {
  let out = css.replace(/@import[^;]+;/g, "");
  if (stripFonts) out = out.replace(/font-family\s*:[^;}]+;?/gi, "").replace(/@font-face\s*{[^}]*}/gi, "");
  // Prefija selectores simples (no @-reglas) con .rp-content.
  return out.replace(/(^|})\s*([^@{}][^{}]*){/g, (_m, close: string, sel: string) => {
    const scoped = sel
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => (/^(html|body)\b/i.test(x) ? x.replace(/^(html|body)\b/i, ".rp-content") : `.rp-content ${x}`))
      .join(", ");
    return `${close}\n${scoped}{`;
  });
}
