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

  const distributorId = String(formData.get("distributorId") ?? "").trim();
  const productId = String(formData.get("productId") ?? "").trim();
  const currentStock = Number(formData.get("currentStock"));
  const dailyConsumption = Number(formData.get("dailyConsumption"));

  if (!distributorId || !productId) {
    return { ...EMPTY_STATE, error: "Seleccioná la distribuidora y el producto." };
  }
  if (!Number.isInteger(currentStock) || currentStock < 0) {
    return { ...EMPTY_STATE, error: "El stock actual debe ser un número entero mayor o igual a cero." };
  }
  if (!Number.isFinite(dailyConsumption) || dailyConsumption <= 0) {
    return { ...EMPTY_STATE, error: "El consumo diario debe ser un número mayor a cero." };
  }

  const supabase = await createClient();
  const [assignmentResult, productResult] = await Promise.all([
    supabase
      .from("distributor_users")
      .select("distributor_id")
      .eq("user_id", profile.id)
      .eq("distributor_id", distributorId)
      .maybeSingle(),
    supabase
      .from("products")
      .select("id")
      .eq("id", productId)
      .eq("company_id", profile.companyId)
      .maybeSingle(),
  ]);

  if (assignmentResult.error || !assignmentResult.data) {
    return { ...EMPTY_STATE, error: "La distribuidora seleccionada no está asociada a tu usuario." };
  }
  if (productResult.error || !productResult.data) {
    return { ...EMPTY_STATE, error: "El producto seleccionado no está disponible para tu empresa." };
  }

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
