import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DispatchNoteView } from "@/components/dispatch-notes/dispatch-note-view";
import { PrintDispatchNoteButton } from "@/components/dispatch-notes/dispatch-note-qr";
import { EmptyState, PageHeader } from "@/components/ui/design-system";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getDispatchNote } from "@/lib/dispatch-notes/queries";

export const metadata: Metadata = { title: "Remito | TrazFlow" };

/** TRZ-51: remito digital de una orden despachada. */
export default async function DispatchNotePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireUserProfile();
  // TRZ-52: el chofer ve el remito de sus órdenes (la base solo le devuelve esas).
  if (!hasRole(profile, "logistics_manager", "warehouse_operator", "driver_operator")) redirect("/dashboard");
  const isDriver = profile.role === "driver_operator";
  const { id } = await params;
  const note = await getDispatchNote(id, profile.companyId);

  return (
    <div className="app-page">
      <PageHeader
        title="Remito digital"
        description="Constancia de lo despachado en esta orden."
        action={<div className="no-print flex flex-wrap gap-2">
          {note && <PrintDispatchNoteButton />}
          <Link href={isDriver ? `/dashboard/deliveries/${id}` : `/dashboard/orders/${id}`} className="button-secondary">{isDriver ? "Ir a confirmar la entrega" : "Volver a la orden"}</Link>
        </div>}
      />
      {note ? <DispatchNoteView note={note} /> : (
        <div className="surface">
          <EmptyState title="Esta orden todavía no tiene remito" description={isDriver ? "El remito aparece cuando depósito confirma el despacho de una orden asignada a vos." : "El remito se genera solo cuando depósito confirma el despacho."} />
        </div>
      )}
    </div>
  );
}
