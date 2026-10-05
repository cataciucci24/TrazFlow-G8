"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { OperatorActionState } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPERATORS_PATH = "/dashboard/operators";

const messages: Record<string, string> = {
  "42501": "No tenés permisos para gestionar operadores.",
  P3801: "El operador no está disponible. Actualizá el listado.",
  P3802: "Solo se pueden vincular operadores de distribuidor.",
  P3803: "El distribuidor no está disponible.",
  P3804: "El operador tiene el acceso revocado. Restauralo antes de vincularlo.",
  P3811: "La solicitud no está disponible.",
  P3812: "La solicitud ya no está pendiente. Actualizá el listado.",
  P3821: "El operador no está disponible. Actualizá el listado.",
  P3822: "Solo se puede gestionar el acceso de operadores.",
  P3823: "El acceso ya estaba revocado. Actualizá el listado.",
  P3824: "El acceso no está revocado. Actualizá el listado.",
};

/** Ejecuta una RPC de gestión y traduce sus códigos de error a mensajes. */
async function runOperatorRpc(
  fn: string, args: Record<string, string>, fallback: string,
): Promise<OperatorActionState> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return { error: messages["42501"] };
  if (!Object.values(args).every((value) => UUID.test(value))) return { error: "Datos no válidos." };
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc(fn, args);
    if (error) {
      console.error(`Error en ${fn}`, { code: error.code });
      return { error: messages[error.code] ?? fallback };
    }
  } catch {
    return { error: "No pudimos confirmar la operación. Actualizá el listado antes de reintentar." };
  }
  return { error: null };
}

export async function assignOperatorDistributor(_previous: OperatorActionState, formData: FormData): Promise<OperatorActionState> {
  const result = await runOperatorRpc("assign_operator_distributor", {
    p_user_id: String(formData.get("userId") ?? ""),
    p_distributor_id: String(formData.get("distributorId") ?? ""),
  }, "No pudimos vincular el operador. Intentá nuevamente.");
  if (result.error) return result;
  revalidatePath(OPERATORS_PATH);
  redirect(`${OPERATORS_PATH}?tab=operadores&done=assigned`);
}

export async function revokeOperatorAccess(_previous: OperatorActionState, formData: FormData): Promise<OperatorActionState> {
  const result = await runOperatorRpc("revoke_operator_access", {
    p_user_id: String(formData.get("userId") ?? ""),
  }, "No pudimos revocar el acceso. Intentá nuevamente.");
  if (result.error) return result;
  revalidatePath(OPERATORS_PATH);
  redirect(`${OPERATORS_PATH}?tab=operadores&done=revoked`);
}

export async function restoreOperatorAccess(_previous: OperatorActionState, formData: FormData): Promise<OperatorActionState> {
  const result = await runOperatorRpc("restore_operator_access", {
    p_user_id: String(formData.get("userId") ?? ""),
  }, "No pudimos restaurar el acceso. Intentá nuevamente.");
  if (result.error) return result;
  revalidatePath(OPERATORS_PATH);
  redirect(`${OPERATORS_PATH}?tab=operadores&done=restored`);
}

export async function rejectAccessRequest(_previous: OperatorActionState, formData: FormData): Promise<OperatorActionState> {
  const result = await runOperatorRpc("reject_access_request", {
    p_request_id: String(formData.get("requestId") ?? ""),
  }, "No pudimos rechazar la solicitud. Intentá nuevamente.");
  if (result.error) return result;
  revalidatePath(OPERATORS_PATH);
  redirect(`${OPERATORS_PATH}?tab=solicitudes&done=rejected`);
}
