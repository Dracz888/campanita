import { useRef, useState } from "react";
import { DEFAULT_SETTINGS, type Settings, type ThemeId } from "../core/settings";
import { createBackup, mergeBookState, restoreBackup, toSyncState, type SyncDocument } from "../core/sync";
import type { BookRecord } from "../core/types";
import { loadDeleted, loadSyncConfig, putBook, saveSyncConfig } from "../store/db";
import { useSettings } from "../store/settingsContext";
import { createProvider, syncNow, type ProviderConfig, type ProviderId } from "../sync/providers";
import { applySystemBar, requestTiltPermission } from "./device";
import { Modal, Range, Select, Toggle } from "./widgets";

type Tab = "screen" | "text" | "engine" | "health" | "app" | "sync";

const TABS: [Tab, string][] = [
  ["screen", "Pantalla"],
  ["text", "Tipografía"],
  ["engine", "Motor"],
  ["health", "Salud visual"],
  ["app", "App"],
  ["sync", "Nube"],
];

function localSyncDoc(books: BookRecord[]): SyncDocument {
  const deleted = loadDeleted();
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    books: Object.fromEntries(books.map((b) => [b.id, toSyncState(b, deleted[b.id] ?? [])])),
  };
}

async function applySyncDoc(doc: SyncDocument, books: BookRecord[]) {
  for (const b of books) {
    const remote = doc.books[b.id];
    if (!remote) continue;
    const m = mergeBookState(toSyncState(b, loadDeleted()[b.id] ?? []), remote);
    await putBook({ ...b, position: m.position, positionUpdatedAt: m.positionUpdatedAt, bookmarks: m.bookmarks, notes: m.notes, sessions: m.sessions });
  }
}

export function SettingsPanel({ books, onClose, onSynced }: { books: BookRecord[]; onClose: () => void; onSynced: () => void }) {
  const { settings: s, update, replace } = useSettings();
  const [tab, setTab] = useState<Tab>("screen");
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => update({ [k]: v } as Partial<Settings>);

  return (
    <Modal title="Ajustes" onClose={onClose} wide>
      <div className="rp-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "screen" && (
        <section>
          <h3>Modos de pantalla</h3>
          <Toggle
            label="Mostrar barra de notificaciones"
            hint="Desactivado = pantalla completa al leer"
            checked={s.showSystemBar}
            onChange={(v) => {
              update({ showSystemBar: v });
              applySystemBar(v);
            }}
          />
          <Toggle label="Mantener pantalla encendida" checked={s.keepScreenOn} onChange={set("keepScreenOn")} />
          <h3>Gestos</h3>
          <Toggle label="Borde izquierdo: brillo" hint="Desliza arriba/abajo" checked={s.edgeBrightnessGesture} onChange={set("edgeBrightnessGesture")} />
          <Toggle label="Borde derecho: tamaño de fuente" checked={s.edgeFontSizeGesture} onChange={set("edgeFontSizeGesture")} />
          <Toggle
            label="Pasar página inclinando el dispositivo"
            checked={s.tiltToTurn}
            onChange={async (v) => update({ tiltToTurn: v && (await requestTiltPermission()) })}
          />
          {s.tiltToTurn && <Range label="Sensibilidad (grados)" value={s.tiltSensitivity} min={10} max={60} onChange={set("tiltSensitivity")} />}
          <h3>Paso de página</h3>
          <Select label="Transición" value={s.pageTransition} options={[["slide", "Deslizamiento horizontal"], ["none", "Sin animación"]]} onChange={set("pageTransition")} />
          <Toggle label="Desplazamiento vertical continuo" checked={s.verticalScroll} onChange={set("verticalScroll")} />
          <Toggle label="Sonido al pasar página" checked={s.pageTurnSound} onChange={set("pageTurnSound")} />
          <Select label="Doble página (tablet)" value={s.dualPage} options={[["auto", "Automático en horizontal"], ["on", "Siempre"], ["off", "Nunca"]]} onChange={set("dualPage")} />
          <Select label="Orientación" value={s.orientation} options={[["auto", "Automática"], ["portrait", "Vertical"], ["landscape", "Horizontal"]]} onChange={set("orientation")} />
          <h3>Barra de estado</h3>
          <Toggle label="Mini barra de estado" checked={s.miniStatusBar} onChange={set("miniStatusBar")} />
          <Toggle label="Tiempo restante (capítulo y libro)" checked={s.showTimeLeft} onChange={set("showTimeLeft")} />
          <Select label="Mostrar progreso como" value={s.progressDisplay} options={[["percent", "Porcentaje"], ["page", "Número de página"]]} onChange={set("progressDisplay")} />
        </section>
      )}

      {tab === "text" && (
        <section>
          <Range label="Tamaño de fuente" value={s.fontSize} min={10} max={48} format={(v) => `${v} px`} onChange={set("fontSize")} />
          <Range label="Interlineado" value={s.lineHeight} min={1} max={2.5} step={0.05} onChange={set("lineHeight")} />
          <Select
            label="Fuente global"
            value={s.fontFamily}
            options={[
              ["Georgia, 'Times New Roman', serif", "Serif (Georgia)"],
              ["'Palatino Linotype', Palatino, serif", "Palatino"],
              ["system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", "Sans (sistema)"],
              ["Verdana, sans-serif", "Verdana"],
              ["'OpenDyslexic', 'Comic Sans MS', sans-serif", "Dislexia"],
              ["ui-monospace, Menlo, monospace", "Monoespaciada"],
            ]}
            onChange={set("fontFamily")}
          />
          <h3>Párrafos</h3>
          <Toggle label="Sangría en la primera línea" checked={s.autoIndent} onChange={set("autoIndent")} />
          <Toggle label="Eliminar líneas vacías" checked={s.removeEmptyLines} onChange={set("removeEmptyLines")} />
          <Toggle label="Eliminar espacios dobles" checked={s.collapseSpaces} onChange={set("collapseSpaces")} />
          <Toggle label="Recortar espacio superior en cada página" checked={s.trimPageTop} onChange={set("trimPageTop")} />
          <h3>Edición impresa</h3>
          <Toggle label="Mostrar números de página impresos" hint="EPUB con page-list o pagebreak" checked={s.showPrintedPages} onChange={set("showPrintedPages")} />
        </section>
      )}

      {tab === "engine" && (
        <section>
          <Select label="Fuentes" value={s.fontPolicy} options={[["book", "Respetar las del libro"], ["global", "Forzar fuente global"]]} onChange={set("fontPolicy")} />
          <Toggle label="Deshabilitar estilos CSS del libro" checked={s.disableBookCss} onChange={set("disableBookCss")} />
          <Toggle label="Notas al pie en línea" hint="Si no, se abren al pulsar la llamada" checked={s.inlineFootnotes} onChange={set("inlineFootnotes")} />
        </section>
      )}

      {tab === "health" && <HealthTab />}
      {tab === "app" && <AppTab books={books} onRestored={onSynced} />}
      {tab === "sync" && <SyncTab books={books} onSynced={onSynced} />}

      <p className="muted small">
        <button className="link" onClick={() => confirm("¿Restablecer todos los ajustes?") && replace(DEFAULT_SETTINGS)}>
          Restablecer ajustes por defecto
        </button>
      </p>
    </Modal>
  );
}

function HealthTab() {
  const { settings: s, update } = useSettings();
  const [time, setTime] = useState("22:00");
  return (
    <section>
      <h3>Control de tiempo</h3>
      <Range
        label="Aviso por lectura continua"
        value={s.continuousReadingAlertMin}
        min={0}
        max={180}
        step={5}
        format={(v) => (v ? `cada ${v} min` : "desactivado")}
        onChange={(v) => {
          update({ continuousReadingAlertMin: v });
          if (v && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
        }}
      />
      <div className="rp-row">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Hora de alerta" />
        <button onClick={() => !s.scheduledAlerts.includes(time) && update({ scheduledAlerts: [...s.scheduledAlerts, time].sort() })}>Añadir alerta</button>
      </div>
      <ul className="rp-chips">
        {s.scheduledAlerts.map((a) => (
          <li key={a}>
            {a}{" "}
            <button className="link" aria-label={`Quitar ${a}`} onClick={() => update({ scheduledAlerts: s.scheduledAlerts.filter((x) => x !== a) })}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <h3>Filtro de luz azul</h3>
      <Toggle label="Activar filtro" checked={s.blueFilter} onChange={(v) => update({ blueFilter: v })} />
      <Range label="Opacidad" value={s.blueFilterOpacity} min={0} max={0.8} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => update({ blueFilterOpacity: v })} />
      <Range label="Temperatura" value={s.blueFilterTemperature} min={1000} max={6500} step={100} format={(v) => `${v} K`} onChange={(v) => update({ blueFilterTemperature: v })} />
      <h3>Lectura enfocada</h3>
      <Toggle label="Regla de lectura" hint="Arrástrala para seguir la línea" checked={s.readingRuler} onChange={(v) => update({ readingRuler: v })} />
      <Toggle label="Resaltar primera palabra de cada oración" checked={s.highlightSentenceStart} onChange={(v) => update({ highlightSentenceStart: v })} />
      <Toggle label="Bionic Reading" hint="Resalta las letras iniciales de cada palabra" checked={s.bionicReading} onChange={(v) => update({ bionicReading: v })} />
      {s.bionicReading && <Range label="Intensidad" value={s.bionicRatio} min={0.2} max={0.7} step={0.05} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => update({ bionicRatio: v })} />}
    </section>
  );
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function AppTab({ books, onRestored }: { books: BookRecord[]; onRestored: () => void }) {
  const { settings: s, update, replace } = useSettings();
  const file = useRef<HTMLInputElement>(null);
  const [word, setWord] = useState("");
  const [def, setDef] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section>
      <h3>Integración con el sistema</h3>
      <Toggle label="Deshabilitar bordes táctiles" hint="Para pantallas curvas o sin marco" checked={s.disableEdgesOnCurved} onChange={(v) => update({ disableEdgesOnCurved: v })} />
      <Toggle label="Confirmar «Guardar archivo» al abrir desde otras apps" checked={s.confirmSaveExternal} onChange={(v) => update({ confirmSaveExternal: v })} />
      <h3>Tema</h3>
      <Select<ThemeId> label="Tema" value={s.theme} options={[["day", "Diurno"], ["night", "Nocturno"], ["sepia", "Sepia"], ["custom", "Personalizado"]]} onChange={(v) => update({ theme: v })} />
      {s.theme === "custom" && (
        <div className="rp-row">
          {(["background", "foreground", "accent"] as const).map((k) => (
            <label key={k} className="rp-color">
              {{ background: "Fondo", foreground: "Texto", accent: "Acento" }[k]}
              <input type="color" value={s.customTheme[k]} onChange={(e) => update({ customTheme: { ...s.customTheme, [k]: e.target.value } })} />
            </label>
          ))}
        </div>
      )}
      <Select label="Barra de herramientas" value={s.toolbarLayout} options={[["single", "Línea simple (desplazable)"], ["double", "Línea doble"]]} onChange={(v) => update({ toolbarLayout: v })} />
      <Range label="Velocidad de voz" value={s.ttsRate} min={0.5} max={2} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => update({ ttsRate: v })} />
      <Range label="Velocidad auto-scroll" value={s.autoScrollSpeed} min={5} max={200} format={(v) => `${v} px/s`} onChange={(v) => update({ autoScrollSpeed: v })} />

      <h3>Diccionario personal</h3>
      <div className="rp-row">
        <input className="rp-input" placeholder="Palabra" value={word} onChange={(e) => setWord(e.target.value)} />
        <input className="rp-input" placeholder="Definición" value={def} onChange={(e) => setDef(e.target.value)} />
        <button
          onClick={() => {
            if (!word.trim()) return;
            update({ dictionary: { ...s.dictionary, [word.trim().toLowerCase()]: def } });
            setWord("");
            setDef("");
          }}
        >
          Añadir
        </button>
      </div>
      <ul className="rp-list compact">
        {Object.entries(s.dictionary).map(([w, d]) => (
          <li key={w} className="rp-row">
            <span className="grow">
              <b>{w}</b>: {d}
            </span>
            <button
              className="icon"
              aria-label={`Quitar ${w}`}
              onClick={() => {
                const { [w]: _drop, ...rest } = s.dictionary;
                void _drop;
                update({ dictionary: rest });
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <h3>Copia de seguridad</h3>
      <div className="rp-row">
        <button onClick={() => download(`reader-play-backup-${new Date().toISOString().slice(0, 10)}.json`, createBackup(s, localSyncDoc(books), new Date().toISOString()))}>
          Exportar copia
        </button>
        <button onClick={() => file.current?.click()}>Restaurar copia</button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const r = restoreBackup(await f.text());
              replace(r.settings);
              if (r.sync) await applySyncDoc(r.sync, books);
              setMsg("Copia restaurada correctamente.");
              onRestored();
            } catch (err) {
              setMsg(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </div>
      {msg && <p className="muted">{msg}</p>}
    </section>
  );
}

function SyncTab({ books, onSynced }: { books: BookRecord[]; onSynced: () => void }) {
  const [cfg, setCfg] = useState<ProviderConfig>(() => loadSyncConfig() ?? { provider: "webdav" });
  const [status, setStatus] = useState<string | null>(null);
  const field = (k: keyof ProviderConfig, label: string, type = "text") => (
    <label className="rp-select">
      <span>{label}</span>
      <input className="rp-input" type={type} value={(cfg[k] as string) ?? ""} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
    </label>
  );
  const run = async (mode: "both" | "up" | "down") => {
    saveSyncConfig(cfg);
    setStatus("Sincronizando…");
    try {
      const provider = createProvider(cfg);
      const local = localSyncDoc(books);
      if (mode === "up") await provider.upload(JSON.stringify(local));
      else if (mode === "down") {
        const raw = await provider.download();
        if (!raw) throw new Error("No hay datos en la nube todavía.");
        await applySyncDoc(JSON.parse(raw), books);
      } else await applySyncDoc(await syncNow(provider, local), books);
      setStatus(`✓ Sincronizado (${new Date().toLocaleTimeString("es")})`);
      onSynced();
    } catch (e) {
      setStatus(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <section>
      <p className="muted">Sincroniza progreso, marcadores, notas e historial de lectura entre dispositivos.</p>
      <Select<ProviderId>
        label="Servicio"
        value={cfg.provider}
        options={[["dropbox", "Dropbox"], ["webdav", "WebDAV"], ["ftp", "FTP (vía pasarela HTTP)"], ["gdrive", "Google Drive"]]}
        onChange={(provider) => setCfg({ ...cfg, provider })}
      />
      {(cfg.provider === "dropbox" || cfg.provider === "gdrive") && field("token", "Token de acceso OAuth", "password")}
      {(cfg.provider === "webdav" || cfg.provider === "ftp") && (
        <>
          {field("url", cfg.provider === "ftp" ? "URL de la pasarela" : "URL de la carpeta WebDAV")}
          {cfg.provider === "ftp" && field("ftpHost", "Servidor FTP (host:puerto/ruta)")}
          {field("username", "Usuario")}
          {field("password", "Contraseña", "password")}
        </>
      )}
      <div className="rp-row">
        <button className="primary" onClick={() => run("both")}>
          ⇅ Sincronizar
        </button>
        <button onClick={() => run("up")}>⇡ Subir</button>
        <button onClick={() => run("down")}>⇣ Descargar</button>
      </div>
      {status && <p className="muted">{status}</p>}
    </section>
  );
}
