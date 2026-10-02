import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader, TableShell } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getPendingAccessRequests } from "@/lib/pending-access-requests/queries";
import type { PendingAccessRequest } from "@/lib/pending-access-requests/types";
import { requestedRoles } from "@/lib/registration/options";

export const metadata: Metadata = { title: "Solicitudes de acceso | TrazFlow" };
const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires",
});

export default async function AccessRequestsPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "logistics_manager")) redirect("/dashboard");

  let requests: PendingAccessRequest[] = [];
  let failed = false;
  try {
    requests = await getPendingAccessRequests();
  } catch (error) {
    console.error("Error consultando solicitudes pendientes", error);
    failed = true;
  }

  return (
    <div className="app-page">
      <PageHeader title="Solicitudes de acceso" description="Solicitudes pendientes de tu empresa, ordenadas por fecha de solicitud."
        action={<a href="/dashboard/access-requests" className="button-secondary">Actualizar</a>} />
      {failed ? (
        <p role="alert" className="feedback feedback-danger">No pudimos consultar las solicitudes pendientes. Intentá nuevamente.</p>
      ) : requests.length === 0 ? (
        <div className="surface"><EmptyState title="No hay solicitudes pendientes" description="Las nuevas solicitudes de acceso a tu empresa aparecerán aquí." /></div>
      ) : (
        <TableShell label="Solicitudes de acceso pendientes">
          <table className="data-table min-w-[720px]">
            <thead><tr><th scope="col">Email</th><th scope="col">Empresa</th><th scope="col">Rol solicitado</th><th scope="col">Fecha de solicitud</th></tr></thead>
            <tbody className="divide-y divide-stone-200">{requests.map((request) => (
              <tr key={request.requestId}>
                <td className="break-all">{request.email ?? "Email no disponible"}</td>
                <td>{request.companyName}</td>
                <td>{requestedRoles[request.requestedRole]}</td>
                <td><time dateTime={request.createdAt}>{dateFormatter.format(new Date(request.createdAt))}</time></td>
              </tr>
            ))}</tbody>
          </table>
        </TableShell>
      )}
    </div>
  );
}
