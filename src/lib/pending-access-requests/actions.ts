"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function approveAccessRequest(_previous: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) return { error: "No tenés permisos para aprobar solicitudes." };
  const requestId = String(formData.get("requestId") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    return { error: "Solicitud no válida." };
  }
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("approve_access_request", { p_request_id: requestId });
    if (error) {
      const messages: Record<string, string> = {
        "42501": "No tenés permisos para aprobar esta solicitud.",
        P3701: "La solicitud no está disponible.",
        P3702: "La solicitud ya no está pendiente. Actualizá el listado.",
        P3703: "El rol solicitado no es válido para esta aprobación.",
        P3704: "La cuenta del solicitante no tiene un email disponible.",
        P3705: "El solicitante debe completar un nombre válido en /complete-registration antes de aprobar.",
        P3706: "El usuario ya tiene un perfil operativo. No se modificó.",
        "23505": "El usuario ya tiene un perfil operativo. Actualizá el listado.",
      };
      console.error("Error aprobando solicitud", { code: error.code });
      return { error: messages[error.code] ?? "No pudimos aprobar la solicitud. Intentá nuevamente." };
    }
  } catch {
    return { error: "No pudimos confirmar la aprobación. Actualizá el listado antes de reintentar." };
  }
  revalidatePath("/dashboard/operators");
  redirect("/dashboard/operators?tab=solicitudes&done=approved");
}
