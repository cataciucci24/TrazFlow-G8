"use client";

import { useState, useTransition, type FormEvent } from "react";
import { InlineAlert, SectionHeader } from "@/components/ui/design-system";
import { generateLocations, type GenerateLocationsState } from "@/lib/locations/actions";
import { expandLocationRange, generatedLocationCode, locationCombinations } from "@/lib/locations/generation";
import { activeWarehouses, warehouseLabel, type Warehouse } from "@/lib/warehouses/types";
import type { WarehouseLayout } from "@/lib/warehouses/layout";
import { SearchableSelect } from "./searchable-select";

const initial: GenerateLocationsState = { error: null, success: null };
export function LocationGenerator({ warehouses, layouts }: { warehouses: Warehouse[]; layouts: Record<string, WarehouseLayout> }) {
  const active = activeWarehouses(warehouses);
  const [code, setCode] = useState(active.length === 1 ? active[0].code : "");
  const [starts, setStarts] = useState(["", "", "", ""]);
  const [ends, setEnds] = useState(["", "", "", ""]);
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<GenerateLocationsState>(initial);
  const [pending, startTransition] = useTransition();
  const layout = layouts[code];
  const ranges = layout?.map((_, index) => expandLocationRange(starts[index], ends[index])) ?? [];
  const combinations = layout && ranges.every((range) => range !== null) ? locationCombinations(ranges as string[][]) : null;
  const sample = combinations?.slice(0, 5).map((values) => generatedLocationCode(code, values)) ?? [];
  function change(setter: typeof setStarts, index: number, value: string) {
    setter((previous) => previous.map((current, i) => i === index ? value : current));
    setConfirming(false); setState(initial);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirming || !layout || !combinations || pending) return;
    const data = new FormData();
    data.set("warehouseCode", code); data.set("layout", JSON.stringify(layout));
    layout.forEach((_, index) => { data.set(`start${index}`, starts[index]); data.set(`end${index}`, ends[index]); });
    startTransition(async () => {
      try { setState(await generateLocations(initial, data)); }
      catch { setState({ error: "No se pudo confirmar el resultado. Actualizá el catálogo antes de reintentar.", success: null }); }
      setConfirming(false);
    });
  }
  return <section id="generar-ubicaciones" className="surface scroll-mt-40 space-y-4 p-6 lg:scroll-mt-24">
    <SectionHeader title="Generar ubicaciones" description="Combiná rangos de letras o números. Máximo 2.000 ubicaciones por operación." />
    <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
      <SearchableSelect label="Depósito" placeholder="Seleccioná el depósito" value={code} disabled={pending} options={active.map((warehouse) => ({ value: warehouse.code, label: warehouseLabel(warehouse) }))} onChange={(value) => { setCode(value); setStarts(["", "", "", ""]); setEnds(["", "", "", ""]); setConfirming(false); setState(initial); }} />
      {layout?.map((level, index) => <fieldset key={`${code}-${index}`} className="grid gap-3 sm:grid-cols-2"><legend className="form-label">{level.label}</legend><label className="form-label">Desde<input className="form-control mt-2" value={starts[index]} maxLength={40} disabled={pending} onChange={(event) => change(setStarts, index, event.target.value)} /></label><label className="form-label">Hasta<input className="form-control mt-2" value={ends[index]} maxLength={40} disabled={pending} onChange={(event) => change(setEnds, index, event.target.value)} /></label></fieldset>)}
      {layout && !combinations && <p className="text-sm">Ingresá rangos ascendentes de una letra (A–C) o números (01–10), hasta 2.000 combinaciones.</p>}
      {combinations && <div className="space-y-2"><p>Vista previa: <strong>{combinations.length}</strong> ubicaciones.</p><p className="text-sm">Ejemplos: {sample.join(", ")}</p></div>}
      {!confirming ? <button type="button" className="button-secondary" disabled={!combinations || pending} onClick={() => setConfirming(true)}>Continuar</button> : <div className="space-y-2"><p>¿Confirmás la generación de {combinations?.length} ubicaciones?</p><div className="flex gap-3"><button className="button-primary" disabled={pending}>{pending ? "Generando…" : "Confirmar generación"}</button><button type="button" className="button-secondary" disabled={pending} onClick={() => setConfirming(false)}>Cancelar</button></div></div>}
      {state.error && <InlineAlert variant="danger">{state.error}</InlineAlert>}
      {state.success && <InlineAlert variant="success">Creadas: {state.created}. Omitidas por coordenadas existentes: {state.skipped}. Rechazadas por conflicto de código: {state.rejected}.</InlineAlert>}
    </form>
  </section>;
}
