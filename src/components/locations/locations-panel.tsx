"use client";
import Link from "next/link";
import { useCallback, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/pallet-validation/qr-scanner";
import { PalletScanDetails } from "@/components/pallets/pallet-scan-details";
import { InlineAlert, SectionHeader, TableShell } from "@/components/ui/design-system";
import { createLocation, assignLocation } from "@/lib/locations/actions";
import { canLocatePallet, findScannedLocation } from "@/lib/locations/rules";
import { LOCATION_COORDINATES } from "@/lib/locations/coordinates";
import { formatLocationCoordinates } from "@/lib/locations/format";
import { DEFAULT_LAYOUT, type WarehouseLayout } from "@/lib/warehouses/layout";
import type { LocationActionState, WarehouseLocation } from "@/lib/locations/types";
import type { Pallet } from "@/lib/types";
import { activeWarehouses, warehouseLabel, type Warehouse } from "@/lib/warehouses/types";
import { LocationQr } from "./location-qr";
import { LocationGenerator } from "./location-generator";
import { useLocationFeedback } from "./use-location-feedback";
import { SearchableSelect } from "./searchable-select";
import { LocationsNavigation } from "./locations-navigation";

const initial: LocationActionState = { error: null, success: null };
function Result({ state }: { state: LocationActionState }) {
  return <>{state.error && <InlineAlert variant="danger">{state.error}</InlineAlert>}{state.success && <InlineAlert variant="success">{state.success}</InlineAlert>}</>;
}
export function LocationsPanel({ locations, pallets, warehouses = [], layouts = {}, locationIds, canMove, canGenerate = false, initialPalletId = "" }: {
  locations: WarehouseLocation[]; pallets: Pallet[]; warehouses?: Warehouse[]; layouts?: Record<string, WarehouseLayout>; locationIds: Record<string, string | null>; canMove: boolean; canGenerate?: boolean; initialPalletId?: string;
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
  const [creationWarehouse, setCreationWarehouse] = useState("");
  const pallet = pallets.find((p) => p.id === palletId);
  // TRZ-101: un pallet solo se ubica en su depósito (mover entre depósitos es una transferencia, fuera de alcance).
  const destinations = pallet?.warehouseCode ? locations.filter((l) => l.warehouse_code === pallet.warehouseCode) : locations;
  const destination = destinations.find((l) => l.id === locationId);
  const active = activeWarehouses(warehouses);
  const selectedWarehouse = creationWarehouse || (active.length === 1 ? active[0].code : "");
  const selectedLayout = selectedWarehouse ? layouts[selectedWarehouse] ?? DEFAULT_LAYOUT : null;
  const locationDescription = (location: WarehouseLocation) => formatLocationCoordinates(location, layouts[location.warehouse_code] ?? DEFAULT_LAYOUT);
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
    <LocationsNavigation canGenerate={canGenerate} canMove={canMove} />
    <section id="crear-ubicacion" className="surface scroll-mt-40 space-y-4 p-6 lg:scroll-mt-24">
      <SectionHeader title="Crear ubicación" description={`${active.length === 1 ? `Depósito ${warehouseLabel(active[0])} · ` : ""}Los códigos y coordenadas permanecen estables.`} />
      <form onSubmit={submitCreate} onChange={created.clearError} aria-busy={creating} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="form-label">Código único<input name="code" disabled={creating} required maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,39}" className="form-control mt-2" /></label>
        {active.length > 1 ? <SearchableSelect label="Depósito" placeholder="Seleccioná el depósito" name="warehouseCode" value={selectedWarehouse} required disabled={creating} options={active.map((warehouse) => ({ value: warehouse.code, label: warehouseLabel(warehouse) }))} onChange={(value) => { setCreationWarehouse(value); created.clearError(); }} /> : <input type="hidden" name="warehouseCode" value={selectedWarehouse} />}
        {selectedLayout?.map((level, index) => <label key={`${selectedWarehouse}-${index}`} className="form-label">{level.label}<input name={LOCATION_COORDINATES[index]} disabled={creating} required maxLength={40} className="form-control mt-2" /></label>)}
        <button disabled={creating || !selectedLayout} className="button-primary self-end">{creating ? "Creando…" : "Crear ubicación"}</button>
        <div className="sm:col-span-2"><Result state={created.state} /></div>
      </form>
    </section>
    {canGenerate && <LocationGenerator warehouses={warehouses} layouts={layouts} />}
    <section id="consultar-pallet" className="surface scroll-mt-40 space-y-4 p-6 lg:scroll-mt-24">
      <SectionHeader title={canMove ? "Asignar o cambiar ubicación" : "Consultar ubicación de un pallet"} />
      <form onSubmit={submitMove} aria-busy={moving} className="space-y-4">
        <SearchableSelect label="Pallet" placeholder="Seleccionar pallet" name="palletId" value={palletId} required disabled={moving} options={pallets.map((p) => ({ value: p.id, label: `${p.qrCode} · ${p.productName}`, search: p.productSku }))} onChange={(value) => { setPalletId(value); clearMoveError(); setScanError(null); }} />
        <button type="button" className="button-secondary" disabled={moving} onClick={() => { setScanError(null); clearMoveError(); setScan("pallet"); }}>Escanear pallet</button>
        {pallet && <div className="space-y-2 text-sm"><p>Ubicación actual: <strong>{pallet.currentLocation ?? "Sin asignar"}</strong></p><Link className="table-action" href={`/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}`}>Ver ficha e historial</Link></div>}
        {pallet && <PalletScanDetails key={`${pallet.id}:${pallet.currentLocation}:${moved.state.success}:${scanVersion}`} qrCode={pallet.qrCode} />}
        {canMove && <>
          <SearchableSelect label="Ubicación de destino" placeholder="Seleccionar ubicación" name="locationId" value={locationId} required disabled={moving} options={destinations.map((l) => ({ value: l.id, label: `${l.warehouse_code} / ${l.code} · ${locationDescription(l)}` }))} onChange={(value) => { setLocationId(value); clearMoveError(); setScanError(null); }} />
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
    <section id="ubicaciones-disponibles" className="scroll-mt-40 space-y-4 lg:scroll-mt-24">
      <SectionHeader title="Ubicaciones disponibles" description="Una ubicación puede contener varios pallets; no se administra capacidad." />
      <label className="form-label">Buscar por código<input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} className="form-control mt-2" /></label>
      <TableShell label="Catálogo de ubicaciones"><table className="data-table"><thead><tr><th>Depósito / Código</th><th>Coordenadas</th><th>Pallets</th><th>Etiqueta</th></tr></thead><tbody>
        {locations.filter((l) => l.code.includes(filter.trim().toUpperCase())).map((l) => <tr key={l.id}><td className="font-mono">{l.warehouse_code} / {l.code}</td><td>{locationDescription(l)}</td><td>{Object.values(locationIds).filter((id) => id === l.id).length}</td><td><LocationQr location={l} layout={layouts[l.warehouse_code] ?? DEFAULT_LAYOUT} /></td></tr>)}
      </tbody></table></TableShell>
      {locations.length === 0 && <p className="text-sm text-stone-500">Todavía no hay ubicaciones. Creá la primera para comenzar.</p>}
    </section>
    {scan && <QrScanner title={scan === "location" ? "Escanear ubicación" : "Escanear pallet"} description="Apuntá la cámara al código QR de la etiqueta." disabled={moving} onCancel={() => setScan(null)} onScan={onScan} />}
  </div>;
}
