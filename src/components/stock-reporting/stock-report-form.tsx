"use client";

import { useActionState } from "react";

import { saveDistributorStock, type SaveDistributorStockState } from "@/lib/stock-reporting/actions";
import type { StockReportingDistributor, StockReportingProduct } from "@/lib/stock-reporting/queries";

const INITIAL_STATE: SaveDistributorStockState = { error: null, success: null };
const CONTROL_CLASS = "w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function StockReportForm({
  distributors,
  products,
}: {
  distributors: StockReportingDistributor[];
  products: StockReportingProduct[];
}) {
  const [state, formAction, isPending] = useActionState(saveDistributorStock, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-5 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
      <div>
        <h2 className="text-lg font-bold">Actualizar disponibilidad</h2>
        <p className="mt-1 text-sm text-stone-500">Informá una estimación diaria para anticipar posibles quiebres de stock.</p>
      </div>

      {state.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>}
      {state.success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{state.success}</p>}

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Distribuidora">
          <select name="distributorId" required disabled={isPending} defaultValue={distributors.length === 1 ? distributors[0].id : ""} className={CONTROL_CLASS}>
            <option value="">Seleccionar distribuidora</option>
            {distributors.map((distributor) => <option key={distributor.id} value={distributor.id}>{distributor.name}</option>)}
          </select>
        </Field>
        <Field label="Producto">
          <select name="productId" required disabled={isPending} defaultValue="" className={CONTROL_CLASS}>
            <option value="">Seleccionar producto</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}
          </select>
        </Field>
        <Field label="Stock actual" hint="Unidades disponibles hoy.">
          <input name="currentStock" type="number" min="0" step="1" required disabled={isPending} placeholder="Ej. 80" className={CONTROL_CLASS} />
        </Field>
        <Field label="Consumo diario estimado" hint="Promedio de unidades consumidas por día.">
          <input name="dailyConsumption" type="number" min="0.01" step="0.01" required disabled={isPending} placeholder="Ej. 10" className={CONTROL_CLASS} />
        </Field>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={isPending || distributors.length === 0 || products.length === 0} className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
          {isPending ? "Guardando..." : "Guardar información"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="space-y-1.5"><span className="block text-sm font-semibold text-stone-700">{label}</span>{children}{hint && <span className="block text-xs text-stone-500">{hint}</span>}</label>;
}
