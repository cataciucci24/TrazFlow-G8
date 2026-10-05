import { createClient } from "@/lib/supabase/server";
import { isRequestedRole } from "@/lib/registration/options";
import type { CompanyOperator, DistributorOption } from "./types";

type Row = {
  user_id: string; name: string; email: string; role: string; revoked_at: string | null;
  distributor_id: string | null; distributor_name: string | null;
  in_transit_orders: number; other_active_operators: number;
};

/** La RPC obtiene rol y empresa desde auth.uid(); no acepta permisos del cliente. */
export async function getCompanyOperators(): Promise<CompanyOperator[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_company_operators");
  if (error) throw new Error("No se pudieron consultar los operadores.", { cause: error });
  return ((data ?? []) as Row[]).map((row) => {
    if (!isRequestedRole(row.role)) throw new Error("La consulta devolvió un operador no válido.");
    return {
      userId: row.user_id, name: row.name, email: row.email, role: row.role, revokedAt: row.revoked_at,
      distributorId: row.distributor_id, distributorName: row.distributor_name,
      inTransitOrders: row.in_transit_orders, otherActiveOperators: row.other_active_operators,
    };
  });
}

/** RLS (`distributors_select`) limita el listado a la empresa del responsable logístico. */
export async function getCompanyDistributors(companyId: string): Promise<DistributorOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("distributors")
    .select("id, name").eq("company_id", companyId).order("name");
  if (error) throw new Error("No se pudieron consultar los distribuidores.", { cause: error });
  return data ?? [];
}
