"use client";
import Link from "next/link";
import { useCallback, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/pallet-validation/qr-scanner";
import { PalletScanDetails } from "@/components/pallets/pallet-scan-details";
import { InlineAlert, SectionHeader, TableShell } from "@/components/ui/design-system";
import { createLocation, assignLocation } from "@/lib/locations/actions";
import { canLocatePallet, findScannedLocation } from "@/lib/locations/rules";
import type { LocationActionState, WarehouseLocation } from "@/lib/locations/types";
import type { Pallet } from "@/lib/types";
import { activeWarehouses, warehouseLabel, type Warehouse } from "@/lib/warehouses/types";
import { WarehouseField } from "@/components/warehouses/warehouse-field";
import { LocationQr } from "./location-qr";
import { useLocationFeedback } from "./use-location-feedback";

const initial: LocationActionState = { error: null, success: null };
function Result({ state }: { state: LocationActionState }) {
  return <>{state.error && <InlineAlert variant="danger">{state.error}</InlineAlert>}{state.success && <InlineAlert variant="success">{state.success}</InlineAlert>}</>;
}
export function LocationsPanel({ locations, pallets, warehouses = [], locationIds, canMove, initialPalletId = "" }: {
  locations: WarehouseLocation[]; pallets: Pallet[]; warehouses?: Warehouse[]; locationIds: Record<string, string | null>; canMove: boolean; initialPalletId?: string;
}) {
  const router = useRouter();
  const created = useLocationFeedback();
  const moved = useLocationFeedback();
  const [creating, startCreate] = useTransition();
  const [moving, startMove] = useTransition();
  const [palletId, setPalletId] = useState(initialPalletId);
  const [locationId, setLocationId] = useState("");
  const [scan, setScan] = useState<"pallet" | "location" | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanVersion, setScanVersion] = useState(0);
  const [filter, setFilter] = useState("");
  const pallet = pallets.find((p) => p.id === palletId);
  // TRZ-101: un pallet solo se ubica en su depósito (mover entre depósitos es una transferencia, fuera de alcance).
  const destinations = pallet?.warehouseCode ? locations.filter((l) => l.warehouse_code === pallet.warehouseCode) : locations;
  const destination = destinations.find((l) => l.id === locationId);
  const active = activeWarehouses(warehouses);
  const sameLocation = Boolean(pallet && destination && locationIds[palletId] === locationId);
  const clearMoveError = moved.clearError;

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    created.clear();
    startCreate(async () => {
      try {
        const result = await createLocation(initial, data);
        created.show(result);
        if (result.success && form.isConnected) form.reset();
      } catch {
        created.show({ error: "No se pudo confirmar la creación. Actualizá el catálogo antes de volver a intentar.", success: null });
      }
    });
  }
  function submitMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (moving || !pallet || !destination || sameLocation || !canLocatePallet(pallet.status)) return;
    const data = new FormData(event.currentTarget);
    moved.clear();
    setScanError(null);
    startMove(async () => {
      try {
        moved.show(await assignLocation(initial, data));
      } catch {
        moved.show({ error: "No se pudo confirmar el resultado del movimiento. Actualizá los datos antes de volver a intentar.", success: null });
      }
    });
  }
  const onScan = useCallback((value: string) => {
    setScan(null); setScanError(null); clearMoveError();
    if (scan === "pallet") {
      setScanVersion((version) => version + 1);
      const found = pallets.find((p) => p.qrCode === value.trim());
      if (!found) { setPalletId(""); setScanError("El pallet no existe o no pertenece a tu empresa."); return; }
      setPalletId(found.id);
    } else {
      const found = findScannedLocation(locations, value);
      if (!found) { setScanError("La ubicación no existe o no pertenece a tu empresa."); return; }
      if (pallet?.warehouseCode && found.warehouse_code !== pallet.warehouseCode) {
        setScanError(`La ubicación ${found.code} es del depósito ${found.warehouse_code} y el pallet está en ${pallet.warehouseCode}.`);
        return;
      }
      setLocationId(found.id);
    }
  }, [scan, pallets, locations, pallet, clearMoveError]);
  return <div className="space-y-8">
    <section className="surface space-y-4 p-6">
      <SectionHeader title="Crear ubicación" description={`${active.length === 1 ? `Depósito ${warehouseLabel(active[0])} · ` : ""}Los códigos y coordenadas permanecen estables.`} />
      <form onSubmit={submitCreate} onChange={created.clearError} aria-busy={creating} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {([['code', 'Código único'], ['aisle', 'Pasillo o fila'], ['rack', 'Estantería'], ['level', 'Nivel'], ['position', 'Posición']] as const).map(([name, label]) => <label key={name} className="form-label">{label}<input name={name} disabled={creating} required maxLength={40} pattern={name === 'code' ? '[A-Za-z0-9][A-Za-z0-9_-]{0,39}' : undefined} className="form-control mt-2" /></label>)}
        <WarehouseField warehouses={warehouses} disabled={creating} />
        <button disabled={creating} className="button-primary self-end">{creating ? "Creando…" : "Crear ubicación"}</button>
        <div className="sm:col-span-2"><Result state={created.state} /></div>
      </form>
    </section>
    <section className="surface space-y-4 p-6">
      <SectionHeader title={canMove ? "Asignar o cambiar ubicación" : "Consultar ubicación de un pallet"} />
      <form onSubmit={submitMove} aria-busy={moving} className="space-y-4">
        <label className="form-label">Pallet<select name="palletId" value={palletId} required onChange={(e) => { setPalletId(e.target.value); clearMoveError(); setScanError(null); }} disabled={moving} className="form-control mt-2"><option value="">Seleccionar pallet</option>{pallets.map((p) => <option key={p.id} value={p.id}>{p.qrCode} · {p.productName}</option>)}</select></label>
        <button type="button" className="button-secondary" disabled={moving} onClick={() => { setScanError(null); clearMoveError(); setScan("pallet"); }}>Escanear pallet</button>
        {pallet && <div className="space-y-2 text-sm"><p>Ubicación actual: <strong>{pallet.currentLocation ?? "Sin asignar"}</strong></p><Link className="table-action" href={`/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}`}>Ver ficha e historial</Link></div>}
        {pallet && <PalletScanDetails key={`${pallet.id}:${pallet.currentLocation}:${moved.state.success}:${scanVersion}`} qrCode={pallet.qrCode} />}
        {canMove && <>
          <label className="form-label">Ubicación de destino<select name="locationId" required value={locationId} onChange={(e) => { setLocationId(e.target.value); clearMoveError(); setScanError(null); }} disabled={moving} className="form-control mt-2"><option value="">Seleccionar ubicación</option>{destinations.map((l) => <option key={l.id} value={l.id}>{l.warehouse_code} / {l.code} · {l.aisle} / {l.rack} / {l.level} / {l.position}</option>)}</select></label>
          <button type="button" className="button-secondary" disabled={moving} onClick={() => { setScanError(null); clearMoveError(); setScan("location"); }}>Escanear ubicación</button>
          <input type="hidden" name="expectedLocationId" value={palletId ? locationIds[palletId] ?? "" : ""} />
          {pallet && !canLocatePallet(pallet.status) && <InlineAlert variant="danger">El pallet ya no está en depósito.</InlineAlert>}
          {sameLocation && <InlineAlert>El pallet ya se encuentra en esta ubicación.</InlineAlert>}
          {pallet && destination && !sameLocation && <p className="text-sm">Confirmar movimiento de {pallet.qrCode}: {pallet.currentLocation ?? "Sin ubicación"} → {destination.warehouse_code} / {destination.code}</p>}
          <div className="flex flex-wrap gap-3"><button className="button-primary" disabled={moving || !pallet || !destination || !canLocatePallet(pallet.status) || sameLocation}>{moving ? "Registrando…" : "Confirmar ubicación"}</button><button type="button" className="button-secondary" disabled={moving} onClick={() => { moved.clearError(); setScanError(null); router.refresh(); }}>Actualizar datos</button></div>
          <Result state={moved.state} />
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
