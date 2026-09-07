import { createClient } from "@/lib/supabase/server";
import type { Pallet, PalletStatus } from "@/lib/types";
import type {
  PalletMovement,
  PalletTraceability,
} from "@/lib/traceability/types";

type RelatedProduct = {
  name: string;
  sku: string;
};

type RelatedBatch = {
  batch_number: string;
  products: RelatedProduct | RelatedProduct[] | null;
};

type RawPalletRow = {
  id: string;
  qr_code: string;
  status: PalletStatus;
  current_location: string | null;
  batches: RelatedBatch | RelatedBatch[] | null;
};

type RawMovementRow = {
  id: string;
  order_id: string | null;
  origin_location: string | null;
  destination_location: string;
  resulting_status: PalletStatus;
  created_at: string;
};

function mapPallet(row: RawPalletRow): Pallet {
  const batch = Array.isArray(row.batches) ? row.batches[0] : row.batches;
  const product = batch
    ? Array.isArray(batch.products)
      ? batch.products[0]
      : batch.products
    : null;

  return {
    id: row.id,
    qrCode: row.qr_code,
    status: row.status,
    currentLocation: row.current_location,
    productName: product?.name ?? "—",
    productSku: product?.sku ?? "—",
    batchNumber: batch?.batch_number ?? "—",
  };
}

function mapMovement(row: RawMovementRow): PalletMovement {
  return {
    id: row.id,
    orderId: row.order_id,
    originLocation: row.origin_location,
    destinationLocation: row.destination_location,
    resultingStatus: row.resulting_status,
    createdAt: row.created_at,
  };
}

/** Busca el estado y los movimientos de un pallet de la empresa autenticada. */
export async function getPalletTraceability(
  qrCode: string,
  companyId: string,
): Promise<PalletTraceability | null> {
  const supabase = await createClient();
  const { data: palletData, error: palletError } = await supabase
    .from("pallets")
    .select(
      "id, qr_code, status, current_location, batches ( batch_number, products ( name, sku ) )",
    )
    .eq("qr_code", qrCode)
    .eq("company_id", companyId)
    .maybeSingle();

  if (palletError) {
    throw new Error(
      `No se pudo consultar el pallet (${palletError.code}: ${palletError.message}).`,
      { cause: palletError },
    );
  }

  if (!palletData) return null;

  const pallet = mapPallet(palletData as unknown as RawPalletRow);
  const { data: movementData, error: movementError } = await supabase
    .from("movements")
    .select(
      "id, order_id, origin_location, destination_location, resulting_status, created_at",
    )
    .eq("pallet_id", pallet.id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (movementError) {
    throw new Error(
      `No se pudo consultar el historial del pallet (${movementError.code}: ${movementError.message}).`,
      { cause: movementError },
    );
  }

  return {
    pallet,
    movements: ((movementData ?? []) as RawMovementRow[]).map(mapMovement),
  };
}
