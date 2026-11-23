export type PalletItemInput = { batch_id: string; quantity: number };
export type ObservedPalletItem = { productSku: string; batchNumber: string; quantity: number | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validPalletItems(items: unknown): items is PalletItemInput[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) return false;
  const seen = new Set<string>();
  return items.every((item) => {
    if (!item || typeof item !== "object" || typeof item.batch_id !== "string" || !UUID.test(item.batch_id)
      || typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0
      || Math.abs(item.quantity * 100 - Math.round(item.quantity * 100)) > 1e-9 || seen.has(item.batch_id.toLowerCase())) return false;
    seen.add(item.batch_id.toLowerCase());
    return true;
  });
}
