"use client";

import { useState, useTransition, type FormEvent } from "react";
import { InlineAlert } from "@/components/ui/design-system";
import { updateWarehouseLayout } from "@/lib/warehouses/layout-actions";
import { canUseLayoutPreset, DEFAULT_LAYOUT, FLOOR_LAYOUT, type WarehouseLayout } from "@/lib/warehouses/layout";

const initial = { error: null, success: null };
export function LayoutEditor({ code, layout, locationCount }: { code: string; layout: WarehouseLayout; locationCount: number }) {
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState(() => layout.map((item) => item.label));
  const [state, setState] = useState<{ error: string | null; success: string | null }>(initial);
  const [pending, startTransition] = useTransition();
  const locked = locationCount > 0;
  function preset(next: WarehouseLayout) { setLabels(next.map((item) => item.label)); setState(initial); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData();
    form.set("code", code);
    form.set("layout", JSON.stringify(labels.map((label) => ({ label }))));
    setState(initial);
    startTransition(async () => {
      try { setState(await updateWarehouseLayout(initial, form)); }
      catch { setState({ error: "No se pudo confirmar el cambio. Actualizá la página antes de reintentar.", success: null }); }
    });
  }
  return <div className="space-y-3">
    <p className="text-sm">Distribución: {layout.map((item) => item.label).join(" → ")}</p>
    <button type="button" className="button-secondary" disabled={pending} onClick={() => { setOpen(!open); setLabels(layout.map((item) => item.label)); setState(initial); }}>{open ? "Cerrar distribución" : "Configurar distribución"}</button>
    {open && <form onSubmit={submit} className="space-y-3" aria-busy={pending}>
      {locked && <p className="text-sm">Este depósito tiene ubicaciones: podés cambiar los nombres, pero no la cantidad de niveles.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="button-secondary" disabled={pending || !canUseLayoutPreset(locationCount, layout.length, DEFAULT_LAYOUT.length)} onClick={() => preset(DEFAULT_LAYOUT)}>Estanterías</button>
        <button type="button" className="button-secondary" disabled={pending || !canUseLayoutPreset(locationCount, layout.length, FLOOR_LAYOUT.length)} onClick={() => preset(FLOOR_LAYOUT)}>Almacenamiento en piso</button>
      </div>
      <label className="form-label">Cantidad de niveles<select className="form-control mt-2" value={labels.length} disabled={pending || locked} onChange={(event) => {
        const count = Number(event.target.value);
        setLabels((previous) => Array.from({ length: count }, (_, index) => previous[index] ?? ""));
        setState(initial);
      }}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
      {labels.map((label, index) => <label key={index} className="form-label block">Nombre del nivel {index + 1}<input className="form-control mt-2" value={label} required disabled={pending} onChange={(event) => { const value = event.target.value; setLabels((previous) => previous.map((current, i) => i === index ? value : current)); setState(initial); }} /></label>)}
      <button className="button-primary" disabled={pending}>{pending ? "Guardando…" : "Guardar distribución"}</button>
      {state.error && <InlineAlert variant="danger">{state.error}</InlineAlert>}
      {state.success && <InlineAlert variant="success">{state.success}</InlineAlert>}
    </form>}
  </div>;
}
