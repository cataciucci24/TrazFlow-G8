import { isValidQuantity } from "./units";

export type PalletItemInput = { batch_id: string; quantity: number };
export type ObservedPalletItem = { productSku: string; batchNumber: string; quantity: number | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validPalletItems(items: unknown): items is PalletItemInput[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) return false;
  const seen = new Set<string>();
  const valid = items.every((item) => {
    if (!item || typeof item !== "object" || typeof item.batch_id !== "string" || !UUID.test(item.batch_id)
      || typeof item.quantity !== "number" || !isValidQuantity(item.quantity, "kilogramos")
      || seen.has(item.batch_id.toLowerCase())) return false;
    seen.add(item.batch_id.toLowerCase());
    return true;
  });
  return valid && seen.size === items.length;
}
