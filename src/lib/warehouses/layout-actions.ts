"use server";

import { revalidatePath } from "next/cache";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parseWarehouseLayout } from "./layout";
import type { WarehouseActionState } from "./actions";

export async function updateWarehouseLayout(_previous: WarehouseActionState, form: FormData): Promise<WarehouseActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return { error: "Solo logística puede configurar la distribución.", success: null };
  const code = String(form.get("code") ?? "").trim();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)) return { error: "Seleccioná un depósito válido.", success: null };
  let value: unknown;
  try { value = JSON.parse(String(form.get("layout") ?? "")); } catch { value = null; }
  const layout = parseWarehouseLayout(value);
  if (!layout) return { error: "Ingresá entre uno y cuatro niveles con nombres completos.", success: null };
  const db = await createClient();
  const { data, error } = await db.from("warehouses").update({ layout }).eq("company_id", profile.companyId).eq("code", code).select("code").maybeSingle();
  if (error) {
    if (error.code === "23514") return { error: "No se puede cambiar la cantidad de niveles si el depósito tiene ubicaciones. Podés cambiar sus nombres.", success: null };
    if (error.code === "42501") return { error: "No tenés permiso para configurar este depósito.", success: null };
    return { error: "No se pudo guardar la distribución.", success: null };
  }
  if (!data) return { error: "No se encontró el depósito o no tenés permiso para modificarlo.", success: null };
  revalidatePath("/dashboard", "layout");
  return { error: null, success: "Distribución actualizada." };
}
