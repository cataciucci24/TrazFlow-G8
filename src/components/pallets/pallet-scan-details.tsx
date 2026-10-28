"use client";

import { useEffect, useState } from "react";
import { getPalletScanDetails } from "@/lib/scans/actions";
import { scanActionLabel, scanRoleLabel, type PalletScanResult } from "@/lib/scans/types";

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires",
});

/** Montar con key al cambiar de pallet/operación para descartar respuestas viejas. */
export function PalletScanDetails({ qrCode }: { qrCode: string }) {
  const [result, setResult] = useState<PalletScanResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    getPalletScanDetails(qrCode).then(
      (response) => { if (active) setResult(response); },
      () => { if (active) setResult({ pallet: null, error: "No se pudo consultar la ficha del pallet. Revisá tu conexión." }); },
    );
    return () => { active = false; };
  }, [qrCode, attempt]);

  const pallet = result?.pallet;
  return <section aria-label="Ficha del pallet escaneado" aria-live="polite" aria-busy={!result} className="surface min-w-0 space-y-3 p-4 text-sm">
    <h3 className="break-all font-mono font-semibold">Pallet {qrCode}</h3>
    {!result && <p>Cargando ficha del pallet…</p>}
    {result?.error && <div role="alert" className="space-y-2">
      <p>{result.error}</p>
      <button type="button" className="button-secondary button-sm" onClick={() => { setResult(null); setAttempt((value) => value + 1); }}>Reintentar consulta</button>
    </div>}
    {pallet && <>
      <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-stone-500">Producto</dt><dd className="break-words font-medium">{pallet.product_name} ({pallet.product_sku})</dd></div>
        <div className="min-w-0"><dt className="text-stone-500">Lote</dt><dd className="break-all font-medium">{pallet.batch_number}</dd></div>
        <div><dt className="text-stone-500">Cantidad</dt><dd className="font-medium">{pallet.quantity === null ? "Sin cantidad registrada" : `${Number(pallet.quantity).toLocaleString("es-AR")} ${pallet.unit_of_measure}`}</dd></div>
        <div className="min-w-0"><dt className="text-stone-500">Ubicación actual</dt><dd className="break-words font-medium">{pallet.physical_location || "Sin ubicación"}</dd></div>
      </dl>
      <div className="border-t border-stone-200 pt-3">
        <p className="font-semibold">Última acción</p>
        {pallet.last_event_type ? <div className="mt-1 space-y-1">
          <p>{scanActionLabel(pallet.last_event_type)}</p>
          <p className="break-words">{pallet.actor_name ?? "Persona no disponible"} · {scanRoleLabel(pallet.actor_role)}</p>
          {pallet.last_event_at && <time dateTime={pallet.last_event_at}>{dateFormatter.format(new Date(pallet.last_event_at))}</time>}
        </div> : <p className="mt-1 text-stone-500">Sin movimientos registrados</p>}
      </div>
    </>}
  </section>;
}
