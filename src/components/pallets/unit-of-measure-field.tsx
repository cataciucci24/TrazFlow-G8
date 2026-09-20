import { PALLET_UNITS } from "@/lib/pallets/units";
import type { PalletUnit } from "@/lib/pallets/units";

export function UnitOfMeasureField({ defaultValue }: { defaultValue?: PalletUnit | null }) {
  return (
    <label className="block text-xs font-bold uppercase tracking-wide text-stone-500">
      Unidad de medida
      <select required name="unitOfMeasure" defaultValue={defaultValue ?? ""}
        className="form-control mt-2 font-normal">
        <option value="" disabled>{defaultValue === null ? "Sin definir" : "Seleccioná una unidad"}</option>
        {PALLET_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
      </select>
    </label>
  );
}
