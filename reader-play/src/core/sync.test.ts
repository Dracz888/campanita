import { DEFAULT_SETTINGS, kelvinToRgb, normalizeSettings } from "./settings";
import { createBackup, mergeSyncDocuments, restoreBackup, type BookSyncState } from "./sync";

const base = (over: Partial<BookSyncState>): BookSyncState => ({
  id: "b",
  title: "Libro",
  position: { chapterIndex: 0, progress: 0 },
  positionUpdatedAt: "2026-01-01T00:00:00Z",
  bookmarks: [],
  notes: [],
  sessions: [],
  ...over,
});
const bm = (id: string, updatedAt: string, excerpt = id) => ({
  id,
  excerpt,
  position: { chapterIndex: 0, progress: 0 },
  createdAt: updatedAt,
  updatedAt,
});

describe("sincronización bidireccional", () => {
  it("toma la posición más reciente y une marcadores respetando borrados", () => {
    const local = base({ position: { chapterIndex: 3, progress: 0.1 }, positionUpdatedAt: "2026-01-03T00:00:00Z", bookmarks: [bm("a", "1"), bm("c", "2", "local")], deleted: ["d"] });
    const remote = base({ position: { chapterIndex: 1, progress: 0.9 }, positionUpdatedAt: "2026-01-02T00:00:00Z", bookmarks: [bm("b", "1"), bm("c", "3", "remote"), bm("d", "1")] });
    const m = mergeSyncDocuments({ version: 1, updatedAt: "", books: { b: local } }, { version: 1, updatedAt: "", books: { b: remote, z: base({ id: "z" }) } }, "now");
    expect(m.books.b.position.chapterIndex).toBe(3);
    expect(m.books.b.bookmarks.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(m.books.b.bookmarks.find((x) => x.id === "c")?.excerpt).toBe("remote");
    expect(m.books.z).toBeDefined();
  });
});

describe("copias de seguridad", () => {
  it("ida y vuelta conservando ajustes", () => {
    const raw = createBackup({ ...DEFAULT_SETTINGS, fontSize: 30, theme: "sepia" }, undefined, "t");
    const r = restoreBackup(raw);
    expect(r.settings.fontSize).toBe(30);
    expect(r.settings.theme).toBe("sepia");
  });
  it("rechaza archivos ajenos", () => {
    expect(() => restoreBackup("{}")).toThrow();
    expect(() => restoreBackup("nope")).toThrow();
  });
  it("normaliza rangos y tipos", () => {
    const s = normalizeSettings({ fontSize: 500, theme: 3, scheduledAlerts: ["08:00", "bad"] });
    expect(s.fontSize).toBe(48);
    expect(s.theme).toBe("day");
    expect(s.scheduledAlerts).toEqual(["08:00"]);
  });
  it("convierte temperatura de color", () => {
    expect(kelvinToRgb(6500)[2]).toBeGreaterThan(240);
    expect(kelvinToRgb(2000)[2]).toBeLessThan(80);
  });
});
