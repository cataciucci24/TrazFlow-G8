"use server";

import { revalidatePath } from "next/cache";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isErpEnabled } from "@/lib/erp-sync/enabled";

export type WarehouseActionState = { error: string | null; success: string | null };

async function manageWarehouse(action: "create" | "rename" | "deactivate", form: FormData): Promise<WarehouseActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return { error: "Solo logística puede administrar depósitos.", success: null };
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  const name = String(form.get("name") ?? "").trim();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code) || (action !== "deactivate" && (!name || name.length > 140))) {
    return { error: "Revisá el código y el nombre del depósito.", success: null };
  }
  if (action === "create" && await isErpEnabled(profile.companyId)) {
    return { error: "Los depósitos se incorporan desde el ERP de la empresa.", success: null };
  }
  const db = await createClient();
  const { error } = await db.rpc("manage_manual_warehouse", { p_action: action, p_code: code, p_name: name || null });
  if (error) {
    const messages: Record<string, string> = {
      "23505": "Ya existe un depósito con ese código.",
      "23514": "El depósito contiene pallets en stock y no puede desactivarse.",
      "42501": "No tenés permiso para modificar este depósito.",
      TF116: "Los depósitos se incorporan desde el ERP de la empresa.",
      P0002: "No se encontró el depósito.",
    };
    return { error: messages[error.code] ?? "No se pudo guardar el depósito.", success: null };
  }
  revalidatePath("/dashboard", "layout");
  return { error: null, success: action === "create" ? "Depósito creado." : action === "rename" ? "Nombre actualizado." : "Depósito desactivado." };
}

export async function createWarehouse(_previous: WarehouseActionState, form: FormData): Promise<WarehouseActionState> {
  return manageWarehouse("create", form);
}

export async function renameWarehouse(_previous: WarehouseActionState, form: FormData): Promise<WarehouseActionState> {
  return manageWarehouse("rename", form);
}

export async function deactivateWarehouse(_previous: WarehouseActionState, form: FormData): Promise<WarehouseActionState> {
  return manageWarehouse("deactivate", form);
}

export async function reactivateWarehouse(_previous: WarehouseActionState, form: FormData): Promise<WarehouseActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return { error: "Solo logística puede administrar depósitos.", success: null };
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)) return { error: "Revisá el código del depósito.", success: null };
  const db = await createClient();
  const { error } = await db.rpc("reactivate_manual_warehouse", { p_code: code });
  if (error) return { error: error.code === "42501" ? "No tenés permiso para modificar este depósito." : "No se pudo activar el depósito.", success: null };
  revalidatePath("/dashboard", "layout");
  return { error: null, success: "Depósito activado." };
}
