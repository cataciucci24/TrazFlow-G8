"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasRole, requireUserProfile } from "@/lib/auth/session";

export type CreateDispatchOrderState = {
  errors: {
    distributorId?: string;
    estimatedDispatchDate?: string;
    form?: string;
  };
  values: {
    distributorId: string;
    estimatedDispatchDate: string;
    notes: string;
  };
};

const EMPTY_STATE: CreateDispatchOrderState = {
  errors: {},
  values: { distributorId: "", estimatedDispatchDate: "", notes: "" },
};

/** Fecha de hoy en formato YYYY-MM-DD, para comparar contra el input type="date". */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Crea una orden de despacho para la empresa del usuario autenticado.
 *
 * Compatible con useActionState: recibe el estado previo (no se usa acá,
 * pero es parte de la firma que espera el hook) y el FormData del form.
 * La autorización por rol también la exige la policy `orders_insert` en
 * Postgres; el chequeo acá es solo para devolver un mensaje claro en vez
 * de un error crudo de RLS.
 */
export async function createDispatchOrder(
  _prevState: CreateDispatchOrderState,
  formData: FormData,
): Promise<CreateDispatchOrderState> {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    return {
      ...EMPTY_STATE,
      errors: { form: "No tenés permisos para crear órdenes de despacho." },
    };
  }

  const distributorId = String(formData.get("distributorId") ?? "").trim();
  const estimatedDispatchDate = String(
    formData.get("estimatedDispatchDate") ?? "",
  ).trim();
  const notes = String(formData.get("notes") ?? "").trim();

  const values = { distributorId, estimatedDispatchDate, notes };
  const errors: CreateDispatchOrderState["errors"] = {};

  if (!distributorId) {
    errors.distributorId = "Seleccioná un distribuidor de destino.";
  }

  if (!estimatedDispatchDate) {
    errors.estimatedDispatchDate = "Ingresá la fecha estimada de despacho.";
  } else if (estimatedDispatchDate < today()) {
    errors.estimatedDispatchDate =
      "La fecha estimada de despacho no puede ser anterior a hoy.";
  }

  if (Object.keys(errors).length > 0) {
    return { errors, values };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("dispatch_orders").insert({
    company_id: profile.companyId,
    distributor_id: distributorId,
    created_by: profile.id,
    estimated_dispatch_date: estimatedDispatchDate,
    notes: notes || null,
  });

  if (error) {
    return {
      errors: { form: `No se pudo crear la orden (${error.message}).` },
      values,
    };
  }

  revalidatePath("/dashboard");
  redirect("/dashboard?created=1");
}
