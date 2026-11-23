"use client";
import { useActionState } from "react";
import { InlineAlert } from "@/components/ui/design-system";
import { saveDriverVehicle, type VehicleActionState } from "@/lib/trip-planning/actions";
import type { DriverVehicle } from "@/lib/trip-planning/queries";

const initial: VehicleActionState = { error: null, success: null };

/** TRZ-71: carga o cambia el vehículo de un chofer. Elegir un chofer que ya tiene vehículo lo reemplaza. */
export function VehicleForm({ drivers, vehicles }: { drivers: { id: string; name: string }[]; vehicles: DriverVehicle[] }) {
  const [state, action, pending] = useActionState(saveDriverVehicle, initial);
  const withVehicle = new Set(vehicles.map((vehicle) => vehicle.driverId));

  return (
    <form action={action} aria-busy={pending} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="form-label">Chofer
        <select name="driverId" required disabled={pending} defaultValue="" className="form-control mt-2">
          <option value="" disabled>Seleccionar chofer</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>{driver.name}{withVehicle.has(driver.id) ? " (reemplaza su vehículo)" : ""}</option>
          ))}
        </select>
      </label>
      <label className="form-label">Nombre o patente
        <input name="name" required maxLength={60} disabled={pending} placeholder="Camión AB 123 CD" className="form-control mt-2" />
      </label>
      <label className="form-label">Capacidad (pallets)
        <input name="capacityPallets" type="number" required min={1} max={99} step={1} disabled={pending} className="form-control mt-2" />
      </label>
      <button disabled={pending || drivers.length === 0} className="button-primary self-end">{pending ? "Guardando…" : "Guardar vehículo"}</button>
      <div className="sm:col-span-2 lg:col-span-4" aria-live="polite">
        {state.error ? <InlineAlert variant="danger">{state.error}</InlineAlert> : null}
        {state.success ? <InlineAlert variant="success">{state.success}</InlineAlert> : null}
      </div>
    </form>
  );
}
