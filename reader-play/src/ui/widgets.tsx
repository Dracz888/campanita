import type { ReactNode } from "react";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="rp-modal-back" onClick={onClose}>
      <div className={`rp-modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="Cerrar" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="rp-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog(p: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={p.title} onClose={p.onCancel}>
      <p>{p.message}</p>
      <div className="rp-row end">
        <button onClick={p.onCancel}>{p.cancelLabel}</button>
        <button className="primary" onClick={p.onConfirm}>
          {p.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="rp-toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Range(p: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="rp-range">
      <span>
        {p.label} <b>{p.format ? p.format(p.value) : p.value}</b>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step ?? 1} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  );
}

export function Select<T extends string>(p: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="rp-select">
      <span>{p.label}</span>
      <select value={p.value} onChange={(e) => p.onChange(e.target.value as T)}>
        {p.options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
