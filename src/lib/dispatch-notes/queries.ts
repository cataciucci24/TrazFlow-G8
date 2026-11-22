import "server-only";

import { createClient } from "@/lib/supabase/server";
import { toDispatchNote, type DispatchNote } from "@/lib/dispatch-notes/types";

/** TRZ-51: remito de una orden de la empresa, o null si la orden todavía no se despachó. */
export async function getDispatchNote(orderId: string, companyId: string): Promise<DispatchNote | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dispatch_notes")
    .select("id, order_id, number, issued_at, content")
    .eq("order_id", orderId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo consultar el remito (${error.code}: ${error.message}).`, { cause: error });
  return data ? toDispatchNote(data) : null;
}
