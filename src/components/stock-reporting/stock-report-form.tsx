"use client";

import { actionErrorMessage } from "@/components/ui/feedback-messages";
import { InlineAlert } from "@/components/ui/design-system";

import { useActionState, useState } from "react";

import { PALLET_UNITS } from "@/lib/pallets/units";
import { saveDistributorStock, type SaveDistributorStockState } from "@/lib/stock-reporting/actions";
import type { StockReportingProduct } from "@/lib/stock-reporting/queries";
import type { DistributorStockEntry } from "@/lib/types";

const INITIAL_STATE: SaveDistributorStockState = { error: null, success: null };
const NUMBER_FORMATTER = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "UTC" });

type BatchRow = { key: number; batchId: string; quantity: string };

let nextRowKey = 0;
function emptyRow(): BatchRow {
  return { key: nextRowKey++, batchId: "", quantity: "" };
}

export function StockReportForm({
  products,
  entries,
}: {
  products: StockReportingProduct[];
  /** Stock ya informado: al elegir un producto se precargan sus valores para editarlos. */
  entries: DistributorStockEntry[];
}) {
  const [values, setValues] = useState({ productId: "", unitOfMeasure: "", dailyConsumption: "" });
  const [rows, setRows] = useState<BatchRow[]>(() => [emptyRow()]);
  const [state, formAction, isPending] = useActionState(saveDistributorStock, INITIAL_STATE);

  const product = products.find((item) => item.id === values.productId);
  const total = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  const batchesJson = JSON.stringify(rows.map((row) => ({ batchId: row.batchId, quantity: row.quantity })));

  function selectProduct(productId: string) {
    const entry = entries.find((item) => item.productId === productId);
    setValues({
      productId,
      unitOfMeasure: entry?.unitOfMeasure ?? "",
      dailyConsumption: entry ? String(entry.dailyConsumption) : "",
    });
    setRows(entry && entry.batches.length > 0
      ? entry.batches.map((batch) => ({ key: nextRowKey++, batchId: batch.batchId, quantity: String(batch.quantity) }))
      : [emptyRow()]);
  }

  function updateRow(key: number, change: Partial<BatchRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...change } : row));
  }

  return (
    <section className="section-stack" aria-labelledby="update-stock-title">
      <div><h2 id="update-stock-title" className="section-title">Actualizar disponibilidad</h2><p className="section-description">Informá cuánto tenés de cada lote y el consumo diario estimado para anticipar quiebres de stock y vencimientos.</p></div>
      <form action={formAction} className="surface space-y-5 p-5 sm:p-6">
      <div>
        <InlineAlert announce={false}>Los datos se asociarán automáticamente a tu distribuidora.</InlineAlert>
      </div>

      {state.error && <InlineAlert variant="danger">{actionErrorMessage(state.error)}</InlineAlert>}
      {state.success && <InlineAlert variant="success">{state.success}</InlineAlert>}

      {products.length === 0 && <InlineAlert variant="warning">No hay productos disponibles para informar stock. Consultá con el administrador de tu empresa.</InlineAlert>}
      <div className="grid gap-5 md:grid-cols-3">
        <Field label="Producto">
          <select name="productId" required disabled={isPending} value={values.productId} onChange={(event) => selectProduct(event.target.value)} className="form-control">
            <option value="">Seleccionar producto</option>
            {products.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>)}
          </select>
        </Field>
        <Field label="Unidad de medida" hint="Se usa para las cantidades y el consumo diario.">
          <select name="unitOfMeasure" required disabled={isPending} value={values.unitOfMeasure} onChange={(event) => setValues((current) => ({ ...current, unitOfMeasure: event.target.value }))} className="form-control">
            <option value="" disabled>Seleccionar unidad</option>
            {PALLET_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </Field>
        <Field label="Consumo diario estimado" hint="Promedio consumido por día, en la misma unidad.">
          <input name="dailyConsumption" value={values.dailyConsumption} onChange={(event) => setValues((current) => ({ ...current, dailyConsumption: event.target.value }))} type="number" min="0.01" step="0.01" required disabled={isPending} placeholder="Ej. 10" className="form-control" />
        </Field>
      </div>

      <input type="hidden" name="batches" value={batchesJson} />
      <fieldset className="space-y-3" disabled={isPending || !product}>
        <legend className="form-label">Stock por lote</legend>
        {!product ? (
          <p className="text-sm text-stone-500">Elegí un producto para cargar sus lotes.</p>
        ) : product.batches.length === 0 ? (
          <InlineAlert variant="warning" announce={false}>Este producto no tiene lotes registrados. Pedile al responsable logístico que los registre para poder informar stock.</InlineAlert>
        ) : (
          <>
            {rows.map((row, index) => (
              <div key={row.key} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-stone-600">Lote {index + 1}</span>
                  <select value={row.batchId} required onChange={(event) => updateRow(row.key, { batchId: event.target.value })} className="form-control">
                    <option value="">Seleccionar lote</option>
                    {product.batches.map((batch) => {
                      const takenElsewhere = rows.some((other) => other.key !== row.key && other.batchId === batch.id);
                      return (
                        <option key={batch.id} value={batch.id} disabled={takenElsewhere}>
                          {batch.batchNumber} · {batch.expirationDate ? `vence ${DATE_FORMATTER.format(new Date(`${batch.expirationDate}T00:00:00Z`))}` : "sin fecha de vencimiento"}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-stone-600">Cantidad</span>
                  <input value={row.quantity} onChange={(event) => updateRow(row.key, { quantity: event.target.value })} type="number" min="0.01" step={values.unitOfMeasure === "kilogramos" ? "0.01" : "1"} required placeholder="Ej. 40" className="form-control" />
                </label>
                <button type="button" onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))} className="button-secondary button-sm whitespace-nowrap" aria-label={`Quitar lote ${index + 1}`}>
                  Quitar
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-3">
              <button type="button" onClick={() => setRows((current) => [...current, emptyRow()])} disabled={rows.length >= product.batches.length} className="button-secondary button-sm">
                + Agregar lote
              </button>
              <p className="text-sm text-stone-600" role="status">
                {rows.length === 0
                  ? "Sin lotes: el stock del producto queda en 0."
                  : <>Stock total: <span className="font-semibold text-stone-900">{NUMBER_FORMATTER.format(total)} {values.unitOfMeasure}</span></>}
              </p>
            </div>
          </>
        )}
      </fieldset>

      <div className="flex justify-end">
        <button type="submit" disabled={isPending || !product || product.batches.length === 0} aria-busy={isPending} className="button-primary">
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
