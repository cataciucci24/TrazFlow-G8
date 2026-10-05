import { createClient } from "@/lib/supabase/server";
import { isRequestedRole } from "@/lib/registration/options";
import type { PendingAccessRequest } from "./types";

type Row = {
  request_id: string; user_id: string; email: string | null;
  company_id: string; company_name: string; requested_role: string;
  status: string; created_at: string;
};

/** La RPC obtiene rol y empresa desde auth.uid(); no acepta permisos del cliente. */
export async function getPendingAccessRequests(): Promise<PendingAccessRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_pending_access_requests");
  if (error) throw new Error("No se pudieron consultar las solicitudes pendientes.", { cause: error });
  return ((data ?? []) as Row[]).map((row) => {
    if (row.status !== "pending" || !isRequestedRole(row.requested_role)) {
      throw new Error("La consulta devolvió una solicitud no válida.");
    }
    return {
      requestId: row.request_id, userId: row.user_id, email: row.email,
      companyId: row.company_id, companyName: row.company_name,
      requestedRole: row.requested_role, status: row.status, createdAt: row.created_at,
    };
  });
}
