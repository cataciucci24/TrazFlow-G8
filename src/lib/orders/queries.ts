import { attachExpectedPalletContents, type ExpectedPalletRelation } from "@/lib/pallets/contents";
import { compareOrderLines, type OrderProductComparison } from "@/lib/orders/lines";
import type { ProductUnit } from "@/lib/pallets/units";
import { createClient } from "@/lib/supabase/server";
import type { DispatchOrder } from "@/lib/types";

/** Orden de despacho por id, o null si no existe / RLS no la deja ver (otra empresa). */
export async function getDispatchOrderDetail(
  orderId: string,
): Promise<DispatchOrder | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dispatch_orders")
    .select(
      "id, distributor_id, driver_id, status, estimated_dispatch_date, notes, created_at, source_system, external_id, synced_at, distributors ( name ), driver:users!dispatch_orders_driver_id_fkey ( name )",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `No se pudo leer la orden de despacho (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  if (!data) return null;

  const distributor = Array.isArray(data.distributors)
    ? data.distributors[0]
    : data.distributors;
  const driver = Array.isArray(data.driver) ? data.driver[0] : data.driver;

  return {
    id: data.id,
    distributorId: data.distributor_id,
    distributorName: distributor?.name ?? "—",
    status: data.status,
    estimatedDispatchDate: data.estimated_dispatch_date,
    notes: data.notes,
    createdAt: data.created_at,
    driverId: data.driver_id,
    driverName: driver?.name ?? null,
    origin: { sourceSystem: data.source_system, externalId: data.external_id, syncedAt: data.synced_at },
  };
}

type RawLineProduct = { id: string; name: string; sku: string; unit_of_measure: ProductUnit };
type RawLine = { quantity: number; products: RawLineProduct | RawLineProduct[] | null };
type RawOrderPallet = ExpectedPalletRelation;

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Pedido (líneas del ERP) vs. armado (pallets con expected = true) de una orden, por producto (TRZ-100).
 * `hasLines` = false: la orden del ERP se importó sin líneas (todas las anteriores a TRZ-100).
 */
export async function getOrderLinesComparison(orderId: string): Promise<{ hasLines: boolean; rows: OrderProductComparison[] }> {
  const supabase = await createClient();
  const [lines, pallets] = await Promise.all([
    supabase.from("dispatch_order_lines").select("quantity, products ( id, name, sku, unit_of_measure )").eq("order_id", orderId),
    supabase.from("order_pallets")
      .select("pallet_id, expected_items")
      .eq("order_id", orderId)
      .eq("expected", true),
  ]);
  if (lines.error) throw new Error(`No se pudieron leer las líneas de la orden (${lines.error.code}).`, { cause: lines.error });
  if (pallets.error) throw new Error(`No se pudieron leer los pallets de la orden (${pallets.error.code}).`, { cause: pallets.error });

  const toInput = (product: RawLineProduct, quantity: number | null) => ({
    productId: product.id,
    productName: product.name,
    productSku: product.sku,
    unitOfMeasure: product.unit_of_measure,
    quantity,
  });
  const lineInputs = ((lines.data ?? []) as unknown as RawLine[]).flatMap((line) => {
    const product = one(line.products);
    return product ? [{ ...toInput(product, line.quantity), quantity: Number(line.quantity) }] : [];
  });
  const contents = await attachExpectedPalletContents(supabase, (pallets.data ?? []) as RawOrderPallet[]);
  const palletInputs = contents.flatMap((row) => row.contents.map((item) => ({
    productId: item.productId, productName: item.productName, productSku: item.productSku,
    unitOfMeasure: item.unitOfMeasure, quantity: item.quantity,
  })));
  return { hasLines: lineInputs.length > 0, rows: compareOrderLines(lineInputs, palletInputs) };
}
