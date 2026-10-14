import { assignDriverToOrder } from "@/lib/deliveries/assignment";
import { getCompanyDrivers } from "@/lib/operators/queries";

export async function DriverAssignmentForm({
  orderId,
  currentDriverId,
  currentDriverName,
}: {
  orderId: string;
  currentDriverId: string | null;
  currentDriverName: string | null;
}) {
  const drivers = await getCompanyDrivers();
  return (
    <form action={assignDriverToOrder} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="orderId" value={orderId} />
      <label className="form-label flex-1">
        Chofer asignado
        <select name="driverId" required defaultValue={currentDriverId ?? ""} className="form-control mt-2">
          <option value="" disabled>Seleccioná un chofer</option>
          {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
        </select>
      </label>
      <button type="submit" className="button-primary">{currentDriverId ? "Reasignar" : "Asignar"}</button>
      {currentDriverName && <span className="text-sm text-stone-500 sm:pb-2">Actual: {currentDriverName}</span>}
    </form>
  );
}
