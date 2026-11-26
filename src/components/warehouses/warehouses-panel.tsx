"use client";

import { useState, useTransition, type FormEvent } from "react";
import { InlineAlert, SectionHeader, TableShell } from "@/components/ui/design-system";
import { createWarehouse, deactivateWarehouse, reactivateWarehouse, renameWarehouse, type WarehouseActionState } from "@/lib/warehouses/actions";
import type { Warehouse } from "@/lib/warehouses/types";

const initial: WarehouseActionState = { error: null, success: null };
export function WarehousesPanel({ warehouses, counts, erpEnabled }: { warehouses: Warehouse[]; counts: Record<string, number>; erpEnabled: boolean }) {
  const [state, setState] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>, action: typeof createWarehouse) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState(initial);
    startTransition(async () => {
      try {
        const result = await action(initial, data);
        setState(result);
        if (result.success) { setEditing(null); setConfirming(null); if (form.isConnected) form.reset(); }
      } catch { setState({ error: "No se pudo confirmar el resultado. Actualizá la página antes de reintentar.", success: null }); }
    });
  }
  return <div className="space-y-6">
    {state.error && <InlineAlert variant="danger">{state.error}</InlineAlert>}
    {state.success && <InlineAlert variant="success">{state.success}</InlineAlert>}
    {!erpEnabled && <section className="surface space-y-4 p-6"><SectionHeader title="Crear depósito" />
      <form onSubmit={(e) => submit(e, createWarehouse)} className="grid gap-4 sm:grid-cols-3" aria-busy={pending}>
        <label className="form-label">Código<input name="code" className="form-control mt-2" required maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,39}" disabled={pending} /></label>
        <label className="form-label">Nombre<input name="name" className="form-control mt-2" required maxLength={140} disabled={pending} /></label>
        <button className="button-primary self-end" disabled={pending}>Crear depósito</button>
      </form></section>}
    {erpEnabled && <InlineAlert>Los depósitos del ERP se incorporan mediante la sincronización.</InlineAlert>}
    <TableShell label="Depósitos"><table className="data-table"><thead><tr><th>Código</th><th>Nombre</th><th>Origen</th><th>Estado</th><th>Ubicaciones</th><th>Acciones</th></tr></thead><tbody>
      {warehouses.map((w) => <tr key={w.code}><td className="font-mono">{w.code}</td><td>{editing === w.code ? <form onSubmit={(e) => submit(e, renameWarehouse)} className="flex flex-wrap gap-2"><input type="hidden" name="code" value={w.code} /><label className="sr-only" htmlFor={`name-${w.code}`}>Nombre de {w.code}</label><input id={`name-${w.code}`} className="form-control" name="name" defaultValue={w.name} required maxLength={140} disabled={pending} /><button className="button-primary" disabled={pending}>Guardar</button><button type="button" className="button-secondary" disabled={pending} onClick={() => setEditing(null)}>Cancelar</button></form> : w.name}</td><td>{w.sourceSystem === "erp" ? "ERP · solo lectura" : "TrazFlow"}</td><td>{w.active ? "Activo" : "Inactivo"}</td><td>{counts[w.code] ?? 0}</td><td>{w.sourceSystem === "trazflow" && <div className="flex flex-wrap gap-2"><button type="button" className="button-secondary" disabled={pending} onClick={() => { setEditing(w.code); setState(initial); }}>Editar nombre</button>{w.active ? confirming === w.code ? <form onSubmit={(e) => submit(e, deactivateWarehouse)}><input type="hidden" name="code" value={w.code} /><span>¿Desactivar {w.code}? </span><button className="button-secondary" disabled={pending}>Confirmar</button><button type="button" className="button-secondary" disabled={pending} onClick={() => setConfirming(null)}>Cancelar</button></form> : <button type="button" className="button-secondary" disabled={pending} onClick={() => { setConfirming(w.code); setState(initial); }}>Desactivar</button> : <form onSubmit={(e) => submit(e, reactivateWarehouse)}><input type="hidden" name="code" value={w.code} /><button className="button-secondary" disabled={pending}>Activar</button></form>}</div>}</td></tr>)}
    </tbody></table></TableShell>
    {warehouses.length === 0 && <p className="text-sm text-stone-500">Todavía no hay depósitos.</p>}
  </div>;
}
