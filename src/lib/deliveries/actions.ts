"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { processDriverDeliveryEvents } from "@/lib/erp-outbox/run";
import { createClient } from "@/lib/supabase/server";
import type { DeliveryDiscrepancyType, DeliveryOutcome, DeliveryResult } from "@/lib/deliveries/types";
import { REGISTER_RECEIPT_MESSAGES, type RegisterReceiptOutcome } from "@/lib/deliveries/receipts";

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
  // Si con este pallet se cerró la entrega, el trigger ya dejó el informe en el outbox: se manda ahora.
  // Si la entrega sigue abierta no hay nada que tomar y la llamada no hace nada.
  if (row.outcome === "delivered") sendDeliveryToErp(supabase, profile.companyId, orderId);
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

/**
 * Registra un remito firmado que el navegador ya subió al bucket (TRZ-103). El archivo no pasa por acá (el límite
 * de las server actions es 1 MB): solo la ruta. La base valida que el objeto exista, su tipo y su tamaño, y si la
 * orden vino del ERP encola el envío, que se hace
 * enseguida, en segundo plano (sendDeliveryToErp). Si el ERP falla, se reintenta como cualquier reporte.
 */
export async function registerDeliveryReceipt(
  orderId: string,
  storagePath: string,
  fileName: string,
): Promise<{ outcome: RegisterReceiptOutcome; message: string }> {
  const profile = await requireUserProfile();
  const reply = (outcome: RegisterReceiptOutcome) => ({ outcome, message: REGISTER_RECEIPT_MESSAGES[outcome] });
  if (!hasRole(profile, "driver_operator")) return reply("forbidden");
  const name = fileName.trim().slice(0, 200) || "remito";
  if (!UUID.test(orderId) || !storagePath.startsWith(`${profile.companyId}/${orderId}/`) || storagePath.length > 400) {
    return reply("invalid_input");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_delivery_receipt", {
    p_order_id: orderId,
    p_storage_path: storagePath,
    p_file_name: name,
  });
  if (error) {
    console.error("Error registrando remito de entrega", { code: error.code });
    return reply("error");
  }
  const outcome = ((data?.[0] as { outcome?: RegisterReceiptOutcome } | undefined)?.outcome) ?? "error";
  if (outcome === "registered") {
    revalidatePath(`/dashboard/deliveries/${orderId}`);
    sendDeliveryToErp(supabase, profile.companyId, orderId);
  }
  return reply(REGISTER_RECEIPT_MESSAGES[outcome] ? outcome : "error");
}

/** Después de responder al chofer, manda al ERP lo que haya quedado pendiente de esta entrega (TRZ-103). */
function sendDeliveryToErp(supabase: Awaited<ReturnType<typeof createClient>>, companyId: string, orderId: string) {
  after(() =>
    processDriverDeliveryEvents({
      db: { rpc: (fn, args) => supabase.rpc(fn, args), storage: supabase.storage },
      companyId,
      orderId,
    }),
  );
}
