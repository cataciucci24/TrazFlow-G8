"use client";

import { useState } from "react";
import type { ProductBatch } from "@/lib/types";

const fieldClass = "form-control mt-2 font-normal";

/**
 * La creación de lotes se realiza desde la sección Lotes. Al registrar o
 * editar un pallet se exige asociarlo a un lote ya existente para preservar
 * la trazabilidad y, en particular, su fecha real de vencimiento.
 */
export function LotField({
  productSku,
  existingBatches,
  defaultValue = "",
}: {
  productSku: string;
  existingBatches: ProductBatch[];
  defaultValue?: string;
}) {
  const normalizedSku = productSku.trim().toLocaleLowerCase("es-AR");
  const matchingLots = Array.from(
    new Set(
      existingBatches
        .filter((batch) => batch.productSku.trim().toLocaleLowerCase("es-AR") === normalizedSku)
        .map((batch) => batch.batchNumber),
    ),
  ).sort((a, b) => a.localeCompare(b, "es-AR"));

  const [selection, setSelection] = useState(defaultValue);
  const selectedLot = matchingLots.includes(selection) ? selection : "";

  return (
    <div className="grid gap-2">
      <label className="block text-xs font-bold uppercase tracking-wide text-stone-500">
        Lote
        <select
          required
          disabled={matchingLots.length === 0}
          value={selectedLot}
          onChange={(event) => setSelection(event.target.value)}
          className={fieldClass}
        >
          <option value="" disabled>{matchingLots.length > 0 ? "Seleccioná un lote existente" : "No hay lotes para este producto"}</option>
          {matchingLots.map((lot) => <option key={lot} value={lot}>{lot}</option>)}
        </select>
      </label>
      {matchingLots.length === 0 ? <p className="text-xs text-stone-500">Creá primero un lote para este producto desde la sección Lotes.</p> : <input type="hidden" name="batchNumber" value={selectedLot} />}
    </div>
  );
}
