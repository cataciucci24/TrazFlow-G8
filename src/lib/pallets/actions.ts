"use server";

import { isProductUnit, isValidQuantity, type ProductUnit } from "@/lib/pallets/units";

import { revalidatePath } from "next/cache";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { erpStockErrorMessage } from "@/lib/pallets/erp-stock-errors";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/lib/types";

export type CreatePalletState = {
  error: string | null;
  success: string | null;
};

export type UpdatePalletState = CreatePalletState;
export type DeletePalletState = CreatePalletState;
export type CreateLotState = CreatePalletState;

const INITIAL_ERROR = "No se pudo crear el pallet. Revisá los datos e intentá nuevamente.";
const UPDATE_ERROR = "No se pudieron guardar los cambios del pallet. Intentá nuevamente.";
const NOT_EDITABLE_ERROR = "Solo se pueden editar pallets en depósito.";
const DELETE_ERROR = "No se pudo eliminar el pallet. Intentá nuevamente.";
const HAS_HISTORY_ERROR = "No se puede eliminar un pallet con historial de trazabilidad.";
// Con ERP, productos y lotes se dan de alta en el ERP y llegan por sincronización (US-ERP-03). Los pallets
// físicos se arman en TrazFlow contra un lote sincronizado y su saldo (TRZ-100). El alta manual de productos y
// lotes queda para las empresas sin ERP.
const ERP_MANAGED_ERROR = "Tu empresa trabaja con un ERP: productos y lotes se importan desde la sincronización.";
const ERP_LOT_REQUIRED_ERROR = "Con el ERP activo, los pallets se arman contra un lote sincronizado del ERP.";
const ERP_INACTIVE_ERROR = "El lote o su producto está inactivo en el ERP: no se pueden armar pallets.";
const ERP_EDIT_ERROR = "Con el ERP activo solo se puede cambiar la cantidad de pallets armados en TrazFlow contra un lote del ERP.";
const QUANTITY_ERROR = "Ingresá una cantidad mayor que 0: entera en unidades o cajas, con hasta dos decimales en kilogramos.";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type ResolvedProduct = { id: string; unitOfMeasure: ProductUnit };

/**
 * Busca el producto por SKU. Si no existe lo crea con la unidad elegida en el formulario;
 * si ya existe conserva su nombre y su unidad, que no se cambian desde acá.
 */
async function resolveProduct(
  supabase: SupabaseClient,
  companyId: string,
  formData: FormData,
): Promise<ResolvedProduct | { error: string }> {
  const sku = String(formData.get("productSku") ?? "").trim();
  const name = String(formData.get("productName") ?? "").trim();
  const unit = String(formData.get("unitOfMeasure") ?? "");

  const findProduct = () => supabase
    .from("products")
    .select("id, unit_of_measure")
    .eq("company_id", companyId)
    .eq("sku", sku)
    .maybeSingle();

  const { data: existing, error: lookupError } = await findProduct();
  if (lookupError) return { error: "No se pudo identificar el producto." };
  if (existing) return { id: existing.id, unitOfMeasure: existing.unit_of_measure };

  if (!isProductUnit(unit)) return { error: "Elegí la unidad de medida del producto nuevo." };
  const { data: created, error: insertError } = await supabase
    .from("products")
    .insert({ company_id: companyId, sku, name, unit_of_measure: unit })
    .select("id, unit_of_measure")
    .single();
  if (created) return { id: created.id, unitOfMeasure: created.unit_of_measure };

  // Otro usuario lo creó al mismo tiempo: se usa ese.
  if (insertError?.code === "23505") {
    const { data: concurrent } = await findProduct();
    if (concurrent) return { id: concurrent.id, unitOfMeasure: concurrent.unit_of_measure };
  }
  return { error: "No se pudo registrar el producto." };
}

/** Registra un lote sin exigir que ya tenga pallets asociados. */
export async function createLot(
  _previousState: CreateLotState,
  formData: FormData,
): Promise<CreateLotState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) {
    return { error: "Solo logística puede registrar lotes.", success: null };
  }
  if (await isErpEnabled(profile.companyId)) return { error: ERP_MANAGED_ERROR, success: null };

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
  const product = await resolveProduct(supabase, profile.companyId, formData);
  if ("error" in product) return { error: product.error, success: null };

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

type ErpLotRow = {
  id: string;
  batch_number: string;
  source_system: "trazflow" | "erp";
  external_active: boolean | null;
  products: { unit_of_measure: ProductUnit; external_active: boolean | null } | { unit_of_measure: ProductUnit; external_active: boolean | null }[] | null;
};

/** Lote de la empresa con la unidad y el estado en el ERP de su producto. */
async function findLot(supabase: SupabaseClient, companyId: string, batchId: string) {
  const { data, error } = await supabase
    .from("batches")
    .select("id, batch_number, source_system, external_active, products ( unit_of_measure, external_active )")
    .eq("id", batchId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as ErpLotRow;
  const product = Array.isArray(row.products) ? row.products[0] : row.products;
  if (!product) return null;
  return {
    id: row.id,
    batchNumber: row.batch_number,
    fromErp: row.source_system === "erp",
    active: row.external_active !== false && product.external_active !== false,
    unit: product.unit_of_measure,
  };
}

function revalidatePalletPaths() {
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/traceability");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/pallets");
  revalidatePath("/dashboard/pallets/stock-erp");
  revalidatePath("/dashboard/lots");
  revalidatePath("/dashboard/alerts");
}

/**
 * TRZ-100: con ERP, el pallet físico se arma contra un lote sincronizado del ERP con la cantidad real. Queda
 * en TrazFlow (sin external_id), en depósito y en el depósito de la empresa (la base lo completa). El tope por
 * saldo lo valida la base (enforce_erp_stock_cap); acá se traduce su error.
 */
async function createPalletFromErpLot(profile: UserProfile, formData: FormData): Promise<CreatePalletState> {
  const batchId = String(formData.get("batchId") ?? "").trim();
  const quantity = Number(formData.get("quantity") ?? 0);
  if (!batchId) return { error: "Elegí un lote del ERP.", success: null };

  const supabase = await createClient();
  const lot = await findLot(supabase, profile.companyId, batchId);
  if (!lot) return { error: "El lote no existe o no pertenece a tu empresa.", success: null };
  if (!lot.fromErp) return { error: ERP_LOT_REQUIRED_ERROR, success: null };
  if (!lot.active) return { error: ERP_INACTIVE_ERROR, success: null };
  if (!isValidQuantity(quantity, lot.unit)) return { error: QUANTITY_ERROR, success: null };

  const { data: pallet, error } = await supabase.from("pallets").insert({
    company_id: profile.companyId,
    batch_id: lot.id,
    quantity,
    current_location: "Depósito",
  }).select("qr_code").single();
  if (error || !pallet) return { error: erpStockErrorMessage(error) ?? INITIAL_ERROR, success: null };

  revalidatePalletPaths();
  return { error: null, success: `Pallet ${pallet.qr_code} armado con el lote ${lot.batchNumber}.` };
}

/** Crea un pallet en depósito, reutilizando producto/lote si ya existen. Con ERP, contra un lote del ERP. */
export async function createPallet(
  _previousState: CreatePalletState,
  formData: FormData,
): Promise<CreatePalletState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) {
    return { error: "Solo logística puede registrar pallets.", success: null };
  }
  if (await isErpEnabled(profile.companyId)) return createPalletFromErpLot(profile, formData);

  const productName = String(formData.get("productName") ?? "").trim();
  const productSku = String(formData.get("productSku") ?? "").trim();
  const batchNumber = String(formData.get("batchNumber") ?? "").trim();
  const quantity = Number(formData.get("quantity") ?? 0);

  if (!productName || !productSku || !batchNumber) {
    return { error: "Completá producto, SKU y lote.", success: null };
  }

  const supabase = await createClient();
  const product = await resolveProduct(supabase, profile.companyId, formData);
  if ("error" in product) return { error: product.error, success: null };
  if (!isValidQuantity(quantity, product.unitOfMeasure)) return { error: QUANTITY_ERROR, success: null };

  const { data: batch, error: batchError } = await supabase
    .from("batches")
    .select("id")
    .eq("product_id", product.id)
    .eq("batch_number", batchNumber)
    .single();
  if (batchError || !batch) return { error: "El lote seleccionado no existe para ese producto. Crealo primero desde la sección Lotes.", success: null };

  const { data: pallet, error: palletError } = await supabase.from("pallets").insert({
    company_id: profile.companyId,
    batch_id: batch.id,
    quantity,
    current_location: "Depósito",
  }).select("qr_code").single();
  if (palletError || !pallet) {
    return { error: INITIAL_ERROR, success: null };
  }

  revalidatePalletPaths();
  return { error: null, success: `Pallet ${pallet.qr_code} registrado en depósito.` };
}

/**
 * TRZ-100: con ERP solo cambia la cantidad, y solo en pallets en depósito, armados en TrazFlow contra un lote
 * del ERP. Los heredados ('stock:%') siguen bloqueados (también los protege guard_erp_synced_row). El tope lo
 * valida la base.
 */
async function updateErpPalletQuantity(profile: UserProfile, palletId: string, formData: FormData): Promise<UpdatePalletState> {
  const quantity = Number(formData.get("quantity") ?? 0);
  const supabase = await createClient();
  const { data, error: lookupError } = await supabase
    .from("pallets")
    .select("id, qr_code, status, source_system, batch_id")
    .eq("id", palletId)
    .eq("company_id", profile.companyId)
    .maybeSingle();
  if (lookupError || !data) return { error: "El pallet no existe o no pertenece a tu empresa.", success: null };
  if (data.status !== "in_warehouse") return { error: NOT_EDITABLE_ERROR, success: null };
  if (data.source_system !== "trazflow") return { error: ERP_EDIT_ERROR, success: null };
  const lot = await findLot(supabase, profile.companyId, data.batch_id);
  if (!lot?.fromErp) return { error: ERP_EDIT_ERROR, success: null };
  if (!isValidQuantity(quantity, lot.unit)) return { error: QUANTITY_ERROR, success: null };

  const { data: updated, error: updateError } = await supabase
    .from("pallets")
    .update({ quantity })
    .eq("id", palletId)
    .eq("company_id", profile.companyId)
    .eq("status", "in_warehouse")
    .select("id");
  if (updateError) return { error: erpStockErrorMessage(updateError) ?? UPDATE_ERROR, success: null };
  if (!updated || updated.length === 0) return { error: NOT_EDITABLE_ERROR, success: null };

  revalidatePalletPaths();
  return { error: null, success: `Pallet ${data.qr_code} actualizado.` };
}

/** Actualiza la información logística sin modificar la identidad del pallet. */
export async function updatePallet(
  palletId: string,
  _previousState: UpdatePalletState,
  formData: FormData,
): Promise<UpdatePalletState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) {
    return { error: "Solo logística puede editar pallets.", success: null };
  }
  if (await isErpEnabled(profile.companyId)) return updateErpPalletQuantity(profile, palletId, formData);

  const productName = String(formData.get("productName") ?? "").trim();
  const productSku = String(formData.get("productSku") ?? "").trim();
  const batchNumber = String(formData.get("batchNumber") ?? "").trim();
  const quantity = Number(formData.get("quantity") ?? 0);

  if (!productName || !productSku || !batchNumber) {
    return { error: "Completá producto, SKU y lote.", success: null };
  }

  const supabase = await createClient();
  const { data: existingPallet, error: palletLookupError } = await supabase
    .from("pallets")
    .select("id, qr_code, status")
    .eq("id", palletId)
    .eq("company_id", profile.companyId)
    .maybeSingle();
  if (palletLookupError || !existingPallet) return { error: "El pallet no existe o no pertenece a tu empresa.", success: null };
  if (existingPallet.status !== "in_warehouse") return { error: NOT_EDITABLE_ERROR, success: null };

  const product = await resolveProduct(supabase, profile.companyId, formData);
  if ("error" in product) return { error: product.error, success: null };
  if (!isValidQuantity(quantity, product.unitOfMeasure)) return { error: QUANTITY_ERROR, success: null };

  const { data: batch, error: batchError } = await supabase
    .from("batches")
    .select("id")
    .eq("product_id", product.id)
    .eq("batch_number", batchNumber)
    .single();
  if (batchError || !batch) return { error: "El lote seleccionado no existe para ese producto. Crealo primero desde la sección Lotes.", success: null };

  // El filtro por estado cubre el caso de que el pallet se haya asociado a una
  // orden entre la lectura de arriba y este UPDATE.
  const { data: updated, error: updateError } = await supabase
    .from("pallets")
    .update({ batch_id: batch.id, quantity })
    .eq("id", palletId)
    .eq("company_id", profile.companyId)
    .eq("status", "in_warehouse")
    .select("id");
  if (updateError) return { error: UPDATE_ERROR, success: null };
  // 0 filas: el pallet salió del depósito (el UPDATE filtra por status).
  if (!updated || updated.length === 0) return { error: NOT_EDITABLE_ERROR, success: null };

  revalidatePalletPaths();
  return { error: null, success: `Pallet ${existingPallet.qr_code} actualizado.` };
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
  if (deleteError) {
    // 23503: la base conserva el historial (eventos/movimientos) del pallet.
    return { error: deleteError.code === "23503" ? HAS_HISTORY_ERROR : DELETE_ERROR, success: null };
  }

  revalidatePalletPaths();
  return { error: null, success: `Pallet ${pallet.qr_code} eliminado.` };
}
