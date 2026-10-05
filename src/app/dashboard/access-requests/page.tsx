import { redirect } from "next/navigation";

// Las solicitudes de acceso pasaron a la pestaña "Solicitudes" de /dashboard/operators.
export default function AccessRequestsPage() {
  redirect("/dashboard/operators?tab=solicitudes");
}
