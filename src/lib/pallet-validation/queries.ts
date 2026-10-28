import { createClient } from "@/lib/supabase/server";
import { filterActiveDispatchDiscrepancies } from "@/lib/pallet-validation/discrepancies";
import {
  mapOrderPalletValidations,
  ORDER_PALLET_VALIDATION_SELECT,
  type RawOrderPallet,
} from "@/lib/pallet-validation/mapping";
import type {
  OrderDispatchDiscrepancy,
  OrderPalletValidation,
} from "@/lib/pallet-validation/types";

/** Pallets de una orden con el estado persistido de validación de US3. */
export async function getOrderPalletValidations(
  orderId: string,
): Promise<OrderPalletValidation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_pallets")
    .select(ORDER_PALLET_VALIDATION_SELECT)
    .eq("order_id", orderId)
    .order("pallet_id");

  if (error) {
    throw new Error(
      `No se pudieron leer las validaciones de pallets (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  return mapOrderPalletValidations((data ?? []) as unknown as RawOrderPallet[]);
}

type RawDispatchDiscrepancy = {
  event_type: string;
  pallet_id: string | null;
  details: {
    type?: string;
    qr_code?: string;
  } | null;
  created_at: string;
};

/** Discrepancias de despacho vigentes (ver filterActiveDispatchDiscrepancies). */
export async function getOrderDispatchDiscrepancies(
  orderId: string,
): Promise<OrderDispatchDiscrepancy[]> {
  const supabase = await createClient();

  const [eventsResult, orderPalletsResult] = await Promise.all([
    supabase
      .from("traceability_events")
      .select("event_type, pallet_id, details, created_at")
      .eq("order_id", orderId)
      .in("event_type", ["dispatch_discrepancy", "pallet_associated", "pallet_dissociated"])
      .order("created_at", { ascending: true }),
    supabase.from("order_pallets").select("pallet_id").eq("order_id", orderId),
  ]);

  const error = eventsResult.error ?? orderPalletsResult.error;
  if (error) {
    throw new Error(
      `No se pudieron leer las inconsistencias del despacho (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  const rows = (eventsResult.data ?? []) as RawDispatchDiscrepancy[];
  const orderPalletIds = (orderPalletsResult.data ?? []).map((row) => row.pallet_id as string);

  const discrepancies = rows
    .filter((row) => row.event_type === "dispatch_discrepancy")
    .map((row) => ({
      palletId: row.pallet_id,
      qrCode: row.details?.qr_code ?? "—",
      type: row.details?.type ?? "unknown",
      createdAt: row.created_at,
    }));

  const compositionChanges = rows
    .filter((row) => row.event_type !== "dispatch_discrepancy")
    .map((row) => ({ palletId: row.pallet_id, createdAt: row.created_at }));

  return filterActiveDispatchDiscrepancies(discrepancies, orderPalletIds, compositionChanges);
}