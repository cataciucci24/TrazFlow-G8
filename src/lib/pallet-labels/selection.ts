import type { Pallet } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LABELS = 60;

export function parsePalletSelection(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  return Array.from(new Set(raw.split(",").map((item) => item.trim()).filter((item) => UUID.test(item)))).slice(0, MAX_LABELS);
}

export function palletLabelContent(pallet: Pallet) {
  return {
    qrValue: pallet.qrCode,
    readableCode: pallet.qrCode,
    product: pallet.productName,
    batch: pallet.batchNumber,
    quantity: pallet.quantity,
    unit: pallet.unitOfMeasure,
  };
}
