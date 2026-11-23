import type { PalletContent } from "@/lib/pallets/contents";

export function PalletContentList({ items }: { items: PalletContent[] }) {
  return <ul className="space-y-1 text-sm" aria-label="Contenido del pallet">{items.map((item) => <li key={item.itemId} className="break-words">
    {item.productName} ({item.productSku}) · Lote {item.batchNumber} · {item.quantity === null ? "Cantidad sin definir" : `${item.quantity.toLocaleString("es-AR")} ${item.unitOfMeasure}`}
  </li>)}</ul>;
}
