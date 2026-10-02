import { createClient } from "@/lib/supabase/server";
import type { RegistrationCompany } from "./options";

export async function getRegistrationCompanies(): Promise<RegistrationCompany[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_registration_companies");
  if (error) throw new Error("No se pudieron cargar las empresas.", { cause: error });
  return data ?? [];
}

/** Se consulta con la sesión actual; RLS restringe la fila al usuario. */
export async function hasRegistrationRequest(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("access_requests")
    .select("id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("No se pudo consultar la solicitud existente.", { cause: error });
  return data !== null;
}
