import { continuousAlertDue, scheduledAlertDue } from "./alerts";

describe("alertas", () => {
  it("avisa una vez por intervalo de lectura continua", () => {
    expect(continuousAlertDue(0, 44 * 60_000, 45, 0).due).toBe(false);
    const a = continuousAlertDue(0, 46 * 60_000, 45, 0);
    expect(a).toEqual({ due: true, count: 1 });
    expect(continuousAlertDue(0, 50 * 60_000, 45, a.count).due).toBe(false);
    expect(continuousAlertDue(0, 10 * 60_000, 0, 0).due).toBe(false);
  });
  it("dispara alertas programadas una vez al día", () => {
    const fired = new Set<string>();
    const d = new Date(2026, 0, 1, 22, 0);
    expect(scheduledAlertDue(["22:00"], d, fired)).toBe("22:00");
    expect(scheduledAlertDue(["22:00"], d, fired)).toBeNull();
  });
});
