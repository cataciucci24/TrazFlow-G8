"use client";

import { useActionState } from "react";

import { PALLET_UNITS } from "@/lib/pallets/units";
import { saveDistributorStock, type SaveDistributorStockState } from "@/lib/stock-reporting/actions";
import type { StockReportingProduct } from "@/lib/stock-reporting/queries";

const INITIAL_STATE: SaveDistributorStockState = { error: null, success: null };
const CONTROL_CLASS = "form-control";

export function StockReportForm({
  products,
}: {
  products: StockReportingProduct[];
}) {
  const [state, formAction, isPending] = useActionState(saveDistributorStock, INITIAL_STATE);

  return (
    <section className="section-stack" aria-labelledby="update-stock-title">
      <div><h2 id="update-stock-title" className="section-title">Actualizar disponibilidad</h2><p className="section-description">Informá una estimación diaria para anticipar posibles quiebres de stock.</p></div>
      <form action={formAction} className="surface space-y-5 p-5 sm:p-6">
      <div>
        <p className="mt-3 inline-flex rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">Los datos se asociarán automáticamente a tu distribuidora.</p>
      </div>

      {state.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>}
      {state.success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{state.success}</p>}

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Producto">
          <select name="productId" required disabled={isPending} defaultValue="" className={CONTROL_CLASS}>
            <option value="">Seleccionar producto</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}
          </select>
        </Field>
        <Field label="Unidad de medida" hint="Se usa para el stock y el consumo diario.">
          <select name="unitOfMeasure" required disabled={isPending} defaultValue="" className={CONTROL_CLASS}>
            <option value="" disabled>Seleccionar unidad</option>
            {PALLET_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </Field>
        <Field label="Stock actual" hint="Cantidad disponible hoy, en la unidad elegida.">
          <input name="currentStock" type="number" min="0" step="0.01" required disabled={isPending} placeholder="Ej. 80" className={CONTROL_CLASS} />
        </Field>
        <Field label="Consumo diario estimado" hint="Promedio consumido por día, en la misma unidad.">
          <input name="dailyConsumption" type="number" min="0.01" step="0.01" required disabled={isPending} placeholder="Ej. 10" className={CONTROL_CLASS} />
        </Field>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={isPending || products.length === 0} className="button-primary disabled:cursor-not-allowed disabled:opacity-60">
          {isPending ? "Guardando..." : "Guardar información"}
        </button>
      </div>
      </form>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="space-y-1.5"><span className="block text-sm font-semibold text-stone-700">{label}</span>{children}{hint && <span className="block text-xs text-stone-500">{hint}</span>}</label>;
}
