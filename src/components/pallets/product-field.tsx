"use client";

import { useState } from "react";
import type { ExistingProduct } from "@/lib/types";

const fieldClass = "form-control mt-2 font-normal";

const NEW_PRODUCT = "__new__";

/**
 * Mismo problema que resolvía LotField pero para productos: tipear el SKU
 * de un producto existente con otro nombre pisaba silenciosamente el nombre
 * real (upsert por company_id+sku). Acá se obliga a elegir un SKU ya
 * registrado (el nombre queda de solo lectura) o a declarar explícitamente
 * un producto nuevo.
 */
export function ProductField({
  existingProducts,
  defaultSku = "",
  defaultName = "",
  onSkuChange,
}: {
  existingProducts: ExistingProduct[];
  defaultSku?: string;
  defaultName?: string;
  onSkuChange?: (sku: string) => void;
}) {
  const uniqueProducts = Array.from(
    new Map(existingProducts.map((product) => [product.sku, product])).values(),
  ).sort((a, b) => a.sku.localeCompare(b.sku, "es-AR"));

  const [selection, setSelection] = useState(defaultSku);
  const [touched, setTouched] = useState(defaultSku !== "");
  const [freeSku, setFreeSku] = useState(defaultSku);
  const [freeName, setFreeName] = useState(defaultName);

  const matchingProduct = uniqueProducts.find((product) => product.sku === selection);
  const knownSelection = touched && selection !== NEW_PRODUCT && Boolean(matchingProduct);
  const isNew = touched ? !knownSelection : uniqueProducts.length === 0;
  const selectValue = isNew ? NEW_PRODUCT : touched ? selection : "";

  function handleSelectChange(value: string) {
    setTouched(true);
    setSelection(value);
    const product = uniqueProducts.find((candidate) => candidate.sku === value);
    onSkuChange?.(product ? product.sku : freeSku);
  }

  return (
    <>
      <div className="grid gap-2">
        <label className="block text-xs font-bold uppercase tracking-wide text-stone-500">
          SKU
          <select
            required
            value={selectValue}
            onChange={(event) => handleSelectChange(event.target.value)}
            className={fieldClass}
          >
            {uniqueProducts.length > 0 && <option value="" disabled>Seleccioná un producto existente</option>}
            <option value={NEW_PRODUCT}>＋ Producto nuevo</option>
            {uniqueProducts.map((product) => <option key={product.sku} value={product.sku}>{product.sku}</option>)}
          </select>
        </label>
        {isNew ? (
          <input
            required
            name="productSku"
            placeholder="SKU-001"
            value={freeSku}
            onChange={(event) => {
              setFreeSku(event.target.value);
              onSkuChange?.(event.target.value);
            }}
            className={fieldClass}
          />
        ) : (
          <input type="hidden" name="productSku" value={selectValue} />
        )}
      </div>
      <label className="block text-xs font-bold uppercase tracking-wide text-stone-500">
        Producto
        {isNew ? (
          <input
            required
            name="productName"
            placeholder="Nombre del producto"
            value={freeName}
            onChange={(event) => setFreeName(event.target.value)}
            className={fieldClass}
          />
        ) : (
          <>
            <input
              readOnly
              value={matchingProduct?.name ?? ""}
              className={`${fieldClass} cursor-not-allowed text-stone-500`}
            />
            <input type="hidden" name="productName" value={matchingProduct?.name ?? ""} />
          </>
        )}
      </label>
    </>
  );
}
