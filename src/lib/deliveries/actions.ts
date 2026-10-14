"use server";

import { revalidatePath } from "next/cache";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { DeliveryDiscrepancyType, DeliveryOutcome, DeliveryResult } from "@/lib/deliveries/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const messages: Record<DeliveryOutcome, string> = {
  delivered: "Pallet procesado para la entrega.",
  already_processed: "Este pallet ya fue procesado.",
  surplus_recorded: "El pallet sobrante quedó registrado.",
  pallet_not_found: "El código no corresponde a un pallet registrado.",
  wrong_order: "El pallet no corresponde a esta entrega y la diferencia quedó registrada.",
  order_not_found: "La entrega no existe.",
  invalid_status: "La orden no está en tránsito o la entrega ya fue cerrada.",
  invalid_pallet_status: "El pallet no se encuentra en tránsito.",
  invalid_discrepancy_type: "La diferencia seleccionada no es válida para este pallet.",
  forbidden: "No tenés permisos para confirmar esta entrega.",
  invalid_input: "El código leído no es válido.",
  error: "No se pudo registrar la entrega. Intentá nuevamente.",
};

type RpcRow = {
  outcome: DeliveryOutcome; pallet_id: string | null; qr_code: string | null;
  product_name: string | null; product_sku: string | null; batch_number: string | null;
};

export async function confirmDeliveryPallet(
  orderId: string,
  scannedCode: string,
  discrepancyType: DeliveryDiscrepancyType | null,
): Promise<DeliveryResult> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "driver_operator")) return { outcome: "forbidden", message: messages.forbidden, pallet: null };
  const qrCode = scannedCode.trim();
  if (!UUID.test(orderId) || !qrCode || qrCode.length > 512) {
    return { outcome: "invalid_input", message: messages.invalid_input, pallet: null };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_delivery_pallet", {
    p_order_id: orderId,
    p_qr_code: qrCode,
    p_discrepancy_type: discrepancyType,
  });
  if (error) {
    console.error("Error confirmando entrega", { code: error.code });
    return { outcome: "error", message: messages.error, pallet: null };
  }
  const row = (data?.[0] ?? null) as RpcRow | null;
  if (!row) return { outcome: "error", message: messages.error, pallet: null };
  revalidatePath(`/dashboard/deliveries/${orderId}`);
  revalidatePath("/dashboard/deliveries");
  const hasDetails = row.pallet_id && row.qr_code && row.product_name && row.product_sku && row.batch_number;
  return {
    outcome: row.outcome,
    message: messages[row.outcome] ?? messages.error,
    pallet: hasDetails ? {
      id: row.pallet_id!, qrCode: row.qr_code!, productName: row.product_name!,
      productSku: row.product_sku!, batchNumber: row.batch_number!,
    } : null,
  };
}
