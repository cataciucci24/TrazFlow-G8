"use client";
import Link from "next/link";
import { useActionState, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/pallet-validation/qr-scanner";
import { InlineAlert, SectionHeader, TableShell } from "@/components/ui/design-system";
import { createLocation, assignLocation } from "@/lib/locations/actions";
import { canLocatePallet, findScannedLocation } from "@/lib/locations/rules";
import type { LocationActionState, WarehouseLocation } from "@/lib/locations/types";
import type { Pallet } from "@/lib/types";
import { LocationQr } from "./location-qr";

const initial: LocationActionState = { error: null, success: null };
function Result({ state }: { state: LocationActionState }) {
  return <>{state.error && <InlineAlert variant="danger">{state.error}</InlineAlert>}{state.success && <p role="status" className="text-sm text-green-700">{state.success}</p>}</>;
}
export function LocationsPanel({ locations, pallets, locationIds, canMove, initialPalletId = "" }: {
  locations: WarehouseLocation[]; pallets: Pallet[]; locationIds: Record<string, string | null>; canMove: boolean; initialPalletId?: string;
}) {
  const router = useRouter();
  const [created, createAction, creating] = useActionState(createLocation, initial);
  const [moved, moveAction, moving] = useActionState(assignLocation, initial);
  const [palletId, setPalletId] = useState(initialPalletId);
  const [locationId, setLocationId] = useState("");
  const [scan, setScan] = useState<"pallet" | "location" | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const pallet = pallets.find((p) => p.id === palletId);
  const destination = locations.find((l) => l.id === locationId);
  const onScan = useCallback((value: string) => {
    setScan(null); setScanError(null);
    if (scan === "pallet") {
      const found = pallets.find((p) => p.qrCode === value.trim());
      if (!found) { setScanError("El pallet no existe o no pertenece a tu empresa."); return; }
      setPalletId(found.id);
    } else {
      const found = findScannedLocation(locations, value);
      if (!found) { setScanError("La ubicación no existe o no pertenece a tu empresa."); return; }
      setLocationId(found.id);
    }
  }, [scan, pallets, locations]);
  return <div className="space-y-8">
    <section className="surface space-y-4 p-6">
      <SectionHeader title="Crear ubicación" description="Depósito DEP-01 · Los códigos y coordenadas permanecen estables." />
      <form action={createAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {([['code', 'Código único'], ['aisle', 'Pasillo o fila'], ['rack', 'Estantería'], ['level', 'Nivel'], ['position', 'Posición']] as const).map(([name, label]) => <label key={name} className="form-label">{label}<input name={name} required maxLength={40} pattern={name === 'code' ? '[A-Za-z0-9][A-Za-z0-9_-]{0,39}' : undefined} className="form-control mt-2" /></label>)}
        <button disabled={creating} className="button-primary self-end">{creating ? "Creando…" : "Crear ubicación"}</button>
        <div className="sm:col-span-2"><Result state={created} /></div>
      </form>
    </section>
    <section className="surface space-y-4 p-6">
      <SectionHeader title={canMove ? "Asignar o cambiar ubicación" : "Consultar ubicación de un pallet"} />
      <form action={moveAction} className="space-y-4">
        <label className="form-label">Pallet<select name="palletId" value={palletId} required onChange={(e) => setPalletId(e.target.value)} disabled={moving} className="form-control mt-2"><option value="">Seleccionar pallet</option>{pallets.map((p) => <option key={p.id} value={p.id}>{p.qrCode} · {p.productName}</option>)}</select></label>
        <button type="button" className="button-secondary" disabled={moving} onClick={() => setScan("pallet")}>Escanear pallet</button>
        {pallet && <div className="space-y-2 text-sm"><p>Ubicación actual: <strong>{pallet.currentLocation ?? "Sin asignar"}</strong></p><Link className="table-action" href={`/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}`}>Ver ficha e historial</Link></div>}
        {canMove && <>
          <label className="form-label">Ubicación de destino<select name="locationId" required value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={moving} className="form-control mt-2"><option value="">Seleccionar ubicación</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.warehouse_code} / {l.code} · {l.aisle} / {l.rack} / {l.level} / {l.position}</option>)}</select></label>
          <button type="button" className="button-secondary" disabled={moving} onClick={() => setScan("location")}>Escanear ubicación</button>
          <input type="hidden" name="expectedLocationId" value={palletId ? locationIds[palletId] ?? "" : ""} />
          {pallet && !canLocatePallet(pallet.status) && <InlineAlert variant="danger">El pallet ya no está en depósito.</InlineAlert>}
          {pallet && destination && <p className="text-sm">Confirmar movimiento de {pallet.qrCode}: {pallet.currentLocation ?? "Sin ubicación"} → {destination.warehouse_code} / {destination.code}</p>}
          <div className="flex flex-wrap gap-3"><button className="button-primary" disabled={moving || !pallet || !destination || !canLocatePallet(pallet.status) || locationIds[palletId] === locationId}>{moving ? "Registrando…" : "Confirmar ubicación"}</button><button type="button" className="button-secondary" disabled={moving} onClick={() => router.refresh()}>Actualizar datos</button></div>
          <Result state={moved} />
        </>}
        {scanError && <InlineAlert variant="danger">{scanError}</InlineAlert>}
      </form>
    </section>
    <section className="space-y-4">
      <SectionHeader title="Ubicaciones disponibles" description="Una ubicación puede contener varios pallets; no se administra capacidad." />
      <label className="form-label">Buscar por código<input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} className="form-control mt-2" /></label>
      <TableShell label="Catálogo de ubicaciones"><table className="data-table"><thead><tr><th>Depósito / Código</th><th>Pasillo</th><th>Estantería</th><th>Nivel</th><th>Posición</th><th>Pallets</th><th>Etiqueta</th></tr></thead><tbody>
        {locations.filter((l) => l.code.includes(filter.trim().toUpperCase())).map((l) => <tr key={l.id}><td className="font-mono">{l.warehouse_code} / {l.code}</td><td>{l.aisle}</td><td>{l.rack}</td><td>{l.level}</td><td>{l.position}</td><td>{Object.values(locationIds).filter((id) => id === l.id).length}</td><td><LocationQr location={l} /></td></tr>)}
      </tbody></table></TableShell>
      {locations.length === 0 && <p className="text-sm text-stone-500">Todavía no hay ubicaciones. Creá la primera para comenzar.</p>}
    </section>
    {scan && <QrScanner title={scan === "location" ? "Escanear ubicación" : "Escanear pallet"} description="Apuntá la cámara al código QR de la etiqueta." disabled={moving} onCancel={() => setScan(null)} onScan={onScan} />}
  </div>;
}
