import { PRODUCT_UNITS } from "@/lib/pallets/units";
import type { ProductUnit } from "@/lib/pallets/units";

/**
 * La unidad es del producto: se elige una sola vez al crear un SKU nuevo y después
 * se muestra fija para sus lotes y pallets.
 */
export function UnitOfMeasureField({
  fixedUnit,
  value,
  onChange,
  awaitingProduct = false,
}: {
  /** Unidad del producto existente; null si el producto es nuevo o todavía no se eligió. */
  fixedUnit: ProductUnit | null;
  value: ProductUnit | "";
  onChange: (unit: ProductUnit | "") => void;
  /** Todavía no se eligió el producto: no hay unidad para mostrar ni para elegir. */
  awaitingProduct?: boolean;
}) {
  if (fixedUnit) {
    return (
      <label className="form-label">
        Unidad de medida
        <input readOnly value={fixedUnit} className="form-control mt-2 font-normal" />
        <span className="mt-1 block text-xs font-normal text-stone-500">Es la unidad del producto y no se puede cambiar.</span>
      </label>
    );
  }

  if (awaitingProduct) {
    return (
      <label className="form-label">
        Unidad de medida
        <select disabled value="" className="form-control mt-2 font-normal">
          <option value="">Elegí primero el producto</option>
        </select>
      </label>
    );
  }

  return (
    <label className="form-label">
      Unidad de medida
      <select required name="unitOfMeasure" value={value} onChange={(event) => onChange(event.target.value as ProductUnit | "")}
        className="form-control mt-2 font-normal">
        <option value="" disabled>Seleccioná una unidad</option>
        {PRODUCT_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
      </select>
      <span className="mt-1 block text-xs font-normal text-stone-500">Se guarda en el producto y vale para todos sus pallets. Solo kilogramos admite decimales.</span>
    </label>
  );
}
