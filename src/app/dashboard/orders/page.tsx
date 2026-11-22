import type { Metadata } from "next";
import Link from "next/link";
import { requireUserProfile, hasRole } from "@/lib/auth/session";
import { ErpOriginCell } from "@/components/erp/erp-origin";
import { ErpSyncPanel } from "@/components/erp/erp-sync-panel";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { getLatestErpSyncRun } from "@/lib/erp-sync/queries";
import { canCreateManualOrders, ERP_ORDERS_NOTICE } from "@/lib/orders/erp-policy";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, InlineAlert, OrderStatusBadge, PageHeader, TableShell } from "@/components/ui/design-system";
import type { OrderStatus } from "@/lib/types";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
import { applyOrderFilters, readOrderFilters, type OrderSearchParams } from "@/lib/orders/filters";

export const metadata: Metadata = {
  title: "Órdenes de despacho | TrazFlow",
};

export default async function OrdersPage({ searchParams }: { searchParams: Promise<OrderSearchParams> }) {
  const profile = await requireUserProfile();
  const supabase = await createClient();

  const isLogisticsManager = hasRole(profile, "logistics_manager");
  const erpEnabled = await isErpEnabled(profile.companyId);
  const showErpSync = isLogisticsManager && erpEnabled;
  // Con ERP, las órdenes solo entran por la sincronización (TRZ-102).
  const canCreateOrders = isLogisticsManager && canCreateManualOrders(erpEnabled);
  const lastRun = showErpSync ? await getLatestErpSyncRun(profile.companyId) : null;

  const filters = readOrderFilters(await searchParams);
  const filtered = Boolean(filters.status || filters.distributor);
  const { data: distributors, error: distributorsError } = await supabase.from("distributors")
    .select("id, name").eq("company_id", profile.companyId).order("name");
  if (distributorsError) throw new Error("No se pudieron cargar las distribuidoras.");

  const query = supabase
    .from("dispatch_orders")
    .select("id, status, estimated_dispatch_date, created_at, notes, source_system, external_id, synced_at, distributors ( name )")
    .eq("company_id", profile.companyId);
  const { data: orders, error } = await applyOrderFilters(query, filters).order("created_at", { ascending: false });

  if (error) {
    throw new Error(`No se pudieron cargar las órdenes: ${error.message}`);
  }

  return (
    <div className="app-page">
      <PageHeader
        title="Órdenes de despacho"
        description="Gestioná y consultá el estado de los envíos a cada distribuidora."
        action={canCreateOrders ? (
          <Link
            href="/dashboard/orders/new"
            className="button-primary gap-2"
          >
            <span aria-hidden="true" className="text-lg leading-none">+</span>Nueva orden
          </Link>
        ) : undefined}
      />

      {isLogisticsManager && erpEnabled ? <InlineAlert announce={false}>{ERP_ORDERS_NOTICE}</InlineAlert> : null}

      {showErpSync ? <ErpSyncPanel lastRun={lastRun} /> : null}

      <form key={`${filters.status}:${filters.distributor}`} method="get" action="/dashboard/orders" className="surface flex flex-wrap items-end gap-4 p-4" aria-label="Filtrar órdenes">
        <label className="flex flex-col gap-1">Estado
          <select name="status" defaultValue={filters.status} className="form-control">
            <option value="">Todos los estados</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">Distribuidora
          <select name="distributor" defaultValue={filters.distributor} className="form-control">
            <option value="">Todas las distribuidoras</option>
            {(distributors ?? []).map(distributor => <option key={distributor.id} value={distributor.id}>{distributor.name}</option>)}
            {filters.distributor && !distributors?.some(distributor => distributor.id === filters.distributor)
              ? <option value={filters.distributor}>Distribuidora no disponible</option> : null}
          </select>
        </label>
        <button type="submit" className="button-primary">Aplicar filtros</button>
        {filtered ? <Link href="/dashboard/orders" className="button-secondary">Limpiar filtros</Link> : null}
      </form>

      {!orders || orders.length === 0 ? <div className="surface"><EmptyState title={filtered ? "No hay órdenes con estos filtros" : "Todavía no hay órdenes"}
        description={filtered ? "Probá otro estado o distribuidora, o limpiá los filtros." : "Los envíos registrados para tu empresa aparecerán acá."}
        action={filtered ? <Link href="/dashboard/orders" className="button-secondary">Limpiar filtros</Link> : canCreateOrders ? <Link href="/dashboard/orders/new" className="button-primary">Nueva orden</Link> : undefined}
      /></div> : <TableShell label="Órdenes de despacho registradas" mobileLayout="rows">
          <table role="table" aria-label="Órdenes de despacho registradas" className="data-table min-w-[900px]">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Código</th><th role="columnheader" scope="col">Distribuidora</th><th role="columnheader" scope="col">Fecha despacho</th><th role="columnheader" scope="col">Estado</th><th role="columnheader" scope="col">Origen</th><th role="columnheader" scope="col">Observaciones</th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="divide-y divide-stone-200">
              {orders.map((order) => {
                const distributor = Array.isArray(order.distributors)
                  ? order.distributors[0]
                  : order.distributors;

                return (
                  <tr role="row" key={order.id}>
                    <td role="cell" data-label="Código" className="mobile-primary font-mono font-bold text-slate-950">
                      <Link href={`/dashboard/orders/${order.id}`} title={order.id} className="button-secondary">{order.id.slice(0, 8).toUpperCase()}</Link>
                    </td>
                    <td role="cell" data-label="Distribuidora" className="font-medium text-slate-950">
                      {distributor?.name ?? "—"}
                    </td>
                    <td role="cell" data-label="Fecha despacho" className="mobile-priority text-slate-600">
                      {order.estimated_dispatch_date ? new Date(`${order.estimated_dispatch_date}T00:00:00`).toLocaleDateString("es-AR") : "—"}
                    </td>
                    <td role="cell" data-label="Estado" className="mobile-priority">
                      <OrderStatusBadge status={order.status as OrderStatus} />
                    </td>
                    <td role="cell" data-label="Origen" className="mobile-wide">
                      <ErpOriginCell origin={{ sourceSystem: order.source_system, externalId: order.external_id, syncedAt: order.synced_at }} />
                    </td>
                    <td role="cell" data-label="Observaciones" className="mobile-wide max-w-72 text-slate-500">
                      {order.notes ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
      </TableShell>}
    </div>
  );
}
