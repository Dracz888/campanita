import { averageWpm, bookCounts, dailyHistory, percentOf, positionAtPercent, timeRemaining } from "./stats";
import type { ReadingSession } from "./types";

const book = {
  chapters: [
    { id: "1", title: "", html: "", text: "uno dos tres cuatro" },
    { id: "2", title: "", html: "", text: "cinco seis seis ocho nueve diez once doce" },
  ],
};

describe("estadísticas", () => {
  const c = bookCounts(book);
  it("cuenta palabras por capítulo", () => {
    expect(c.words).toBe(12);
    expect(c.cumulative).toEqual([0, 4]);
  });
  it("convierte posición <-> porcentaje", () => {
    expect(percentOf(c, { chapterIndex: 1, progress: 0.5 })).toBeCloseTo(66.67, 1);
    const p = positionAtPercent(c, 50);
    expect(p.chapterIndex).toBe(1);
    expect(p.progress).toBeCloseTo(0.25);
  });
  it("estima el tiempo restante", () => {
    const t = timeRemaining(c, { chapterIndex: 0, progress: 0 }, 2);
    expect(t.chapterMin).toBe(2);
    expect(t.bookMin).toBe(6);
  });
  const s = (start: string, min: number, words: number, a: number, b: number): ReadingSession => ({
    bookId: "x",
    start,
    durationMs: min * 60_000,
    wordsRead: words,
    startPercent: a,
    endPercent: b,
  });
  it("calcula PPM ignorando sesiones muy cortas", () => {
    expect(averageWpm([s("2026-01-01T10:00:00", 10, 2000, 0, 5), { ...s("2026-01-01T11:00:00", 0, 999, 5, 6), durationMs: 1000 }])).toBe(200);
    expect(averageWpm([], 230)).toBe(230);
  });
  it("agrupa el historial por día", () => {
    const h = dailyHistory([s("2026-01-01T10:00:00", 10, 2000, 0, 5), s("2026-01-01T20:00:00", 10, 1000, 5, 7), s("2026-01-02T09:00:00", 5, 1000, 7, 9)]);
    expect(h.map((d) => d.date)).toEqual(["2026-01-02", "2026-01-01"]);
    expect(h[1].wpm).toBe(150);
    expect(h[1].percentAdvanced).toBe(7);
  });
});
