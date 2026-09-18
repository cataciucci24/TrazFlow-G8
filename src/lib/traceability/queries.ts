import { createClient } from "@/lib/supabase/server";
import type { Pallet, PalletStatus } from "@/lib/types";
import type {
  LotPallet,
  LotTraceability,
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
  quantity: number | null;
  unit_of_measure: Pallet["unitOfMeasure"];
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
    quantity: row.quantity,
    unitOfMeasure: row.unit_of_measure,
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
      "id, qr_code, status, current_location, quantity, unit_of_measure, batches ( batch_number, products ( name, sku ) )",
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

/** Fila cruda del RPC get_lot_traceability: una por (lote, pallet, movement). */
type RawLotRow = {
  batch_id: string;
  batch_number: string;
  expiration_date: string | null;
  batch_quantity: number;
  product_id: string;
  product_name: string;
  product_sku: string;
  pallet_id: string | null;
  pallet_qr_code: string | null;
  pallet_status: PalletStatus | null;
  pallet_current_location: string | null;
  pallet_quantity: number | null;
  pallet_unit_of_measure: Pallet["unitOfMeasure"];
  movement_id: string | null;
  movement_order_id: string | null;
  movement_origin_location: string | null;
  movement_destination_location: string | null;
  movement_resulting_status: PalletStatus | null;
  movement_created_at: string | null;
};

/**
 * Busca el historial de trazabilidad de un lote (por número) y de todos sus
 * pallets asociados. Puede devolver más de un lote si distintos productos de
 * la empresa comparten el mismo número de lote.
 */
export async function getLotTraceability(batchNumber: string): Promise<LotTraceability[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_lot_traceability", { p_batch_number: batchNumber });

  if (error) {
    throw new Error(`No se pudo consultar el lote (${error.code}: ${error.message}).`, { cause: error });
  }

  const lots = new Map<string, LotTraceability>();
  const palletsByBatch = new Map<string, Map<string, LotPallet>>();

  for (const row of (data ?? []) as RawLotRow[]) {
    let lot = lots.get(row.batch_id);
    if (!lot) {
      lot = {
        batchId: row.batch_id,
        batchNumber: row.batch_number,
        expirationDate: row.expiration_date,
        batchQuantity: row.batch_quantity,
        productName: row.product_name,
        productSku: row.product_sku,
        pallets: [],
      };
      lots.set(row.batch_id, lot);
      palletsByBatch.set(row.batch_id, new Map());
    }

    if (!row.pallet_id) continue;

    const palletsForBatch = palletsByBatch.get(row.batch_id)!;
    let lotPallet = palletsForBatch.get(row.pallet_id);
    if (!lotPallet) {
      lotPallet = {
        pallet: {
          id: row.pallet_id,
          qrCode: row.pallet_qr_code!,
          status: row.pallet_status!,
          currentLocation: row.pallet_current_location,
          productName: row.product_name,
          productSku: row.product_sku,
          batchNumber: row.batch_number,
          quantity: row.pallet_quantity,
          unitOfMeasure: row.pallet_unit_of_measure,
        },
        movements: [],
      };
      palletsForBatch.set(row.pallet_id, lotPallet);
      lot.pallets.push(lotPallet);
    }

    if (row.movement_id) {
      lotPallet.movements.push({
        id: row.movement_id,
        orderId: row.movement_order_id,
        originLocation: row.movement_origin_location,
        destinationLocation: row.movement_destination_location!,
        resultingStatus: row.movement_resulting_status!,
        createdAt: row.movement_created_at!,
      });
    }
  }

  return Array.from(lots.values());
}
