"use server";

import { revalidatePath } from "next/cache";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type SaveDistributorStockState = {
  error: string | null;
  success: string | null;
};

const EMPTY_STATE: SaveDistributorStockState = { error: null, success: null };

const RPC_MESSAGES: Record<string, string> = {
  "42501": "No tenés permisos para informar stock de una distribuidora.",
  P3902: "La distribuidora de tu cuenta no está configurada correctamente. Contactá al administrador.",
  P3903: "El producto seleccionado no está disponible para tu empresa.",
  P3905: "El consumo diario debe ser un número mayor a cero.",
  P3906: "Revisá las cantidades: deben ser mayores a cero y, en unidades o cajas, enteras.",
  P3907: "Uno de los lotes no corresponde al producto seleccionado.",
  P3908: "Cada lote puede informarse una sola vez.",
};

export async function saveDistributorStock(
  _previousState: SaveDistributorStockState,
  formData: FormData,
): Promise<SaveDistributorStockState> {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "distributor_operator")) {
    return { ...EMPTY_STATE, error: "No tenés permisos para informar stock de una distribuidora." };
  }

  const productId = String(formData.get("productId") ?? "").trim();
  const dailyConsumption = Number(formData.get("dailyConsumption"));
  const batches = parseBatches(String(formData.get("batches") ?? ""));

  if (!productId) {
    return { ...EMPTY_STATE, error: "Seleccioná el producto." };
  }
  if (!Number.isFinite(dailyConsumption) || dailyConsumption <= 0) {
    return { ...EMPTY_STATE, error: "El consumo diario debe ser un número mayor a cero." };
  }
  if (!batches) {
    return { ...EMPTY_STATE, error: "Revisá los lotes informados." };
  }
  if (batches.some((batch) => !batch.batch_id)) {
    return { ...EMPTY_STATE, error: "Seleccioná el lote de cada fila." };
  }
  if (new Set(batches.map((batch) => batch.batch_id)).size !== batches.length) {
    return { ...EMPTY_STATE, error: "Cada lote puede informarse una sola vez." };
  }
  if (batches.some((batch) => !Number.isFinite(batch.quantity) || batch.quantity <= 0)) {
    return { ...EMPTY_STATE, error: "La cantidad de cada lote debe ser mayor a cero." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_distributor_stock", {
    p_product_id: productId,
    p_daily_consumption: dailyConsumption,
    p_batches: batches,
  });

  if (error) {
    console.error("Error en save_distributor_stock", { code: error.code });
    return { ...EMPTY_STATE, error: RPC_MESSAGES[error.code] ?? `No se pudo guardar el stock (${error.message}).` };
  }

  revalidatePath("/dashboard/stock-report");
  revalidatePath("/dashboard/alerts");
  revalidatePath("/dashboard");
  return { error: null, success: "Stock por lote y consumo diario actualizados." };
}

type BatchInput = { batch_id: string; quantity: number };

/** El formulario manda los lotes como JSON: [{ batchId, quantity }]. Devuelve null si no tiene esa forma. */
function parseBatches(raw: string): BatchInput[] | null {
  try {
    const value: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(value)) return null;
    return value.map((item) => {
      const entry = item as { batchId?: unknown; quantity?: unknown };
      return { batch_id: typeof entry.batchId === "string" ? entry.batchId : "", quantity: Number(entry.quantity) };
    });
  } catch {
    return null;
  }
}
