"use client";

import { useState } from "react";
import type { ProductBatch } from "@/lib/types";

const fieldClass = "mt-2 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-normal normal-case tracking-normal text-slate-950 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100";

const NEW_LOT = "__new__";

/**
 * Antes este campo era texto libre: un typo en el lote creaba un lote nuevo
 * en silencio (upsert por product_id+batch_number) en vez de reusar el
 * existente, lo que rompe la trazabilidad por lote. Acá se obliga a elegir
 * uno de los lotes ya registrados para el SKU tipeado, o a declarar
 * explícitamente que es un lote nuevo.
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
  const [touched, setTouched] = useState(defaultValue !== "");

  const knownSelection = touched && selection !== NEW_LOT && matchingLots.includes(selection);
  const isNew = touched ? !knownSelection : matchingLots.length === 0;
  const selectValue = isNew ? NEW_LOT : touched ? selection : "";

  return (
    <div className="grid gap-2">
      <label className="block text-xs font-bold uppercase tracking-wide text-stone-500">
        Lote
        <select
          required
          value={selectValue}
          onChange={(event) => {
            setTouched(true);
            setSelection(event.target.value);
          }}
          className={fieldClass}
        >
          {matchingLots.length > 0 && <option value="" disabled>Seleccioná un lote existente</option>}
          <option value={NEW_LOT}>＋ Registrar lote nuevo</option>
          {matchingLots.map((lot) => <option key={lot} value={lot}>{lot}</option>)}
        </select>
      </label>
      {isNew ? (
        <input
          required
          name="batchNumber"
          placeholder="LOTE-0001"
          defaultValue={matchingLots.includes(defaultValue) ? "" : defaultValue}
          className={fieldClass}
        />
      ) : (
        <input type="hidden" name="batchNumber" value={selectValue} />
      )}
    </div>
  );
}
