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
}: {
  searchParams: Promise<{ qr?: string }>;
}) {
  const profile = await requireUserProfile();

  if (!hasRole(profile, "logistics_manager")) {
    redirect("/dashboard");
  }

  const resolvedSearchParams = await searchParams;
  const qr = resolvedSearchParams?.qr;
  const rawQr = typeof qr === "string" ? qr : "";
  const normalizedQr = rawQr.trim();
  const isTooLong = normalizedQr.length > 512;
  const shouldSearch = normalizedQr.length > 0 && !isTooLong;
  const traceability = shouldSearch
    ? await getPalletTraceability(normalizedQr, profile.companyId)
    : null;

  return (
    <div className="space-y-8">
      {/* Luz ambiental roja difuminada en el fondo */}
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-red-900/20 blur-3xl pointer-events-none" />
      <div className="absolute -right-32 top-1/2 h-96 w-96 rounded-full bg-red-950/15 blur-3xl pointer-events-none" />

      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Consultar trazabilidad
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Buscá un pallet por su código QR.
          </p>
        </div>

        <div>
          <Link
            href="/dashboard"
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:bg-zinc-800 hover:text-white shadow-sm"
          >
            Volver
          </Link>
        </div>
      </div>

      {/* Buscador directo sin contenedor duplicado */}
      <div>
        <TraceabilitySearch defaultQr={rawQr} />
      </div>

      {/* Alertas de errores o validaciones */}
      {isTooLong && (
        <p
          role="alert"
          className="rounded-2xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300 backdrop-blur-md"
        >
          El código QR no puede superar los 512 caracteres.
        </p>
      )}


      {shouldSearch && !traceability && (
        <p
          role="status"
          className="rounded-2xl border border-amber-900/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-300 backdrop-blur-md"
        >
          No se encontró ningún pallet con ese código QR.
        </p>
      )}

      {traceability && <PalletTraceability traceability={traceability} />}
    </div>
  );
}
