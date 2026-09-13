"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasRole, requireUserProfile } from "@/lib/auth/session";

export type CreateDispatchOrderState = {
  errors: {
    distributorId?: string;
    estimatedDispatchDate?: string;
    palletIds?: string;
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
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
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
  const palletIds = formData.getAll("palletIds").map(String).filter(Boolean);

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
  if (palletIds.length === 0) {
    errors.palletIds = "Seleccioná al menos un pallet para la orden.";
  }

  if (Object.keys(errors).length > 0) {
    return { errors, values };
  }

  const supabase = await createClient();
  const { data: createdOrder, error } = await supabase.from("dispatch_orders").insert({
    company_id: profile.companyId,
    distributor_id: distributorId,
    created_by: profile.id,
    estimated_dispatch_date: estimatedDispatchDate,
    notes: notes || null,
  }).select("id").single();

  if (error) {
    return {
      errors: { form: `No se pudo crear la orden (${error.message}).` },
      values,
    };
  }

  const { data: reserved, error: reserveError } = await supabase
    .from("pallets")
    .update({ status: "assigned" })
    .in("id", palletIds)
    .eq("company_id", profile.companyId)
    .eq("status", "in_warehouse")
    .select("id");
  const reservedIds = (reserved ?? []).map((pallet) => pallet.id as string);
  if (reserveError || reservedIds.length !== palletIds.length) {
    await supabase.from("dispatch_orders").delete().eq("id", createdOrder.id);
    return { errors: { form: "Uno o más pallets ya no están disponibles. Actualizá e intentá nuevamente." }, values };
  }

  const { error: associationError } = await supabase.from("order_pallets").insert(
    reservedIds.map((palletId) => ({ order_id: createdOrder.id, pallet_id: palletId, expected: true })),
  );
  if (associationError) {
    await supabase.from("pallets").update({ status: "in_warehouse" }).in("id", reservedIds);
    await supabase.from("dispatch_orders").delete().eq("id", createdOrder.id);
    return { errors: { form: "No se pudieron asociar los pallets seleccionados." }, values };
  }

  await supabase.from("traceability_events").insert(reservedIds.map((palletId) => ({
    company_id: profile.companyId, pallet_id: palletId, order_id: createdOrder.id, event_type: "pallet_associated", user_id: profile.id,
  })));

  revalidatePath("/dashboard");
  redirect("/dashboard?created=1");
}

export type AssociatePalletsState = {
  error: string | null;
  success: string | null;
};

/**
 * Asocia uno o más pallets (en depósito) a una orden de despacho en estado
 * 'draft'. Pensada para bindearse con el orderId en el cliente:
 * `associatePallets.bind(null, orderId)`, y usarse con useActionState.
 *
 * La reserva de pallets (UPDATE ... WHERE status = 'in_warehouse') es la
 * defensa contra la condición de carrera de que otro usuario haya asociado
 * el mismo pallet a otra orden entre que se listó la pantalla y se envió
 * este form: solo se insertan en order_pallets y se registra el evento para
 * los pallets que efectivamente se pudieron reservar.
 */
export async function associatePallets(
  orderId: string,
  _prevState: AssociatePalletsState,
  formData: FormData,
): Promise<AssociatePalletsState> {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    return { error: "No tenés permisos para asociar pallets a esta orden.", success: null };
  }

  const palletIds = formData.getAll("palletIds").map(String).filter(Boolean);
  if (palletIds.length === 0) {
    return { error: "Seleccioná al menos un pallet para asociar.", success: null };
  }

  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("dispatch_orders")
    .select("id, company_id, status")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    return { error: `No se pudo leer la orden (${orderError.message}).`, success: null };
  }

  if (!order || order.company_id !== profile.companyId) {
    return { error: "La orden no existe o no pertenece a tu empresa.", success: null };
  }

  if (order.status !== "draft") {
    return {
      error: "La orden ya no admite asociar pallets (no está en estado Pendiente).",
      success: null,
    };
  }

  const { data: reserved, error: reserveError } = await supabase
    .from("pallets")
    .update({ status: "assigned" })
    .in("id", palletIds)
    .eq("company_id", profile.companyId)
    .eq("status", "in_warehouse")
    .select("id");

  if (reserveError) {
    return { error: `No se pudieron reservar los pallets (${reserveError.message}).`, success: null };
  }

  const reservedIds = (reserved ?? []).map((pallet) => pallet.id as string);

  if (reservedIds.length === 0) {
    return { error: "Los pallets seleccionados ya no están disponibles.", success: null };
  }

  const { error: linkError } = await supabase.from("order_pallets").insert(
    reservedIds.map((palletId) => ({
      order_id: orderId,
      pallet_id: palletId,
      expected: true,
    })),
  );

  if (linkError) {
    return {
      error: `No se pudo asociar los pallets a la orden (${linkError.message}).`,
      success: null,
    };
  }

  const { error: eventsError } = await supabase.from("traceability_events").insert(
    reservedIds.map((palletId) => ({
      company_id: profile.companyId,
      pallet_id: palletId,
      order_id: orderId,
      event_type: "pallet_associated",
      user_id: profile.id,
    })),
  );

  revalidatePath(`/dashboard/orders/${orderId}`);

  if (eventsError) {
    // No revertimos la asociación: el evento es auditoría, no la fuente de verdad.
    return {
      error: `Los pallets se asociaron, pero no se pudo registrar el evento de trazabilidad (${eventsError.message}).`,
      success: null,
    };
  }

  const partial = reservedIds.length < palletIds.length;

  return {
    error: null,
    success: partial
      ? `Se asociaron ${reservedIds.length} de ${palletIds.length} pallets seleccionados; el resto ya no estaba disponible.`
      : `Se asociaron ${reservedIds.length} pallet(s) a la orden.`,
  };
}

export type ConfirmDispatchOutcome =
  | "confirmed"
  | "order_not_found"
  | "invalid_status"
  | "no_pallets"
  | "missing_pallets"
  | "forbidden"
  | "error";

export type ConfirmDispatchResult = {
  outcome: ConfirmDispatchOutcome;
  message: string;
};

type ConfirmDispatchRpcRow = {
  outcome: ConfirmDispatchOutcome;
  order_id: string | null;
  status: string | null;
  confirmed_at: string | null;
  pallet_count: number | null;
};

const CONFIRM_MESSAGES: Record<ConfirmDispatchOutcome, string> = {
  confirmed: "Despacho confirmado. La mercadería quedó en tránsito.",
  order_not_found: "La orden no existe o no pertenece a tu empresa.",
  invalid_status: "La orden ya fue confirmada (o no admite confirmarse en su estado actual).",
  no_pallets: "La orden no tiene pallets asociados.",
  missing_pallets: "Todavía hay pallets esperados sin validar.",
  forbidden: "No tenés permisos para confirmar despachos.",
  error: "No se pudo confirmar el despacho. Intentá nuevamente.",
};

/**
 * Confirma una orden de despacho una vez validada la carga (US5). La
 * transición 'draft' -> 'confirmed', el pase de los pallets a in_transit y el
 * evento dispatch_confirmed se resuelven atómicamente en el RPC
 * `confirm_dispatch_order`.
 */
export async function confirmDispatchOrder(
  orderId: string,
): Promise<ConfirmDispatchResult> {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "warehouse_operator")) {
    return { outcome: "forbidden", message: CONFIRM_MESSAGES.forbidden };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_dispatch_order", {
    p_order_id: orderId,
  });

  if (error) {
    return { outcome: "error", message: CONFIRM_MESSAGES.error };
  }

  const row = (data?.[0] ?? null) as ConfirmDispatchRpcRow | null;
  if (!row) {
    return { outcome: "error", message: CONFIRM_MESSAGES.error };
  }

  if (row.outcome === "confirmed") {
    revalidatePath(`/dashboard/orders/${orderId}`);
    revalidatePath("/dashboard");
  }

  return {
    outcome: row.outcome,
    message: CONFIRM_MESSAGES[row.outcome] ?? CONFIRM_MESSAGES.error,
  };
}

export type DissociatePalletOutcome =
  | "dissociated"
  | "order_not_found"
  | "not_removable"
  | "pallet_not_in_order"
  | "forbidden"
  | "error";

export type DissociatePalletResult = {
  outcome: DissociatePalletOutcome;
  message: string;
};

type DissociatePalletRpcRow = {
  outcome: DissociatePalletOutcome;
  order_id: string | null;
  pallet_id: string | null;
};

const DISSOCIATE_MESSAGES: Record<DissociatePalletOutcome, string> = {
  dissociated: "Pallet desasociado de la orden.",
  order_not_found: "La orden no existe o no pertenece a tu empresa.",
  not_removable:
    "El pallet ya no se puede quitar (la orden ya no está en borrador, o el pallet ya fue validado).",
  pallet_not_in_order: "El pallet no está asociado a esta orden.",
  forbidden: "No tenés permisos para desasociar pallets de esta orden.",
  error: "No se pudo desasociar el pallet. Intentá nuevamente.",
};

/**
 * Desasocia un pallet de una orden de despacho en estado 'draft' (extensión
 * de US2). Solo se permite si todavía no fue validado por US3: la
 * verificación y la reversión del status del pallet a 'in_warehouse' se
 * resuelven atómicamente en el RPC `dissociate_pallet_from_order`.
 */
export async function dissociatePallet(
  orderId: string,
  palletId: string,
): Promise<DissociatePalletResult> {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    return { outcome: "forbidden", message: DISSOCIATE_MESSAGES.forbidden };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dissociate_pallet_from_order", {
    p_order_id: orderId,
    p_pallet_id: palletId,
  });

  if (error) {
    return { outcome: "error", message: DISSOCIATE_MESSAGES.error };
  }

  const row = (data?.[0] ?? null) as DissociatePalletRpcRow | null;
  if (!row) {
    return { outcome: "error", message: DISSOCIATE_MESSAGES.error };
  }

  if (row.outcome === "dissociated") {
    revalidatePath(`/dashboard/orders/${orderId}`);
  }

  return {
    outcome: row.outcome,
    message: DISSOCIATE_MESSAGES[row.outcome] ?? DISSOCIATE_MESSAGES.error,
  };
}
