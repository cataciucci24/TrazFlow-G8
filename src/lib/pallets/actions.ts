"use server";

import { revalidatePath } from "next/cache";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type CreatePalletState = {
  error: string | null;
  success: string | null;
};

const INITIAL_ERROR = "No se pudo crear el pallet. Revisá los datos e intentá nuevamente.";

/** Crea un pallet en depósito, reutilizando producto/lote si ya existen. */
export async function createPallet(
  _previousState: CreatePalletState,
  formData: FormData,
): Promise<CreatePalletState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) {
    return { error: "Solo logística puede registrar pallets.", success: null };
  }

  const qrCode = String(formData.get("qrCode") ?? "").trim();
  const productName = String(formData.get("productName") ?? "").trim();
  const productSku = String(formData.get("productSku") ?? "").trim();
  const batchNumber = String(formData.get("batchNumber") ?? "").trim();
  const quantity = Number(formData.get("quantity") ?? 0);

  if (!qrCode || !productName || !productSku || !batchNumber || !Number.isInteger(quantity) || quantity < 0) {
    return { error: "Completá código QR, producto, SKU, lote y una cantidad válida.", success: null };
  }

  const supabase = await createClient();
  const { data: product, error: productError } = await supabase
    .from("products")
    .upsert({ company_id: profile.companyId, sku: productSku, name: productName }, { onConflict: "company_id,sku" })
    .select("id")
    .single();
  if (productError || !product) return { error: INITIAL_ERROR, success: null };

  const { data: batch, error: batchError } = await supabase
    .from("batches")
    .upsert({ product_id: product.id, batch_number: batchNumber, quantity }, { onConflict: "product_id,batch_number" })
    .select("id")
    .single();
  if (batchError || !batch) return { error: INITIAL_ERROR, success: null };

  const { error: palletError } = await supabase.from("pallets").insert({
    company_id: profile.companyId,
    batch_id: batch.id,
    qr_code: qrCode,
    current_location: "Depósito",
  });
  if (palletError) {
    return { error: palletError.code === "23505" ? "Ya existe un pallet con ese código QR." : INITIAL_ERROR, success: null };
  }

  revalidatePath("/dashboard/traceability");
  revalidatePath("/dashboard/orders");
  return { error: null, success: `Pallet ${qrCode} registrado en depósito.` };
}
