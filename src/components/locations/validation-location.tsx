import { formatLocationCoordinates, formatPalletLocation, type PalletLocation } from "@/lib/locations/format";
import type { WarehouseLayout } from "@/lib/warehouses/layout";

/** Conserva la referencia estable y agrega las etiquetas solo cuando hay layout. */
export function ValidationLocation({ location, layouts }: { location: PalletLocation | null; layouts: Record<string, WarehouseLayout> }) {
  const layout = location ? layouts[location.warehouseCode] : undefined;
  const coordinates = location && layout ? formatLocationCoordinates(location, layout) : "";
  return <div className={`mt-0.5 break-all font-mono text-xs ${location ? "font-semibold text-slate-700" : "text-stone-400"}`}>
    <p><span className="sr-only">Ubicación: </span>{formatPalletLocation(location)}</p>
    {coordinates && <p>{coordinates}</p>}
  </div>;
}
