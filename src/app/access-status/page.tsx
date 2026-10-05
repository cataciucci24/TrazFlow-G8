import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/brand-mark";
import { LogoutButton } from "@/components/logout-button";
import { getAccessRequest, getRequestedCompanyName } from "@/lib/access-requests/queries";
import type { AccessRequest, AccessRequestStatus, RequestedRole } from "@/lib/access-requests/types";
import { getUserProfile, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Estado de solicitud | TrazFlow" };

const statuses: Record<AccessRequestStatus, { title: string; description: string; style: string }> = {
  pending: {
    title: "Solicitud pendiente",
    description: "Tu solicitud de acceso está pendiente de revisión.",
    style: "feedback-warning",
  },
  approved: {
    title: "Solicitud aprobada",
    description: "Tu solicitud fue aprobada. El acceso al sistema requiere un perfil operativo habilitado.",
    style: "feedback-success",
  },
  rejected: {
    title: "Solicitud rechazada",
    description: "Tu solicitud de acceso fue rechazada.",
    style: "feedback-danger",
  },
};

const roles: Record<RequestedRole, string> = {
  warehouse_operator: "Operador de depósito",
  distributor_operator: "Operador de distribuidor",
};

export default async function AccessStatusPage() {
  // La autenticación no exige una fila en public.users.
  const user = await requireUser();
  let request: AccessRequest | null = null;
  let companyName = "";
  let hasActiveProfile = false;
  let revoked = false;
  let failed = false;
  try {
    const profile = await getUserProfile();
    hasActiveProfile = profile !== null && !profile.revokedAt;
    revoked = Boolean(profile?.revokedAt);
    if (!profile) {
      request = await getAccessRequest(user.id);
      if (request) companyName = await getRequestedCompanyName(request.companyId);
    }
  } catch (error) {
    console.error("Error al cargar el estado de acceso", error);
    failed = true;
  }
  // Aprobado o restaurado: no hay nada que esperar en esta página.
  if (hasActiveProfile) redirect("/dashboard");

  const status = request ? statuses[request.status] : null;
  // Solo tiene sentido volver a consultar mientras la solicitud está pendiente.
  const canRefresh = failed || request?.status === "pending";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-5 py-12 sm:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mb-5 flex justify-center"><BrandLogo /></div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Estado de tu solicitud</h1>
          <p className="mt-2 break-words text-sm text-stone-500">{user.email}</p>
        </div>
        <section className="surface space-y-6 p-6 sm:p-8" aria-label="Solicitud de acceso">
          {failed ? (
            <p role="alert" className="feedback feedback-danger">
              No pudimos consultar los datos de tu solicitud. Intentá nuevamente.
            </p>
          ) : revoked ? (
            <div className="feedback feedback-danger">
              <h2 className="font-bold">Acceso revocado</h2>
              <p className="mt-2 text-sm">El responsable logístico de tu empresa revocó tu acceso. Si creés que es un error, comunicate con él.</p>
            </div>
          ) : request && status ? (
            <>
              <div className={`feedback ${status.style}`}>
                <h2 className="font-bold">{status.title}</h2>
                <p className="mt-2 text-sm">{status.description}</p>
              </div>
              <dl className="space-y-4 text-sm">
                <div><dt className="text-stone-500">Empresa solicitada</dt><dd className="mt-1 break-words font-semibold text-slate-950">{companyName}</dd></div>
                <div><dt className="text-stone-500">Rol solicitado</dt><dd className="mt-1 font-semibold text-slate-950">{roles[request.requestedRole]}</dd></div>
                <div><dt className="text-stone-500">Fecha de solicitud</dt><dd className="mt-1 font-semibold text-slate-950"><time dateTime={request.createdAt}>{new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(request.createdAt))}</time></dd></div>
              </dl>
            </>
          ) : (
            <p className="text-sm text-stone-600">No encontramos una solicitud de acceso asociada a tu cuenta.</p>
          )}
          <div className="flex flex-wrap gap-3">
            {canRefresh && <a href="/access-status" className="button-secondary">Actualizar estado</a>}
            <LogoutButton />
          </div>
        </section>
      </div>
    </main>
  );
}
