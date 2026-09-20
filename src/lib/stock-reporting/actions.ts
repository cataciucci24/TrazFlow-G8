"use server";

import { revalidatePath } from "next/cache";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type SaveDistributorStockState = {
  error: string | null;
  success: string | null;
};

const EMPTY_STATE: SaveDistributorStockState = { error: null, success: null };

export async function saveDistributorStock(
  _previousState: SaveDistributorStockState,
  formData: FormData,
): Promise<SaveDistributorStockState> {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "distributor_operator")) {
    return { ...EMPTY_STATE, error: "No tenés permisos para informar stock de una distribuidora." };
  }

  const productId = String(formData.get("productId") ?? "").trim();
  const currentStock = Number(formData.get("currentStock"));
  const dailyConsumption = Number(formData.get("dailyConsumption"));

  if (!productId) {
    return { ...EMPTY_STATE, error: "Seleccioná el producto." };
  }
  if (!Number.isInteger(currentStock) || currentStock < 0) {
    return { ...EMPTY_STATE, error: "El stock actual debe ser un número entero mayor o igual a cero." };
  }
  if (!Number.isFinite(dailyConsumption) || dailyConsumption <= 0) {
    return { ...EMPTY_STATE, error: "El consumo diario debe ser un número mayor a cero." };
  }

  const supabase = await createClient();
  const [assignmentsResult, productResult] = await Promise.all([
    supabase
      .from("distributor_users")
      .select("distributor_id")
      .eq("user_id", profile.id)
      .limit(2),
    supabase
      .from("products")
      .select("id")
      .eq("id", productId)
      .eq("company_id", profile.companyId)
      .maybeSingle(),
  ]);

  if (assignmentsResult.error) {
    return { ...EMPTY_STATE, error: "No pudimos identificar la distribuidora de tu cuenta. Intentá nuevamente." };
  }
  if (assignmentsResult.data?.length !== 1) {
    return { ...EMPTY_STATE, error: "La distribuidora de tu cuenta no está configurada correctamente. Contactá al administrador." };
  }
  if (productResult.error || !productResult.data) {
    return { ...EMPTY_STATE, error: "El producto seleccionado no está disponible para tu empresa." };
  }

  const distributorId = assignmentsResult.data[0].distributor_id;

  const { error } = await supabase.from("distributor_product_stocks").upsert({
    company_id: profile.companyId,
    distributor_id: distributorId,
    product_id: productId,
    current_stock: currentStock,
    daily_consumption: dailyConsumption,
  }, { onConflict: "distributor_id,product_id" });

  if (error) {
    return { ...EMPTY_STATE, error: `No se pudo guardar el stock (${error.message}).` };
  }

  revalidatePath("/dashboard/stock-report");
  revalidatePath("/dashboard/alerts");
  return { error: null, success: "Stock y consumo diario actualizados." };
}
