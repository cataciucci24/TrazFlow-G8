"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUserProfile, requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isRequestedRole } from "./options";
import { getRegistrationCompanies, hasRegistrationRequest } from "./queries";
import { normalizeName } from "./name";

export async function completeRegistration(formData: FormData) {
  const user = await requireUser();
  if (await getUserProfile()) redirect("/dashboard");
  const existing = await hasRegistrationRequest(user.id);
  // La recuperación solo completa nombres faltantes; no es edición de perfil.
  if (existing && normalizeName(user.user_metadata.name)) redirect("/dashboard");
  const name = normalizeName(formData.get("name"));
  if (!name) redirect("/complete-registration?error=invalid-selection");

  let destination = "/dashboard";
  try {
    const supabaseAuth = await createClient();
    const { error: nameError } = await supabaseAuth.auth.updateUser({ data: { name } });
    if (nameError) throw new Error("No se pudo guardar el nombre.", { cause: nameError });
    if (!existing) {
      const companyId = String(formData.get("companyId") ?? "");
      const role = String(formData.get("role") ?? "");
      const companies = await getRegistrationCompanies();
      if (!isRequestedRole(role) || !companies.some((company) => company.id === companyId)) {
        destination = "/complete-registration?error=invalid-selection";
      } else {
        const supabase = await createClient();
        const { error } = await supabase.from("access_requests").insert({
          user_id: user.id,
          company_id: companyId,
          requested_role: role,
        });
        // Dos envíos simultáneos pueden pasar la lectura previa. Nunca actualizar
        // la solicitud existente (incluidas las aprobadas o rechazadas).
        if (error && !(error.code === "23505" && await hasRegistrationRequest(user.id))) {
          console.error("Error creando solicitud de acceso", { code: error.code, message: error.message });
          destination = "/complete-registration?error=request-failed";
        }
      }
    }
  } catch (error) {
    console.error("Error al completar el registro", error);
    destination = "/complete-registration?error=request-failed";
  }
  revalidatePath("/", "layout");
  redirect(destination);
}
