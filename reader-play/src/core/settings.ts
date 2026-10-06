// Ajustes de la aplicación (Módulos 1, 2, 3, 4, 5 y 7 del PRD).

export type ThemeId = "day" | "night" | "sepia" | "custom";
export type PageTransition = "slide" | "none";
export type ProgressDisplay = "percent" | "page";
export type ToolbarLayout = "single" | "double";
export type FontPolicy = "book" | "global";
export type Orientation = "auto" | "portrait" | "landscape";

export interface CustomTheme {
  background: string;
  foreground: string;
  accent: string;
}

export interface Settings {
  // 1. Pantalla y navegación
  showSystemBar: boolean;
  keepScreenOn: boolean;
  edgeBrightnessGesture: boolean;
  edgeFontSizeGesture: boolean;
  tiltToTurn: boolean;
  tiltSensitivity: number; // grados
  pageTransition: PageTransition;
  verticalScroll: boolean;
  pageTurnSound: boolean;
  dualPage: "auto" | "on" | "off";
  showTimeLeft: boolean;
  miniStatusBar: boolean;
  progressDisplay: ProgressDisplay;
  brightness: number; // 0.2..1
  orientation: Orientation;

  // 2. Tipografía
  fontSize: number; // px
  lineHeight: number;
  fontFamily: string;
  autoIndent: boolean;
  removeEmptyLines: boolean;
  collapseSpaces: boolean;
  trimPageTop: boolean;
  showPrintedPages: boolean;

  // 3. Motor
  fontPolicy: FontPolicy;
  disableBookCss: boolean;
  inlineFootnotes: boolean;

  // 4. Salud visual
  continuousReadingAlertMin: number; // 0 = desactivado
  scheduledAlerts: string[]; // "HH:MM"
  blueFilter: boolean;
  blueFilterOpacity: number; // 0..0.8
  blueFilterTemperature: number; // Kelvin 1000..6500
  readingRuler: boolean;
  highlightSentenceStart: boolean;
  bionicReading: boolean;
  bionicRatio: number; // 0.2..0.7

  // 5. SO y gestión
  disableEdgesOnCurved: boolean;
  confirmSaveExternal: boolean;
  theme: ThemeId;
  customTheme: CustomTheme;
  toolbarLayout: ToolbarLayout;
  dictionary: Record<string, string>;
  ttsRate: number;
  autoScrollSpeed: number; // px/s
  wpmFallback: number;
}

export const DEFAULT_SETTINGS: Settings = {
  showSystemBar: true,
  keepScreenOn: true,
  edgeBrightnessGesture: true,
  edgeFontSizeGesture: true,
  tiltToTurn: false,
  tiltSensitivity: 25,
  pageTransition: "slide",
  verticalScroll: false,
  pageTurnSound: false,
  dualPage: "auto",
  showTimeLeft: true,
  miniStatusBar: true,
  progressDisplay: "percent",
  brightness: 1,
  orientation: "auto",

  fontSize: 19,
  lineHeight: 1.6,
  fontFamily: "Georgia, 'Times New Roman', serif",
  autoIndent: true,
  removeEmptyLines: true,
  collapseSpaces: true,
  trimPageTop: true,
  showPrintedPages: true,

  fontPolicy: "book",
  disableBookCss: false,
  inlineFootnotes: true,

  continuousReadingAlertMin: 45,
  scheduledAlerts: [],
  blueFilter: false,
  blueFilterOpacity: 0.25,
  blueFilterTemperature: 3400,
  readingRuler: false,
  highlightSentenceStart: false,
  bionicReading: false,
  bionicRatio: 0.45,

  disableEdgesOnCurved: false,
  confirmSaveExternal: true,
  theme: "day",
  customTheme: { background: "#fdf6e3", foreground: "#283238", accent: "#2f7d6d" },
  toolbarLayout: "single",
  dictionary: {},
  ttsRate: 1,
  autoScrollSpeed: 30,
  wpmFallback: 230,
};

export const THEMES: Record<Exclude<ThemeId, "custom">, CustomTheme> = {
  day: { background: "#ffffff", foreground: "#1d232a", accent: "#2b6cb0" },
  night: { background: "#121417", foreground: "#c9cdd2", accent: "#7fb3e6" },
  sepia: { background: "#f4ecd8", foreground: "#5b4636", accent: "#9c6b3c" },
};

export function themeColors(s: Pick<Settings, "theme" | "customTheme">): CustomTheme {
  return s.theme === "custom" ? s.customTheme : THEMES[s.theme];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fusiona ajustes parciales/desconocidos con los valores por defecto, validando rangos. */
export function normalizeSettings(input: unknown): Settings {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const def = DEFAULT_SETTINGS[key];
    const v = src[key];
    if (v === undefined) continue;
    if (Array.isArray(def)) {
      if (Array.isArray(v)) out[key] = v.filter((x) => typeof x === "string" && /^\d{2}:\d{2}$/.test(x));
    } else if (typeof def === typeof v && def !== null) {
      out[key] = typeof def === "object" ? { ...(def as object), ...(v as object) } : v;
    }
  }
  const s = out as unknown as Settings;
  s.fontSize = clamp(s.fontSize, 10, 48);
  s.lineHeight = clamp(s.lineHeight, 1, 2.5);
  s.brightness = clamp(s.brightness, 0.2, 1);
  s.blueFilterOpacity = clamp(s.blueFilterOpacity, 0, 0.8);
  s.blueFilterTemperature = clamp(s.blueFilterTemperature, 1000, 6500);
  s.bionicRatio = clamp(s.bionicRatio, 0.2, 0.7);
  s.tiltSensitivity = clamp(s.tiltSensitivity, 10, 60);
  return s;
}

/**
 * Color RGB aproximado de un cuerpo negro a la temperatura dada (Tanner Helland),
 * usado para teñir el filtro de luz azul.
 */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  return [r, g, b].map((x) => Math.round(clamp(x, 0, 255))) as [number, number, number];
}
