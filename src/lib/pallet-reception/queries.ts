import { createClient } from "@/lib/supabase/server";
import type { OrderPalletReception } from "@/lib/pallet-reception/types";

type ReceptionQueryRow = {
  pallet_id: string;
  qr_code: string;
  product_name: string;
  product_sku: string;
  batch_number: string;
  received: boolean;
};

/** Pallets esperados de una orden visible para el distribuidor autenticado. */
export async function getOrderPalletReceptions(
  orderId: string,
): Promise<OrderPalletReception[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_order_pallet_receptions", {
    p_order_id: orderId,
  });

  if (error) {
    throw new Error(
      `No se pudieron leer las recepciones de pallets (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  return ((data ?? []) as ReceptionQueryRow[]).map((row) => ({
    id: row.pallet_id,
    qrCode: row.qr_code,
    productName: row.product_name,
    productSku: row.product_sku,
    batchNumber: row.batch_number,
    received: row.received,
  }));
}
