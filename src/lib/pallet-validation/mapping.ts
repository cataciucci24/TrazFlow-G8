import { PALLET_LOCATION_EMBED, toPalletLocation, type RawPalletLocation } from "../locations/format.ts";
import type { OrderPalletValidation } from "./types.ts";

type RawProduct = { name: string; sku: string };

type RawBatch = {
  batch_number: string;
  products: RawProduct | RawProduct[] | null;
};

type RawPallet = {
  id: string;
  qr_code: string;
  location?: RawPalletLocation | RawPalletLocation[] | null;
  batches: RawBatch | RawBatch[] | null;
};

export type RawOrderPallet = {
  validated_at: string | null;
  validated_by: string | null;
  pallets: RawPallet | RawPallet[] | null;
};

export const ORDER_PALLET_VALIDATION_SELECT =
  `validated_at, validated_by, pallets ( id, qr_code, ${PALLET_LOCATION_EMBED}, batches ( batch_number, products ( name, sku ) ) )`;

/** Filas de `order_pallets` → pallets de la orden con su validación y ubicación. */
export function mapOrderPalletValidations(rows: RawOrderPallet[]): OrderPalletValidation[] {
  return rows.flatMap((row) => {
    const pallet = Array.isArray(row.pallets) ? row.pallets[0] : row.pallets;
    if (!pallet) return [];

    const batch = Array.isArray(pallet.batches) ? pallet.batches[0] : pallet.batches;
    const product = batch
      ? Array.isArray(batch.products)
        ? batch.products[0]
        : batch.products
      : null;

    return [{
      id: pallet.id,
      qrCode: pallet.qr_code,
      productName: product?.name ?? "—",
      productSku: product?.sku ?? "—",
      batchNumber: batch?.batch_number ?? "—",
      location: toPalletLocation(pallet.location),
      validatedAt: row.validated_at,
      validatedBy: row.validated_by,
    }];
  });
}
