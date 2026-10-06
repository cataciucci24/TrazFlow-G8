"use client";

import { useState } from "react";

import { UnitOfMeasureField } from "@/components/pallets/unit-of-measure-field";
import type { ProductUnit } from "@/lib/pallets/units";
import type { ExistingProduct } from "@/lib/types";

const fieldClass = "form-control mt-2 font-normal";

const NEW_PRODUCT = "__new__";

/** SKU elegido y su unidad (la del producto existente o la elegida para el nuevo; null si falta). */
export type ProductSelection = { sku: string; unitOfMeasure: ProductUnit | null };

/**
 * Mismo problema que resolvía LotField pero para productos: tipear el SKU
 * de un producto existente con otro nombre pisaba silenciosamente el nombre
 * real (upsert por company_id+sku). Acá se obliga a elegir un SKU ya
 * registrado (el nombre queda de solo lectura) o a declarar explícitamente
 * un producto nuevo. La unidad de medida sigue la misma regla: se elige solo
 * para un producto nuevo y en uno existente se muestra la suya, fija.
 */
export function ProductField({
  existingProducts,
  defaultSku = "",
  defaultName = "",
  onChange,
}: {
  existingProducts: ExistingProduct[];
  defaultSku?: string;
  defaultName?: string;
  onChange?: (selection: ProductSelection) => void;
}) {
  const uniqueProducts = Array.from(
    new Map(existingProducts.map((product) => [product.sku, product])).values(),
  ).sort((a, b) => a.sku.localeCompare(b.sku, "es-AR"));

  const [selection, setSelection] = useState(defaultSku);
  const [touched, setTouched] = useState(defaultSku !== "");
  const [freeSku, setFreeSku] = useState(defaultSku);
  const [freeName, setFreeName] = useState(defaultName);
  const [freeUnit, setFreeUnit] = useState<ProductUnit | "">("");

  const matchingProduct = uniqueProducts.find((product) => product.sku === selection);
  const knownSelection = touched && selection !== NEW_PRODUCT && Boolean(matchingProduct);
  const isNew = touched ? !knownSelection : uniqueProducts.length === 0;
  const selectValue = isNew ? NEW_PRODUCT : touched ? selection : "";

  function handleSelectChange(value: string) {
    setTouched(true);
    setSelection(value);
    const product = uniqueProducts.find((candidate) => candidate.sku === value);
    onChange?.(product
      ? { sku: product.sku, unitOfMeasure: product.unitOfMeasure }
      : { sku: freeSku, unitOfMeasure: freeUnit || null });
  }

  return (
    <>
      <div className="grid gap-2">
        <label className="form-label">
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
            aria-label="SKU del producto nuevo"
            placeholder="SKU-001"
            value={freeSku}
            onChange={(event) => {
              setFreeSku(event.target.value);
              onChange?.({ sku: event.target.value, unitOfMeasure: freeUnit || null });
            }}
            className={fieldClass}
          />
        ) : (
          <input type="hidden" name="productSku" value={selectValue} />
        )}
      </div>
      <label className="form-label">
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
              className={fieldClass}
            />
            <input type="hidden" name="productName" value={matchingProduct?.name ?? ""} />
          </>
        )}
      </label>
      <UnitOfMeasureField
        fixedUnit={isNew ? null : matchingProduct?.unitOfMeasure ?? null}
        awaitingProduct={!isNew && !matchingProduct}
        value={freeUnit}
        onChange={(unit) => {
          setFreeUnit(unit);
          onChange?.({ sku: freeSku, unitOfMeasure: unit || null });
        }}
      />
    </>
  );
}
