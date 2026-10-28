import { PALLET_LOCATION_EMBED, toPalletLocation, type RawPalletLocation } from "../locations/format.ts";
import { normalizePalletStatus, type StoredPalletStatus } from "./status.ts";
import type { ProductUnit } from "./units.ts";
import type { Pallet } from "@/lib/types";

export type RawProduct = { name: string; sku: string; unit_of_measure: ProductUnit };

export type RawPalletBatch = {
  batch_number: string;
  expiration_date?: string | null;
  source_system?: "trazflow" | "erp";
  products: RawProduct | RawProduct[] | null;
};

/**
 * Fila cruda que devuelve Postgrest al embeber batches/products. El cliente
 * de Supabase no tiene tipos generados (createClient no recibe un genérico
 * Database), así que esta forma es la que observamos en runtime: la relación
 * hacia el lado "uno" de un FK puede llegar como objeto o como array según
 * la versión del cliente, por eso el mapeo defensivo en `mapPalletRow`.
 */
export type RawPalletRow = {
  id: string;
  qr_code: string;
  status: StoredPalletStatus;
  current_location: string | null;
  current_location_id?: string | null;
  warehouse_code?: string | null;
  quantity: number | null;
  created_at: string;
  source_system?: "trazflow" | "erp";
  external_id?: string | null;
  synced_at?: string | null;
  location?: RawPalletLocation | RawPalletLocation[] | null;
  batches:
    | RawPalletBatch
    | RawPalletBatch[]
    | null;
};

export const PALLET_SELECT =
  `id, qr_code, status, current_location, current_location_id, warehouse_code, quantity, created_at, source_system, external_id, synced_at, ${PALLET_LOCATION_EMBED}, batches ( batch_number, expiration_date, source_system, products ( name, sku, unit_of_measure ) )`;

export function mapPalletRow(row: RawPalletRow): Pallet {
  const batch = Array.isArray(row.batches) ? row.batches[0] : row.batches;
  const product = batch
    ? Array.isArray(batch.products)
      ? batch.products[0]
      : batch.products
    : null;

  return {
    id: row.id,
    qrCode: row.qr_code,
    status: normalizePalletStatus(row.status),
    currentLocation: row.current_location,
    currentLocationId: row.current_location_id ?? null,
    location: toPalletLocation(row.location),
    warehouseCode: row.warehouse_code ?? null,
    productName: product?.name ?? "—",
    productSku: product?.sku ?? "—",
    batchNumber: batch?.batch_number ?? "—",
    quantity: row.quantity,
    // batches.product_id es obligatorio: el producto solo falta si la fila embebida no llegó.
    unitOfMeasure: product?.unit_of_measure ?? "unidades",
    origin: {
      sourceSystem: row.source_system ?? "trazflow",
      externalId: row.external_id ?? null,
      syncedAt: row.synced_at ?? null,
    },
    lotSourceSystem: batch?.source_system ?? "trazflow",
    batchExpirationDate: batch?.expiration_date ?? null,
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
