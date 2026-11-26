"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUserProfile, requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isRequestedRole } from "./options";
import { getRegistrationCompanies, hasRegistrationRequest } from "./queries";
import { normalizeName } from "./name";
import { companyErrorFromRpc, normalizeCompanyName, type CompanyError } from "./company";
import { normalizeCuit } from "./cuit";
import { getSignupPlans } from "./signup-plans";

/**
 * TRZ-112: alta de empresa. Todavía no hay perfil, así que no puede empezar con requireUserProfile():
 * exige sesión y que no haya perfil, y la RPC vuelve a verificar todo (email confirmado, sin perfil, sin
 * solicitud pendiente, CUIT y plan) y crea empresa, logistics_manager, plan y DEP-01 en una sola transacción.
 */
export async function createCompanyRegistration(formData: FormData) {
  const user = await requireUser();
  if (await getUserProfile()) redirect("/dashboard");

  let error: CompanyError | null;
  try {
    error = await submitCompany(user.id, formData);
  } catch (cause) {
    console.error("Error al dar de alta la empresa", cause);
    error = "company-failed";
  }
  revalidatePath("/", "layout");
  redirect(error ? `/complete-registration?mode=new&error=${error}` : "/dashboard");
}

async function submitCompany(userId: string, formData: FormData): Promise<CompanyError | null> {
  const rawCompanyName = formData.get("companyName");
  const rawTaxId = formData.get("taxId");
  const name = normalizeName(formData.get("name"));
  const companyName = normalizeCompanyName(rawCompanyName);
  const taxId = normalizeCuit(rawTaxId);
  const planCode = String(formData.get("planCode") ?? "");

  const supabase = await createClient();
  // Lo ingresado queda en la metadata (no da acceso a nada) para no perderlo si algo falla.
  // La RPC toma de ahí el nombre de la persona, como approve_access_request.
  const { error: metadataError } = await supabase.auth.updateUser({ data: {
    ...(name ? { name } : {}),
    registration_mode: "new",
    company_name: typeof rawCompanyName === "string" ? rawCompanyName.slice(0, 200) : "",
    company_tax_id: typeof rawTaxId === "string" ? rawTaxId.slice(0, 20) : "",
    plan_code: planCode.slice(0, 40),
  } });
  if (metadataError) throw new Error("No se pudieron guardar los datos del alta.", { cause: metadataError });

  if (!name) return "invalid-name";
  if (!companyName) return "invalid-company-name";
  if (!taxId) return "invalid-cuit";
  if (!(await getSignupPlans()).some((plan) => plan.code === planCode)) return "invalid-plan";

  const { error } = await supabase.rpc("create_company_with_manager", {
    p_company_name: companyName, p_tax_id: taxId, p_plan_code: planCode,
  });
  // P4104: ya tiene perfil (por ejemplo, un doble envío que ya creó la empresa): el dashboard decide.
  if (!error || error.code === "P4104") return null;
  console.error("Error dando de alta la empresa", { code: error.code, user: userId });
  return companyErrorFromRpc(error.code);
}

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
