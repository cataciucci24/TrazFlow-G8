"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type SearchOption = { value: string; label: string; search?: string };
export function normalizeSearch(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(); }
export function filterOptions(options: SearchOption[], query: string) {
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  return options.filter((option) => { const text = normalizeSearch(`${option.label} ${option.search ?? ""}`); return terms.every((term) => text.includes(term)); });
}

export function SearchableSelect({ label, placeholder, options, value, onChange, disabled = false, name, required = false }: {
  label: string; placeholder: string; options: SearchOption[]; value: string; onChange: (value: string) => void; disabled?: boolean; name?: string; required?: boolean;
}) {
  const id = useId(); const root = useRef<HTMLDivElement>(null); const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [active, setActive] = useState(0);
  const indexed = useMemo(() => options.map((option) => ({ option, text: normalizeSearch(`${option.label} ${option.search ?? ""}`) })), [options]);
  const matches = useMemo(() => { const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean); return indexed.filter(({ text }) => terms.every((term) => text.includes(term))).map(({ option }) => option); }, [indexed, query]);
  const selected = options.find((option) => option.value === value);
  useEffect(() => { if (!open) return; function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); } document.addEventListener("pointerdown", outside); input.current?.focus(); return () => document.removeEventListener("pointerdown", outside); }, [open]);
  function choose(option: SearchOption) { onChange(option.value); setOpen(false); setQuery(""); setActive(0); }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(matches.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))); }
    else if (event.key === "Enter") { event.preventDefault(); if (matches[active]) choose(matches[active]); }
  }
  useEffect(() => { if (open) root.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);
  return <div ref={root} className="relative min-w-0">
    <span id={`${id}-label`} className="form-label">{label}</span>
    {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
    <button type="button" disabled={disabled} aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} className="form-control mt-2 flex w-full items-center justify-between gap-2 text-left" onClick={() => { setOpen(!open); setQuery(""); setActive(0); }}><span id={`${id}-value`} className="min-w-0 truncate">{selected?.label ?? placeholder}</span><span aria-hidden="true">▾</span></button>
    {open && <div className="absolute z-30 mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
      <input ref={input} aria-label={`Buscar ${label.toLocaleLowerCase()}`} role="combobox" aria-expanded="true" aria-required={required} aria-controls={`${id}-list`} aria-activedescendant={matches[active] ? `${id}-option-${active}` : undefined} autoComplete="off" className="form-control w-full" placeholder="Buscar…" value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={keys} />
      <ul id={`${id}-list`} role="listbox" aria-label={label} className="mt-2 max-h-60 overflow-y-auto">{matches.map((option, index) => <li key={option.value} id={`${id}-option-${index}`} data-option-index={index} role="option" aria-selected={value === option.value} onMouseMove={() => setActive(index)} onClick={() => choose(option)} className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${active === index ? "bg-stone-100" : ""}`}>{option.label}</li>)}</ul>
      {matches.length === 0 && <p className="px-3 py-2 text-sm text-stone-500">No hay resultados.</p>}
    </div>}
  </div>;
}
