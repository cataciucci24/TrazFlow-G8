import { getCompanyDrivers } from "@/lib/operators/queries";
import { createClient } from "@/lib/supabase/server";
import { suggestTrip, type TripOrderInput, type TripSuggestion } from "./suggest";

/** Órdenes que todavía no salieron del depósito: son las que compiten por el lugar en el vehículo. */
const PLANNABLE_STATUSES = ["draft", "validating", "has_discrepancy"];

export type DriverVehicle = { driverId: string; name: string; capacityPallets: number };

export type DriverTripPlan = {
  driverId: string;
  driverName: string;
  vehicle: DriverVehicle | null;
  orders: TripOrderInput[];
  /** null si el chofer no tiene vehículo cargado: no hay contra qué comparar. */
  suggestion: TripSuggestion | null;
};

type OrderRow = {
  id: string;
  external_id: string | null;
  estimated_dispatch_date: string;
  driver_id: string;
  distributors: { name: string } | { name: string }[] | null;
  order_pallets: { expected: boolean }[] | null;
};

/**
 * Viaje de cada chofer para una fecha: sus órdenes con esa fecha prevista o atrasadas que todavía no salieron,
 * con los pallets armados de cada una, contra la capacidad de su vehículo (TRZ-71).
 */
export async function getTripPlans(date: string): Promise<{ plans: DriverTripPlan[]; vehicles: DriverVehicle[] }> {
  const supabase = await createClient();
  const [drivers, vehiclesResult, ordersResult] = await Promise.all([
    getCompanyDrivers(),
    supabase.from("driver_vehicles").select("driver_id, name, capacity_pallets"),
    supabase.from("dispatch_orders")
      .select("id, external_id, estimated_dispatch_date, driver_id, distributors ( name ), order_pallets ( expected )")
      .not("driver_id", "is", null)
      .lte("estimated_dispatch_date", date)
      .in("status", PLANNABLE_STATUSES),
  ]);
  if (vehiclesResult.error) throw new Error("No se pudieron consultar los vehículos.", { cause: vehiclesResult.error });
  if (ordersResult.error) throw new Error("No se pudieron consultar las órdenes asignadas.", { cause: ordersResult.error });

  const vehicles: DriverVehicle[] = (vehiclesResult.data ?? []).map((row) => ({
    driverId: row.driver_id,
    name: row.name,
    capacityPallets: row.capacity_pallets,
  }));
  const vehicleByDriver = new Map(vehicles.map((vehicle) => [vehicle.driverId, vehicle]));

  const ordersByDriver = new Map<string, TripOrderInput[]>();
  for (const row of (ordersResult.data ?? []) as OrderRow[]) {
    const distributor = Array.isArray(row.distributors) ? row.distributors[0] : row.distributors;
    const orders = ordersByDriver.get(row.driver_id) ?? [];
    orders.push({
      id: row.id,
      // Sin id del ERP, el mismo código corto que muestra la lista de órdenes.
      label: row.external_id ?? `${distributor?.name ?? "Orden"} · ${row.id.slice(0, 8).toUpperCase()}`,
      estimatedDate: row.estimated_dispatch_date,
      palletCount: (row.order_pallets ?? []).filter((pallet) => pallet.expected).length,
    });
    ordersByDriver.set(row.driver_id, orders);
  }

  const plans = drivers.map((driver) => {
    const vehicle = vehicleByDriver.get(driver.id) ?? null;
    const orders = ordersByDriver.get(driver.id) ?? [];
    return {
      driverId: driver.id,
      driverName: driver.name,
      vehicle,
      orders,
      suggestion: vehicle ? suggestTrip(vehicle.capacityPallets, orders) : null,
    };
  });
  return { plans, vehicles };
}
