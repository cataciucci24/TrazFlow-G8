"use server";

import { isPalletUnit } from "@/lib/pallets/units";

import { revalidatePath } from "next/cache";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type CreatePalletState = {
  error: string | null;
  success: string | null;
};

export type UpdatePalletState = CreatePalletState;
export type DeletePalletState = CreatePalletState;
export type CreateLotState = CreatePalletState;

const INITIAL_ERROR = "No se pudo crear el pallet. Revisá los datos e intentá nuevamente.";

/** Registra un lote sin exigir que ya tenga pallets asociados. */
export async function createLot(
  _previousState: CreateLotState,
  formData: FormData,
): Promise<CreateLotState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) {
    return { error: "Solo logística puede registrar lotes.", success: null };
  }

  const productName = String(formData.get("productName") ?? "").trim();
  const productSku = String(formData.get("productSku") ?? "").trim();
  const batchNumber = String(formData.get("batchNumber") ?? "").trim();
  const expirationDate = String(formData.get("expirationDate") ?? "").trim();

  if (!productName || !productSku || !batchNumber) {
    return { error: "Completá producto, SKU y número de lote.", success: null };
  }
  if (batchNumber.length > 512) {
    return { error: "El número de lote no puede superar los 512 caracteres.", success: null };
  }
  if (expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) {
    return { error: "Ingresá una fecha de vencimiento válida.", success: null };
  }

  const supabase = await createClient();
  const { data: product, error: productError } = await supabase
    .from("products")
    .upsert({ company_id: profile.companyId, sku: productSku, name: productName }, { onConflict: "company_id,sku" })
    .select("id")
    .single();
  if (productError || !product) {
    return { error: "No se pudo identificar el producto del lote.", success: null };
  }

  const { error: lotError } = await supabase.from("batches").insert({
    product_id: product.id,
    batch_number: batchNumber,
    expiration_date: expirationDate || null,
    quantity: 0,
  });
  if (lotError) {
    return {
      error: lotError.code === "23505"
        ? "Ya existe ese número de lote para el producto seleccionado."
        : "No se pudo registrar el lote. Revisá los datos e intentá nuevamente.",
      success: null,
    };
  }

  revalidatePath("/dashboard/traceability");
  revalidatePath("/dashboard/lots");
  revalidatePath("/dashboard/pallets");
  revalidatePath("/dashboard/alerts");
  return { error: null, success: `Lote ${batchNumber} registrado.` };
}

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
  const unitOfMeasure = String(formData.get("unitOfMeasure") ?? "");

  if (!qrCode || !productName || !productSku || !batchNumber || !Number.isFinite(quantity) || quantity <= 0 || !isPalletUnit(unitOfMeasure)) {
    return { error: "Completá código QR, producto, SKU, lote, una cantidad mayor que 0 y una unidad válida.", success: null };
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
    .select("id")
    .eq("product_id", product.id)
    .eq("batch_number", batchNumber)
    .single();
  if (batchError || !batch) return { error: "El lote seleccionado no existe para ese producto. Crealo primero desde la sección Lotes.", success: null };

  const { error: palletError } = await supabase.from("pallets").insert({
    company_id: profile.companyId,
    batch_id: batch.id,
    qr_code: qrCode,
    quantity,
    unit_of_measure: unitOfMeasure,
    current_location: "Depósito",
  });
  if (palletError) {
    return { error: palletError.code === "23505" ? "Ya existe un pallet con ese código QR." : INITIAL_ERROR, success: null };
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/traceability");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/pallets");
  revalidatePath("/dashboard/lots");
  revalidatePath("/dashboard/alerts");
  return { error: null, success: `Pallet ${qrCode} registrado en depósito.` };
}

/** Actualiza la identificación y la información logística de un pallet. */
export async function updatePallet(
  palletId: string,
  _previousState: UpdatePalletState,
  formData: FormData,
): Promise<UpdatePalletState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) {
    return { error: "Solo logística puede editar pallets.", success: null };
  }

  const qrCode = String(formData.get("qrCode") ?? "").trim();
  const productName = String(formData.get("productName") ?? "").trim();
  const productSku = String(formData.get("productSku") ?? "").trim();
  const batchNumber = String(formData.get("batchNumber") ?? "").trim();
  const currentLocation = String(formData.get("currentLocation") ?? "").trim();
  const quantity = Number(formData.get("quantity") ?? 0);
  const unitOfMeasure = String(formData.get("unitOfMeasure") ?? "");

  if (!qrCode || !productName || !productSku || !batchNumber || !Number.isFinite(quantity) || quantity <= 0 || !isPalletUnit(unitOfMeasure)) {
    return { error: "Completá código QR, producto, SKU, lote, una cantidad mayor que 0 y una unidad válida.", success: null };
  }

  const supabase = await createClient();
  const { data: existingPallet, error: palletLookupError } = await supabase
    .from("pallets")
    .select("id")
    .eq("id", palletId)
    .eq("company_id", profile.companyId)
    .maybeSingle();
  if (palletLookupError || !existingPallet) return { error: "El pallet no existe o no pertenece a tu empresa.", success: null };

  const { data: product, error: productError } = await supabase
    .from("products")
    .upsert({ company_id: profile.companyId, sku: productSku, name: productName }, { onConflict: "company_id,sku" })
    .select("id")
    .single();
  if (productError || !product) return { error: INITIAL_ERROR, success: null };

  const { data: batch, error: batchError } = await supabase
    .from("batches")
    .select("id")
    .eq("product_id", product.id)
    .eq("batch_number", batchNumber)
    .single();
  if (batchError || !batch) return { error: "El lote seleccionado no existe para ese producto. Crealo primero desde la sección Lotes.", success: null };

  const { error: updateError } = await supabase
    .from("pallets")
    .update({ qr_code: qrCode, batch_id: batch.id, quantity, unit_of_measure: unitOfMeasure, current_location: currentLocation || null })
    .eq("id", palletId)
    .eq("company_id", profile.companyId);
  if (updateError) return { error: updateError.code === "23505" ? "Ya existe un pallet con ese código QR." : INITIAL_ERROR, success: null };

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/traceability");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/pallets");
  revalidatePath("/dashboard/lots");
  revalidatePath("/dashboard/alerts");
  return { error: null, success: `Pallet ${qrCode} actualizado.` };
}

/** Elimina solo pallets que todavía están disponibles en depósito. */
export async function deletePallet(palletId: string): Promise<DeletePalletState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) {
    return { error: "Solo logística puede eliminar pallets.", success: null };
  }

  const supabase = await createClient();
  const { data: pallet, error: lookupError } = await supabase
    .from("pallets")
    .select("id, qr_code, status")
    .eq("id", palletId)
    .eq("company_id", profile.companyId)
    .maybeSingle();
  if (lookupError || !pallet) return { error: "El pallet no existe o no pertenece a tu empresa.", success: null };
  if (pallet.status !== "in_warehouse") return { error: "Solo se pueden eliminar pallets que están en depósito.", success: null };

  const { error: deleteError } = await supabase
    .from("pallets")
    .delete()
    .eq("id", palletId)
    .eq("company_id", profile.companyId)
    .eq("status", "in_warehouse");
  if (deleteError) return { error: INITIAL_ERROR, success: null };

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/traceability");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/pallets");
  revalidatePath("/dashboard/lots");
  revalidatePath("/dashboard/alerts");
  return { error: null, success: `Pallet ${pallet.qr_code} eliminado.` };
}
