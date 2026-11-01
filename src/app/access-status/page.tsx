import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/brand-mark";
import { LogoutButton } from "@/components/logout-button";
import { getAccessRequest, getRequestedCompanyName } from "@/lib/access-requests/queries";
import type { AccessRequest, AccessRequestStatus, RequestedRole } from "@/lib/access-requests/types";
import { canAccessDashboard, hasUnknownRole } from "@/lib/auth/profile";
import { getUserProfile, requireUser } from "@/lib/auth/session";
import { PaymentsTable } from "@/components/account/company-payments";
import { formatPaymentDate, type CompanyPayment } from "@/lib/plans/payments";
import { getCompanyPayments, getSubscriptionAccess } from "@/lib/plans/payments-query";

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
  driver_operator: "Chofer",
};

export default async function AccessStatusPage() {
  // La autenticación no exige una fila en public.users.
  const user = await requireUser();
  let request: AccessRequest | null = null;
  let companyName = "";
  let hasActiveProfile = false;
  let revoked = false;
  let unknownRole = false;
  let endedOn: string | null = null;
  let invoices: { available: boolean; payments: CompanyPayment[] } | null = null;
  let failed = false;
  try {
    const profile = await getUserProfile();
    hasActiveProfile = profile !== null && canAccessDashboard(profile);
    revoked = Boolean(profile?.revokedAt);
    unknownRole = profile !== null && hasUnknownRole(profile);
    if (hasActiveProfile && profile) {
      const access = await getSubscriptionAccess();
      if (access.ended) {
        endedOn = access.accessUntil;
        // Las facturas son el respaldo contable: siguen disponibles sin suscripción.
        if (profile.role === "logistics_manager") invoices = await getCompanyPayments(profile.companyId);
      }
    }
    if (!profile) {
      request = await getAccessRequest(user.id);
      if (request) companyName = await getRequestedCompanyName(request.companyId);
    }
  } catch (error) {
    console.error("Error al cargar el estado de acceso", error);
    failed = true;
  }
  // Aprobado o restaurado: no hay nada que esperar en esta página.
  if (hasActiveProfile && !endedOn) redirect("/dashboard");

  const status = request ? statuses[request.status] : null;
  // Solo tiene sentido volver a consultar mientras la solicitud está pendiente.
  const canRefresh = failed || request?.status === "pending";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-5 py-12 sm:px-8">
      <div className={`w-full space-y-8 ${invoices ? "max-w-4xl" : "max-w-md"}`}>
        <div className="text-center">
          <div className="mb-5 flex justify-center"><BrandLogo /></div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">{endedOn ? "Estado de tu acceso" : "Estado de tu solicitud"}</h1>
          <p className="mt-2 break-words text-sm text-stone-500">{user.email}</p>
        </div>
        <section className="surface space-y-6 p-6 sm:p-8" aria-label="Solicitud de acceso">
          {failed ? (
            <p role="alert" className="feedback feedback-danger">
              No pudimos consultar los datos de tu solicitud. Intentá nuevamente.
            </p>
          ) : endedOn ? (
            <>
              <div className="feedback feedback-warning">
                <h2 className="font-bold">Suscripción finalizada</h2>
                <p className="mt-2 text-sm">La suscripción de tu empresa se canceló y el período pagado terminó el {formatPaymentDate(endedOn)}. Para volver a usar TrazFlow, comunicate con el equipo comercial.</p>
              </div>
              {invoices ? <PaymentsTable available={invoices.available} payments={invoices.payments} /> : null}
            </>
          ) : revoked ? (
            <div className="feedback feedback-danger">
              <h2 className="font-bold">Acceso revocado</h2>
              <p className="mt-2 text-sm">El responsable logístico de tu empresa revocó tu acceso. Si creés que es un error, comunicate con él.</p>
            </div>
          ) : unknownRole ? (
            <div className="feedback feedback-warning">
              <h2 className="font-bold">Tu rol ya no existe</h2>
              <p className="mt-2 text-sm">El rol asignado a tu cuenta ya no existe en TrazFlow. Comunicate con el responsable logístico de tu empresa para que te asigne uno vigente.</p>
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
