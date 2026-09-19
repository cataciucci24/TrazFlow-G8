import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StockReportForm } from "@/components/stock-reporting/stock-report-form";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getStockReportingData } from "@/lib/stock-reporting/queries";

export const metadata: Metadata = { title: "Mi stock | TrazFlow" };

const NUMBER_FORMATTER = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

export default async function StockReportPage() {
  const profile = await requireUserProfile();
  if (!hasRole(profile, "distributor_operator")) redirect("/dashboard");

  const data = await getStockReportingData(profile.id, profile.companyId);

  return (
    <div className="space-y-8">
      <div className="border-b border-stone-200 pb-6">
        <p className="text-xs font-bold tracking-[0.12em] text-emerald-700">INVENTARIO DE DISTRIBUCIÓN</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Mi stock</h1>
        <p className="mt-1 text-sm text-stone-500">Mantené actualizado el stock disponible y el consumo diario estimado de cada producto.</p>
      </div>

      {!data.sourceAvailable ? (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-800">La carga de stock estará disponible cuando se aplique la migración correspondiente en Supabase.</div>
      ) : (
        <>
          <StockReportForm distributors={data.distributors} products={data.products} />

          <section aria-labelledby="reported-stock-title" className="space-y-4">
            <div>
              <h2 id="reported-stock-title" className="text-xl font-bold">Información reportada</h2>
              <p className="mt-1 text-sm text-stone-500">El mismo producto puede volver a guardarse para actualizar sus valores.</p>
            </div>
            {data.entries.length === 0 ? (
              <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500">Todavía no informaste stock de productos.</div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-stone-100/80 text-stone-500"><tr><th scope="col" className="px-5 py-4 font-semibold">Producto</th><th scope="col" className="px-5 py-4 font-semibold">Distribuidora</th><th scope="col" className="px-5 py-4 text-right font-semibold">Stock actual</th><th scope="col" className="px-5 py-4 text-right font-semibold">Consumo diario</th><th scope="col" className="px-5 py-4 font-semibold">Actualizado</th></tr></thead>
                  <tbody className="divide-y divide-stone-200">{data.entries.map((entry) => <tr key={entry.id}><td className="px-5 py-4"><p className="font-medium">{entry.productName}</p><p className="mt-0.5 font-mono text-xs text-stone-500">{entry.productSku}</p></td><td className="px-5 py-4">{entry.distributorName}</td><td className="px-5 py-4 text-right font-mono">{NUMBER_FORMATTER.format(entry.currentStock)}</td><td className="px-5 py-4 text-right font-mono">{NUMBER_FORMATTER.format(entry.dailyConsumption)}</td><td className="px-5 py-4 text-stone-500">{DATE_FORMATTER.format(new Date(entry.updatedAt))}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
