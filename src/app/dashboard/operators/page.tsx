import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader, TableShell } from "@/components/ui/design-system";
import { ApproveAccessRequest } from "@/components/approve-access-request";
import { RejectAccessRequest } from "@/components/reject-access-request";
import { OperatorAccessAction } from "@/components/operators/operator-access-action";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getPendingAccessRequests } from "@/lib/pending-access-requests/queries";
import type { PendingAccessRequest } from "@/lib/pending-access-requests/types";
import { getCompanyOperators } from "@/lib/operators/queries";
import type { CompanyOperator } from "@/lib/operators/types";
import { requestedRoles } from "@/lib/registration/options";

export const metadata: Metadata = { title: "Operadores | TrazFlow" };
const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires",
});

type Tab = "solicitudes" | "operadores";

const doneMessages: Record<string, string> = {
  approved: "Solicitud aprobada. El perfil operativo fue creado. Si es operador de distribuidor, vinculalo en la pestaña Operadores.",
  rejected: "Solicitud rechazada.",
  assigned: "Distribuidor asignado.",
  revoked: "Acceso revocado. El historial del operador se conserva.",
  restored: "Acceso restaurado.",
};

export default async function OperatorsPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; done?: string }>;
}) {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");
  const { tab: tabParam, done } = await searchParams;
  const tab: Tab = tabParam === "operadores" ? "operadores" : "solicitudes";

  let requests: PendingAccessRequest[] = [];
  let operators: CompanyOperator[] = [];
  let failed = false;
  try {
    [requests, operators] = await Promise.all([
      getPendingAccessRequests(),
      getCompanyOperators(),
    ]);
  } catch (error) {
    console.error("Error consultando operadores y solicitudes", error);
    failed = true;
  }

  const assignedDeliveries = operators.reduce((total, operator) => total + operator.inTransitOrders, 0);
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "solicitudes", label: "Solicitudes", count: requests.length },
    { id: "operadores", label: "Operadores", count: assignedDeliveries },
  ];

  return (
    <div className="app-page">
      <PageHeader title="Operadores" description="Solicitudes de acceso y operadores de tu empresa."
        action={<a href={`/dashboard/operators?tab=${tab}`} className="button-secondary">Actualizar</a>} />

      <nav className="flex gap-2 border-b border-stone-200" aria-label="Secciones de operadores">
        {tabs.map((item) => (
          <Link key={item.id} href={`/dashboard/operators?tab=${item.id}`} aria-current={tab === item.id ? "page" : undefined}
            className={`-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold ${tab === item.id ? "border-[var(--brand)] text-[var(--brand-hover)]" : "border-transparent text-stone-500 hover:text-stone-800"}`}>
            {item.label}
            {item.count > 0 && <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand-hover)]">{item.count}</span>}
          </Link>
        ))}
      </nav>

      {done && doneMessages[done] && <p role="status" className="feedback feedback-success">{doneMessages[done]}</p>}

      {failed ? (
        <p role="alert" className="feedback feedback-danger">No pudimos consultar los operadores. Intentá nuevamente.</p>
      ) : tab === "solicitudes" ? (
        requests.length === 0 ? (
          <div className="surface"><EmptyState title="No hay solicitudes pendientes" description="Las nuevas solicitudes de acceso a tu empresa aparecerán aquí." /></div>
        ) : (
          <TableShell label="Solicitudes de acceso pendientes">
            <table className="data-table min-w-[720px]">
              <thead><tr><th scope="col">Email</th><th scope="col">Rol solicitado</th><th scope="col">Fecha de solicitud</th><th scope="col">Acciones</th></tr></thead>
              <tbody className="divide-y divide-stone-200">{requests.map((request) => (
                <tr key={request.requestId}>
                  <td className="break-all">{request.email ?? "Email no disponible"}</td>
                  <td>{requestedRoles[request.requestedRole]}</td>
                  <td><time dateTime={request.createdAt}>{dateFormatter.format(new Date(request.createdAt))}</time></td>
                  <td>
                    <div className="flex flex-wrap items-start gap-2">
                      <ApproveAccessRequest requestId={request.requestId} email={request.email} company={request.companyName} role={requestedRoles[request.requestedRole]} />
                      <RejectAccessRequest requestId={request.requestId} email={request.email} />
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </TableShell>
        )
      ) : operators.length === 0 ? (
        <div className="surface"><EmptyState title="Todavía no hay operadores" description="Los operadores aparecen acá cuando aprobás su solicitud de acceso." /></div>
      ) : (
        <TableShell label="Operadores de la empresa">
          <table className="data-table min-w-[960px]">
            <thead><tr><th scope="col">Operador</th><th scope="col">Rol</th><th scope="col">Entregas en tránsito</th><th scope="col">Acceso</th><th scope="col" className="text-center">Estado</th></tr></thead>
            <tbody className="divide-y divide-stone-200">{operators.map((operator) => (
              <tr key={operator.userId}>
                <td>
                  <p className="font-semibold">{operator.name}</p>
                  <p className="break-all text-sm text-stone-500">{operator.email}</p>
                </td>
                <td>{requestedRoles[operator.role]}</td>
                <td>{operator.role === "driver_operator" ? operator.inTransitOrders : <span className="text-stone-400">—</span>}</td>
                <td>
                  <OperatorAccessAction operator={operator} />
                </td>
                <td className="text-center">
                  <AccessStatusIcon revoked={operator.revokedAt !== null} />
                </td>
              </tr>
            ))}</tbody>
          </table>
        </TableShell>
      )}
    </div>
  );
}

/** Estado de acceso como círculo: verde con tilde (activo) o rojo con cruz (revocado). */
function AccessStatusIcon({ revoked }: { revoked: boolean }) {
  const label = revoked ? "Acceso revocado" : "Acceso activo";
  return (
    <span role="img" aria-label={label} title={label}
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-white ${revoked ? "bg-red-600" : "bg-emerald-600"}`}>
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {revoked ? <path d="m6 6 8 8M14 6l-8 8" /> : <path d="m5 10.5 3.25 3.25L15 7" />}
      </svg>
    </span>
  );
}
