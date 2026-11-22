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
  if (!hasRole(profile, "logistics_manager", "warehouse_operator")) redirect("/dashboard");
  const { id } = await params;
  const note = await getDispatchNote(id, profile.companyId);

  return (
    <div className="app-page">
      <PageHeader
        title="Remito digital"
        description="Constancia de lo despachado en esta orden."
        action={<div className="no-print flex flex-wrap gap-2">
          {note && <PrintDispatchNoteButton />}
          <Link href={`/dashboard/orders/${id}`} className="button-secondary">Volver a la orden</Link>
        </div>}
      />
      {note ? <DispatchNoteView note={note} /> : (
        <div className="surface">
          <EmptyState title="Esta orden todavía no tiene remito" description="El remito se genera solo cuando depósito confirma el despacho." />
        </div>
      )}
    </div>
  );
}
