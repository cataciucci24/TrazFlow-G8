import { PALLET_LOCATION_EMBED, toPalletLocation, type RawPalletLocation } from "../locations/format.ts";
import type { OrderPalletValidation } from "./types.ts";

import type { PalletContent } from "../pallets/contents.ts";

type RawPallet = {
  id: string;
  qr_code: string;
  location?: RawPalletLocation | RawPalletLocation[] | null;
  contents?: PalletContent[];
};

export type RawOrderPallet = {
  validated_at: string | null;
  validated_by: string | null;
  pallets: RawPallet | RawPallet[] | null;
};

export const ORDER_PALLET_VALIDATION_SELECT =
  `pallet_id, expected_items, validated_at, validated_by, pallets ( id, qr_code, ${PALLET_LOCATION_EMBED} )`;

/** Filas de `order_pallets` → pallets de la orden con su validación y ubicación. */
export function mapOrderPalletValidations(rows: RawOrderPallet[]): OrderPalletValidation[] {
  return rows.flatMap((row) => {
    const pallet = Array.isArray(row.pallets) ? row.pallets[0] : row.pallets;
    if (!pallet) return [];

    const content = pallet.contents?.[0];

    return [{
      contents: pallet.contents ?? [],
      id: pallet.id,
      qrCode: pallet.qr_code,
      productName: (pallet.contents?.length ?? 0) > 1 ? "Pallet mixto" : content?.productName ?? "—",
      productSku: content?.productSku ?? "—",
      batchNumber: content?.batchNumber ?? "—",
      location: toPalletLocation(pallet.location),
      validatedAt: row.validated_at,
      validatedBy: row.validated_by,
    }];
  });
}
