// Recordatorios de salud visual (Módulo 4). Puro.

/** ¿Hay que avisar por lectura continua? Solo una vez por cada intervalo cumplido. */
export function continuousAlertDue(
  sessionStartMs: number,
  nowMs: number,
  intervalMin: number,
  alreadyAlerted: number,
): { due: boolean; count: number } {
  if (intervalMin <= 0) return { due: false, count: alreadyAlerted };
  const elapsed = Math.floor((nowMs - sessionStartMs) / (intervalMin * 60_000));
  return elapsed > alreadyAlerted ? { due: true, count: elapsed } : { due: false, count: alreadyAlerted };
}

/** Devuelve la alerta programada ("HH:MM") que coincide con `now`, si no se ha disparado ya hoy. */
export function scheduledAlertDue(alerts: string[], now: Date, firedKeys: Set<string>): string | null {
  const p = (n: number) => String(n).padStart(2, "0");
  const hm = `${p(now.getHours())}:${p(now.getMinutes())}`;
  const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  for (const a of alerts) {
    const key = `${day} ${a}`;
    if (a === hm && !firedKeys.has(key)) {
      firedKeys.add(key);
      return a;
    }
  }
  return null;
}
