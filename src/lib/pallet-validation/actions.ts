"use server";

import type { ObservedPalletItem } from "@/lib/pallets/item-input";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { processCompanyErpOutbox } from "@/lib/erp-outbox/run";
import type {
  PalletValidationResult,
  ValidationOutcome,
} from "@/lib/pallet-validation/types";

type ValidationRpcRow = {
  outcome: ValidationOutcome;
  pallet_id: string | null;
  qr_code: string | null;
  product_name: string | null;
  product_sku: string | null;
  batch_number: string | null;
  validated_at: string | null;
};

const MESSAGES: Record<ValidationOutcome, string> = {
  content_required: "Confirmá el contenido detectado de cada ítem del pallet.",
  content_mismatch: "El contenido detectado no coincide con lo esperado. Revisá producto, lote y cantidad de cada ítem.",
  validated: "Pallet validado correctamente.",
  already_validated: "Este pallet ya fue validado.",
  pallet_not_found: "El código QR no corresponde a un pallet registrado.",
  wrong_order: "Este pallet no pertenece a la orden de despacho.",
  order_not_found: "La orden no existe o no pertenece a tu empresa.",
  forbidden: "No tenés permisos para validar pallets.",
  invalid_input: "El código QR leído no es válido.",
  error: "No se pudo validar el pallet. Intentá nuevamente.",
};

/** Valida un QR usando la función transaccional protegida por RLS. */
export async function validatePallet(
  orderId: string,
  scannedCode: string,
  items?: ObservedPalletItem[],
): Promise<PalletValidationResult> {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "warehouse_operator")) {
    return { outcome: "forbidden", message: MESSAGES.forbidden, pallet: null };
  }

  const qrCode = scannedCode.trim();
  if (!orderId || !qrCode || qrCode.length > 512) {
    return {
      outcome: "invalid_input",
      message: MESSAGES.invalid_input,
      pallet: null,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("validate_order_pallet_items", {
    p_items: items ?? null,
    p_order_id: orderId,
    p_qr_code: qrCode,
  });

  if (error) {
    return { outcome: "error", message: MESSAGES.error, pallet: null };
  }

  const row = (data?.[0] ?? null) as ValidationRpcRow | null;
  if (!row) {
    return { outcome: "error", message: MESSAGES.error, pallet: null };
  }

  if (row.outcome === "validated" || row.outcome === "content_mismatch") {
    revalidatePath(`/dashboard/orders/${orderId}`);
    // TRZ-63: el escaneo quedó en el outbox (trigger de order_pallets); se manda sin hacer esperar al operador.
    after(() =>
      processCompanyErpOutbox({
        db: { rpc: (fn, args) => supabase.rpc(fn, args), storage: supabase.storage },
        companyId: profile.companyId,
      }),
    );
  }

  const hasPalletDetails =
    row.pallet_id !== null &&
    row.qr_code !== null &&
    row.product_name !== null &&
    row.product_sku !== null &&
    row.batch_number !== null &&
    row.validated_at !== null;

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
          validatedAt: row.validated_at!,
        }
      : null,
  };
}
