// Integraciones con el dispositivo/SO (Módulos 1 y 5) con degradación segura.

import { useEffect, useRef } from "react";
import type { Orientation } from "../core/settings";

/** Mantener pantalla encendida mediante Screen Wake Lock API. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        /* denegado o no soportado */
      }
      if (cancelled) lock?.release();
    };
    const onVis = () => document.visibilityState === "visible" && acquire();
    acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, [enabled]);
}

/** Ocultar barra de notificaciones = pantalla completa (requiere gesto del usuario). */
export async function applySystemBar(show: boolean) {
  try {
    if (!show && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    if (show && document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* sin permiso o no soportado */
  }
}

export async function applyOrientation(o: Orientation) {
  const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  try {
    if (o === "auto") so.unlock?.();
    else await so.lock?.(o);
  } catch {
    /* el bloqueo solo funciona en pantalla completa / PWA instalada */
  }
}

let audio: AudioContext | null = null;
/** Sonido sintético de paso de página (ruido filtrado breve). */
export function playPageSound() {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    const len = Math.floor(ctx.sampleRate * 0.18);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.value = 0.25;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start();
  } catch {
    /* audio no disponible */
  }
}

/** Paso de página por inclinación: dispara al superar el umbral y se rearma al volver al centro. */
export function useTilt(enabled: boolean, threshold: number, onTilt: (dir: 1 | -1) => void) {
  const cb = useRef(onTilt);
  cb.current = onTilt;
  useEffect(() => {
    if (!enabled) return;
    let armed = true;
    let base: number | null = null;
    const h = (e: DeviceOrientationEvent) => {
      if (e.gamma == null) return;
      base ??= e.gamma;
      const d = e.gamma - base;
      if (armed && Math.abs(d) > threshold) {
        armed = false;
        cb.current(d > 0 ? 1 : -1);
      } else if (Math.abs(d) < threshold / 3) armed = true;
    };
    window.addEventListener("deviceorientation", h);
    return () => window.removeEventListener("deviceorientation", h);
  }, [enabled, threshold]);
}

/** iOS exige pedir permiso explícito para los sensores de orientación. */
export async function requestTiltPermission(): Promise<boolean> {
  const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof D.requestPermission !== "function") return true;
  try {
    return (await D.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function notify(title: string, body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
  } catch {
    /* sin notificaciones */
  }
}
