"use client";

import { useActionState } from "react";

import { InlineAlert, SectionHeader } from "@/components/ui/design-system";
import { requestErpStockEntry, type ErpStockEntryState } from "@/lib/erp-stock/actions";
import type { ErpStockRow } from "@/lib/erp-stock/types";

const INITIAL: ErpStockEntryState = { error: null, success: null };

/** TRZ-62: alta (recepción) o baja (ajuste) de un lote, que se informa al ERP como borrador. */
export function ErpStockEntryForm({ rows }: { rows: ErpStockRow[] }) {
  const [state, action, pending] = useActionState(requestErpStockEntry, INITIAL);
  if (rows.length === 0) return null;

  return <section className="section-stack">
    <SectionHeader title="Informar movimiento al ERP"
      description="Recepción o ajuste de un lote. Llega al ERP en borrador y el stock cambia cuando lo confirman ahí." />
    <form action={action} className="surface space-y-4 p-5 sm:p-6">
      {state.error && <InlineAlert variant="danger">{state.error}</InlineAlert>}
      {state.success && <InlineAlert variant="success">{state.success}</InlineAlert>}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Lote y depósito">
          <select name="lot" required disabled={pending} className="form-control">
            {rows.map((row) => <option key={`${row.batchId}|${row.warehouseCode}`} value={`${row.batchId}|${row.warehouseCode}`}>
              {row.productName} · lote {row.batchNumber} · {row.warehouseCode}
            </option>)}
          </select>
        </Field>
        <Field label="Tipo">
          <select name="entryType" required disabled={pending} className="form-control">
            <option value="receipt">Alta (recepción)</option>
            <option value="issue">Baja (ajuste)</option>
          </select>
        </Field>
        <Field label="Cantidad">
          <input name="quantity" type="number" min="0.01" step="0.01" required disabled={pending} className="form-control" />
        </Field>
        <Field label="Motivo">
          <input name="reason" maxLength={200} required disabled={pending} placeholder="Ej. llegó el camión del proveedor" className="form-control" />
        </Field>
      </div>
      <button type="submit" disabled={pending} aria-busy={pending} className="button-primary">Enviar al ERP</button>
    </form>
  </section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1.5"><span className="form-label">{label}</span>{children}</label>;
}
