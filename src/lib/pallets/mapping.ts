import { PALLET_LOCATION_EMBED, toPalletLocation, type RawPalletLocation } from "../locations/format.ts";
import { normalizePalletStatus, type StoredPalletStatus } from "./status.ts";
import type { PalletContent } from "./contents.ts";
import type { ProductUnit } from "./units.ts";
import type { Pallet } from "@/lib/types";

export type RawProduct = { name: string; sku: string; unit_of_measure: ProductUnit };

/** Cabecera física. El contenido se carga exclusivamente desde contents.ts. */
export type RawPalletRow = {
  id: string;
  qr_code: string;
  status: StoredPalletStatus;
  current_location: string | null;
  current_location_id?: string | null;
  warehouse_code?: string | null;
  created_at: string;
  source_system?: "trazflow" | "erp";
  external_id?: string | null;
  synced_at?: string | null;
  location?: RawPalletLocation | RawPalletLocation[] | null;
  contents?: PalletContent[];
};

export const PALLET_SELECT =
  `id, qr_code, status, current_location, current_location_id, warehouse_code, created_at, source_system, external_id, synced_at, ${PALLET_LOCATION_EMBED}`;

export function mapPalletRow(row: RawPalletRow): Pallet {
  const content = row.contents?.[0];

  return {
    id: row.id,
    qrCode: row.qr_code,
    status: normalizePalletStatus(row.status),
    currentLocation: row.current_location,
    currentLocationId: row.current_location_id ?? null,
    location: toPalletLocation(row.location),
    warehouseCode: row.warehouse_code ?? null,
    productName: row.contents && row.contents.length > 1 ? `Pallet mixto (${row.contents.length} ítems)` : content?.productName ?? "—",
    productSku: row.contents?.map((item) => item.productSku).join(" · ") || "—",
    batchNumber: row.contents?.map((item) => item.batchNumber).join(" · ") || "—",
    quantity: row.contents?.length === 1 ? content?.quantity ?? null : null,
    contents: row.contents ?? [],
    unitOfMeasure: content?.unitOfMeasure ?? "unidades",
    origin: {
      sourceSystem: row.source_system ?? "trazflow",
      externalId: row.external_id ?? null,
      syncedAt: row.synced_at ?? null,
    },
    lotSourceSystem: content?.lotSourceSystem ?? "trazflow",
    batchExpirationDate: content?.expirationDate ?? null,
    palletCreatedAt: row.created_at,
  };
}

/** Filas de `order_pallets` con el pallet embebido → pallets de la orden. */
export function mapOrderPalletRows(rows: { pallets: unknown }[]): Pallet[] {
  return rows
    .map((row) => {
      const pallet = row.pallets as RawPalletRow | RawPalletRow[] | null;
      return Array.isArray(pallet) ? pallet[0] : pallet;
    })
    .filter((pallet): pallet is RawPalletRow => pallet != null)
    .map(mapPalletRow);
}
