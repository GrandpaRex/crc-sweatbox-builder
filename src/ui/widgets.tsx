import { useId, useMemo, type ReactNode } from "react";
import { useStore } from "../state/store";

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={"field" + (wide ? " wide" : "")}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

interface TextProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  upper?: boolean;
  mono?: boolean;
  list?: string;
}

export function Text({ value, onChange, placeholder, upper, mono, list }: TextProps) {
  return (
    <input
      type="text"
      className={mono || upper ? "mono" : undefined}
      value={value}
      list={list}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
    />
  );
}

export function Num({
  value,
  onChange,
  min,
  step,
  placeholder,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  min?: number;
  step?: number;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      className="mono"
      value={value ?? ""}
      min={min}
      step={step}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === "" ? null : +e.target.value)}
    />
  );
}

export function Area({ value, onChange, rows = 4, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <textarea className="mono" rows={rows} value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly (T | { value: T; label: string })[];
}) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const known = opts.some((o) => o.value === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {!known && <option value={value}>{value || "—"}</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Fix / navaid input with suggestions from whichever nav data is loaded. */
export function FixInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const nav = useStore((s) => s.nav);
  const id = useId();
  const options = useMemo(() => nav.suggest(value), [nav, value]);
  const unknown = nav.loaded && value.length >= 2 && !nav.fix(value);
  return (
    <>
      <input
        type="text"
        className={"mono" + (unknown ? " unknown" : "")}
        value={value}
        list={id}
        placeholder={placeholder}
        spellCheck={false}
        title={unknown ? "Not found in the loaded nav data" : undefined}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

/** Controller position picker, grouped by facility. */
export function PositionSelect({ value, onChange, allowNone = true }: { value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  const artcc = useStore((s) => s.artcc);
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: { id: string; text: string }[] }>();
    for (const p of artcc?.positions ?? []) {
      const g = m.get(p.facilityId) ?? { label: `${p.facilityId} — ${p.facilityName}`, items: [] };
      g.items.push({ id: p.id, text: `${p.callsign || p.facilityId} · ${p.name} · ${(p.frequency / 1e6).toFixed(3)}` });
      m.set(p.facilityId, g);
    }
    return [...m.values()];
  }, [artcc]);
  const known = !value || artcc?.positions.some((p) => p.id === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">— none —</option>}
      {!known && <option value={value}>{value} (not in loaded ARTCC)</option>}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.text}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function Card({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h2>{title}</h2>
        {actions && <div className="row">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFiles(accept: string, onFiles: (files: File[]) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = accept;
  input.onchange = () => onFiles([...(input.files ?? [])]);
  input.click();
}
