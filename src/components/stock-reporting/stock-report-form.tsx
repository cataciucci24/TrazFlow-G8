"use client";

import { actionErrorMessage } from "@/components/ui/feedback-messages";
import { InlineAlert } from "@/components/ui/design-system";

import { useActionState, useState } from "react";

import { PALLET_UNITS } from "@/lib/pallets/units";
import { saveDistributorStock, type SaveDistributorStockState } from "@/lib/stock-reporting/actions";
import type { StockReportingProduct } from "@/lib/stock-reporting/queries";

const INITIAL_STATE: SaveDistributorStockState = { error: null, success: null };

export function StockReportForm({
  products,
}: {
  products: StockReportingProduct[];
}) {
  const [values, setValues] = useState({ productId: "", unitOfMeasure: "", currentStock: "", dailyConsumption: "" });
  const [state, formAction, isPending] = useActionState(saveDistributorStock, INITIAL_STATE);

  return (
    <section className="section-stack" aria-labelledby="update-stock-title">
      <div><h2 id="update-stock-title" className="section-title">Actualizar disponibilidad</h2><p className="section-description">Informá una estimación diaria para anticipar posibles quiebres de stock.</p></div>
      <form action={formAction} className="surface space-y-5 p-5 sm:p-6">
      <div>
        <InlineAlert announce={false}>Los datos se asociarán automáticamente a tu distribuidora.</InlineAlert>
      </div>

      {state.error && <InlineAlert variant="danger">{actionErrorMessage(state.error)}</InlineAlert>}
      {state.success && <InlineAlert variant="success">{state.success}</InlineAlert>}

      {products.length === 0 && <InlineAlert variant="warning">No hay productos disponibles para informar stock. Consultá con el administrador de tu empresa.</InlineAlert>}
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Producto">
          <select name="productId" required disabled={isPending} value={values.productId} onChange={(event) => setValues((current) => ({ ...current, productId: event.target.value }))} className="form-control">
            <option value="">Seleccionar producto</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}
          </select>
        </Field>
        <Field label="Unidad de medida" hint="Se usa para el stock y el consumo diario.">
          <select name="unitOfMeasure" required disabled={isPending} value={values.unitOfMeasure} onChange={(event) => setValues((current) => ({ ...current, unitOfMeasure: event.target.value }))} className="form-control">
            <option value="" disabled>Seleccionar unidad</option>
            {PALLET_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </Field>
        <Field label="Stock actual" hint="Cantidad disponible hoy, en la unidad elegida.">
          <input name="currentStock" value={values.currentStock} onChange={(event) => setValues((current) => ({ ...current, currentStock: event.target.value }))} type="number" min="0" step="0.01" required disabled={isPending} placeholder="Ej. 80" className="form-control" />
        </Field>
        <Field label="Consumo diario estimado" hint="Promedio consumido por día, en la misma unidad.">
          <input name="dailyConsumption" value={values.dailyConsumption} onChange={(event) => setValues((current) => ({ ...current, dailyConsumption: event.target.value }))} type="number" min="0.01" step="0.01" required disabled={isPending} placeholder="Ej. 10" className="form-control" />
        </Field>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={isPending || products.length === 0} aria-busy={isPending} className="button-primary">
          {isPending ? "Guardando..." : "Guardar información"}
        </button>
      </div>
      </form>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="space-y-1.5"><span className="form-label">{label}</span>{children}{hint && <span className="block text-xs text-stone-500">{hint}</span>}</label>;
}
