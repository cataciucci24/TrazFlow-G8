import type { ProductUnit } from "@/lib/pallets/units";
import { normalizePalletStatus, type StoredPalletStatus } from "@/lib/pallets/status";
import { createClient } from "@/lib/supabase/server";
import type { Pallet } from "@/lib/types";
import type {
  LotPallet,
  LotTraceability,
  PalletMovement,
  PalletTraceability,
} from "@/lib/traceability/types";
import { buildTimeline, type TimelineEntry, type TimelineEventRow } from "@/lib/traceability/timeline";

type RelatedProduct = {
  name: string;
  sku: string;
  unit_of_measure: ProductUnit;
};

type RelatedBatch = {
  batch_number: string;
  products: RelatedProduct | RelatedProduct[] | null;
};

type RawPalletRow = {
  id: string;
  qr_code: string;
  status: StoredPalletStatus;
  current_location: string | null;
  quantity: number | null;
  batches: RelatedBatch | RelatedBatch[] | null;
};

type RawMovementRow = {
  id: string;
  order_id: string | null;
  origin_location: string | null;
  destination_location: string;
  resulting_status: StoredPalletStatus;
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
    status: normalizePalletStatus(row.status),
    currentLocation: row.current_location,
    productName: product?.name ?? "—",
    productSku: product?.sku ?? "—",
    batchNumber: batch?.batch_number ?? "—",
    quantity: row.quantity,
    // batches.product_id es obligatorio: el producto solo falta si la fila embebida no llegó.
    unitOfMeasure: product?.unit_of_measure ?? "unidades",
  };
}

function mapMovement(row: RawMovementRow): PalletMovement {
  return {
    id: row.id,
    orderId: row.order_id,
    originLocation: row.origin_location,
    destinationLocation: row.destination_location,
    resultingStatus: normalizePalletStatus(row.resulting_status),
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
      "id, qr_code, status, current_location, quantity, batches ( batch_number, products ( name, sku, unit_of_measure ) )",
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
  product_unit_of_measure: ProductUnit;
  pallet_id: string | null;
  pallet_qr_code: string | null;
  pallet_status: StoredPalletStatus | null;
  pallet_current_location: string | null;
  pallet_quantity: number | null;
  movement_id: string | null;
  movement_order_id: string | null;
  movement_origin_location: string | null;
  movement_destination_location: string | null;
  movement_resulting_status: StoredPalletStatus | null;
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
          status: normalizePalletStatus(row.pallet_status!),
          currentLocation: row.pallet_current_location,
          productName: row.product_name,
          productSku: row.product_sku,
          batchNumber: row.batch_number,
          quantity: row.pallet_quantity,
          unitOfMeasure: row.product_unit_of_measure,
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
        resultingStatus: normalizePalletStatus(row.movement_resulting_status!),
        createdAt: row.movement_created_at!,
      });
    }
  }

  return Array.from(lots.values());
}

type RawTimelineRow = {
  id: string;
  event_type: string;
  created_at: string;
  pallet_id: string | null;
  order_id: string | null;
  details: Record<string, unknown> | null;
  user: { name: string | null } | { name: string | null }[] | null;
};

const TIMELINE_SELECT = "id, event_type, created_at, pallet_id, order_id, details, user:users ( name )";
/** Eventos de la orden (sin pallet) que también son parte del recorrido de cada uno de sus pallets. */
const ORDER_LEVEL_EVENTS = ["order_created", "dispatch_confirmed"];

function toTimelineRow(row: RawTimelineRow): TimelineEventRow {
  const user = Array.isArray(row.user) ? row.user[0] : row.user;
  return {
    id: row.id,
    event_type: row.event_type,
    created_at: row.created_at,
    pallet_id: row.pallet_id,
    order_id: row.order_id,
    details: row.details,
    user_name: user?.name ?? null,
  };
}

/**
 * TRZ-57 / TRZ-58: línea de tiempo de uno o varios pallets de la empresa. Junta los eventos de cada pallet,
 * los de las órdenes en las que estuvo (creación y despacho confirmado) y su alta. Más viejo primero.
 */
export async function getPalletsTimeline(palletIds: string[], companyId: string): Promise<TimelineEntry[]> {
  const ids = [...new Set(palletIds)];
  if (ids.length === 0) return [];
  const supabase = await createClient();

  const [palletsResult, eventsResult, ordersResult] = await Promise.all([
    supabase.from("pallets").select("id, qr_code, created_at").eq("company_id", companyId).in("id", ids),
    supabase.from("traceability_events").select(TIMELINE_SELECT).eq("company_id", companyId).in("pallet_id", ids)
      .order("created_at", { ascending: true }).order("id", { ascending: true }),
    supabase.from("order_pallets").select("order_id").in("pallet_id", ids),
  ]);
  const failed = palletsResult.error ?? eventsResult.error ?? ordersResult.error;
  if (failed) {
    throw new Error(`No se pudo consultar la línea de tiempo (${failed.code}: ${failed.message}).`, { cause: failed });
  }

  const palletRows = (palletsResult.data ?? []) as { id: string; qr_code: string; created_at: string }[];
  const eventRows = ((eventsResult.data ?? []) as unknown as RawTimelineRow[]).map(toTimelineRow);
  // Órdenes en las que está o estuvo cada pallet (desasociados incluidos, por sus eventos).
  const orderIds = [...new Set([
    ...((ordersResult.data ?? []) as { order_id: string }[]).map((row) => row.order_id),
    ...eventRows.map((row) => row.order_id).filter((id): id is string => Boolean(id)),
  ])];

  let orderRows: TimelineEventRow[] = [];
  if (orderIds.length > 0) {
    const { data, error } = await supabase.from("traceability_events").select(TIMELINE_SELECT)
      .eq("company_id", companyId).is("pallet_id", null).in("order_id", orderIds).in("event_type", ORDER_LEVEL_EVENTS)
      .order("created_at", { ascending: true }).order("id", { ascending: true });
    if (error) {
      throw new Error(`No se pudo consultar la línea de tiempo (${error.code}: ${error.message}).`, { cause: error });
    }
    orderRows = ((data ?? []) as unknown as RawTimelineRow[]).map(toTimelineRow);
  }

  return buildTimeline(
    [...eventRows, ...orderRows],
    palletRows.map((row) => ({ palletId: row.id, qrCode: row.qr_code, createdAt: row.created_at })),
  );
}
