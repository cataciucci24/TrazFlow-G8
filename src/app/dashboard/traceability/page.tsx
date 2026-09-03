import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PalletTraceability } from "@/components/traceability/pallet-traceability";
import { TraceabilitySearch } from "@/components/traceability/traceability-search";
import { hasRole, requireUserProfile } from "@/lib/auth/session";
import { getPalletTraceability } from "@/lib/traceability/queries";

export const metadata: Metadata = {
  title: "Consultar trazabilidad | TrazFlow",
};

export default async function TraceabilityPage({
  searchParams,
}: PageProps<"/dashboard/traceability">) {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    redirect("/dashboard");
  }

  const { qr } = await searchParams;
  const rawQr = typeof qr === "string" ? qr : "";
  const normalizedQr = rawQr.trim();
  const isTooLong = normalizedQr.length > 512;
  const shouldSearch = normalizedQr.length > 0 && !isTooLong;
  const traceability = shouldSearch
    ? await getPalletTraceability(normalizedQr, profile.companyId)
    : null;

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Consultar trazabilidad
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Buscá un pallet por su código QR.
          </p>
        </div>

        <Link
          href="/dashboard"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
        >
          Volver
        </Link>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <TraceabilitySearch defaultQr={rawQr} />
      </div>

      {isTooLong && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          El código QR no puede superar los 512 caracteres.
        </p>
      )}

      {shouldSearch && !traceability && (
        <p
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          No se encontró ningún pallet con ese código QR.
        </p>
      )}

      {traceability && <PalletTraceability traceability={traceability} />}
    </section>
  );
}
