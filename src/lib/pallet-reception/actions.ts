"use server";

import { revalidatePath } from "next/cache";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type {
  PalletReceptionResult,
  ReceptionOutcome,
} from "@/lib/pallet-reception/types";

type ReceptionRpcRow = {
  outcome: ReceptionOutcome;
  pallet_id: string | null;
  qr_code: string | null;
  product_name: string | null;
  product_sku: string | null;
  batch_number: string | null;
  registered_at: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MESSAGES: Record<ReceptionOutcome, string> = {
  received: "Pallet recibido correctamente.",
  already_received: "Este pallet ya fue registrado como recibido.",
  pallet_not_found: "El código QR no corresponde a un pallet registrado.",
  wrong_order: "Este pallet no pertenece a esta orden de despacho.",
  order_not_found: "La orden de despacho no existe.",
  invalid_status: "La orden no está en tránsito o ya no admite recepciones.",
  invalid_pallet_status: "El pallet no se encuentra en tránsito.",
  forbidden: "No tenés permisos para registrar esta recepción.",
  invalid_input: "El código QR leído no es válido.",
  error: "No se pudo registrar la recepción. Intentá nuevamente.",
};

/** Registra atómicamente la recepción de un pallet mediante el RPC de US6. */
export async function receivePallet(
  orderId: string,
  scannedCode: string,
): Promise<PalletReceptionResult> {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "distributor_operator")) {
    return { outcome: "forbidden", message: MESSAGES.forbidden, pallet: null };
  }

  const qrCode = scannedCode.trim();
  if (!UUID_PATTERN.test(orderId) || !qrCode || qrCode.length > 512) {
    return {
      outcome: "invalid_input",
      message: MESSAGES.invalid_input,
      pallet: null,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_order_pallet", {
    p_order_id: orderId,
    p_qr_code: qrCode,
  });

  if (error) {
    return { outcome: "error", message: MESSAGES.error, pallet: null };
  }

  const row = (data?.[0] ?? null) as ReceptionRpcRow | null;
  if (!row) {
    return { outcome: "error", message: MESSAGES.error, pallet: null };
  }

  if (row.outcome === "received") {
    revalidatePath(`/dashboard/orders/${orderId}`);
  }

  const hasPalletDetails =
    row.pallet_id !== null &&
    row.qr_code !== null &&
    row.product_name !== null &&
    row.product_sku !== null &&
    row.batch_number !== null;

  return {
    outcome: row.outcome,
    message: MESSAGES[row.outcome] ?? MESSAGES.error,
    pallet: hasPalletDetails
      ? {
          id: row.pallet_id!,
          qrCode: row.qr_code!,
          productName: row.product_name!,
          productSku: row.product_sku!,
          batchNumber: row.batch_number!,
          registeredAt: row.registered_at,
        }
      : null,
  };
}
