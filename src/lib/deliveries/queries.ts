import { createClient } from "@/lib/supabase/server";
import type { AssignedDelivery, DeliveryPallet } from "@/lib/deliveries/types";
import type { OrderStatus } from "@/lib/types";
import { isProductUnit } from "@/lib/pallets/units";

export async function getAssignedDeliveries(driverId: string): Promise<AssignedDelivery[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("dispatch_orders")
    .select("id, status, estimated_dispatch_date, distributors ( name ), order_pallets ( delivery_outcome )")
    .eq("driver_id", driverId)
    .eq("status", "confirmed")
    .order("estimated_dispatch_date", { ascending: true });
  if (error) throw new Error("No se pudieron consultar las entregas asignadas.", { cause: error });
  return (data ?? []).map((row) => {
    const recipient = Array.isArray(row.distributors) ? row.distributors[0] : row.distributors;
    const pallets = row.order_pallets ?? [];
    return {
      id: row.id,
      recipientName: recipient?.name ?? "Destinatario sin nombre",
      status: row.status as OrderStatus,
      estimatedDispatchDate: row.estimated_dispatch_date,
      palletCount: pallets.length,
      processedCount: pallets.filter((item) => item.delivery_outcome !== null).length,
    };
  });
}

type DeliveryPalletRow = {
  pallet_id: string; qr_code: string; product_name: string; product_sku: string;
  batch_number: string; quantity: number | null; unit_of_measure: string;
  delivery_outcome: DeliveryPallet["deliveryOutcome"]; processed_at: string | null;
};

export async function getOrderDeliveryPallets(orderId: string): Promise<DeliveryPallet[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_order_delivery_pallets", { p_order_id: orderId });
  if (error) throw new Error("No se pudieron consultar los pallets de la entrega.", { cause: error });
  return ((data ?? []) as DeliveryPalletRow[]).map((row) => ({
    id: row.pallet_id,
    qrCode: row.qr_code,
    productName: row.product_name,
    productSku: row.product_sku,
    batchNumber: row.batch_number,
    quantity: row.quantity,
    unitOfMeasure: isProductUnit(row.unit_of_measure) ? row.unit_of_measure : "unidades",
    deliveryOutcome: row.delivery_outcome,
    processedAt: row.processed_at,
  }));
}
