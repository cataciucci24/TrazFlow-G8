import { createClient } from "@/lib/supabase/server";
import type { AccessRequest } from "./types";

/** El ID proviene del usuario validado en servidor; RLS limita la lectura al dueño. */
export async function getAccessRequest(userId: string): Promise<AccessRequest | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("access_requests")
    .select("id, company_id, requested_role, status, created_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("No se pudo consultar la solicitud de acceso.", { cause: error });
  }
  if (!data) return null;

  // No interpretar valores desconocidos como un estado válido o solicitud ausente.
  if (
    !["pending", "approved", "rejected"].includes(data.status) ||
    !["warehouse_operator", "distributor_operator"].includes(data.requested_role)
  ) {
    throw new Error("La solicitud de acceso contiene valores no reconocidos.");
  }

  return {
    id: data.id,
    companyId: data.company_id,
    requestedRole: data.requested_role,
    status: data.status,
    createdAt: data.created_at,
  };
}

export async function getRequestedCompanyName(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_registration_companies");
  if (error) {
    throw new Error("No se pudo consultar la empresa solicitada.", { cause: error });
  }

  const companies = data as { id: string; name: string }[] | null;
  const company = companies?.find((item) => item.id === companyId);
  if (!company) throw new Error("No se encontró la empresa de la solicitud.");
  return company.name;
}
