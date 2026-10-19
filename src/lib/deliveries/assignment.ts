"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function assignDriverToOrder(formData: FormData): Promise<void> {
  const profile = await requireUserProfile();
  const orderId = String(formData.get("orderId") ?? "");
  const driverId = String(formData.get("driverId") ?? "");
  if (!hasRole(profile, "logistics_manager") || !UUID.test(orderId) || !UUID.test(driverId)) {
    redirect(`/dashboard/orders/${orderId}?driver=error`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_order_driver", {
    p_order_id: orderId,
    p_driver_id: driverId,
  });
  if (error) {
    console.error("Error asignando chofer", { code: error.code });
    redirect(`/dashboard/orders/${orderId}?driver=error`);
  }
  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/deliveries");
  redirect(`/dashboard/orders/${orderId}?driver=assigned`);
}
