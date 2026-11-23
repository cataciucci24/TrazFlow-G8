/** Orden asignada a un chofer, con los pallets que tiene armados (order_pallets con expected = true). */
export type TripOrderInput = {
  id: string;
  /** Lo que ve logística: número de orden del ERP o distribuidor. */
  label: string;
  /** Fecha prevista de despacho, `YYYY-MM-DD`. */
  estimatedDate: string;
  palletCount: number;
};

/**
 * Sugerencia informativa para el viaje de un chofer. No cambia nada: logística decide si mueve las órdenes
 * sugeridas a otro viaje o día.
 */
export type TripSuggestion = {
  capacityPallets: number;
  /** Pallets de todas las órdenes del viaje. */
  totalPallets: number;
  /** Pallets de las órdenes que entran en este viaje. */
  loadedPallets: number;
  /** true si todas las órdenes entran en el vehículo. */
  fits: boolean;
  /** Órdenes que entran, en el orden en que se cargaron. */
  loaded: TripOrderInput[];
  /** Órdenes que no entran junto con las anteriores: se sugiere pasarlas al próximo viaje o día. */
  deferred: TripOrderInput[];
  /** Órdenes que solas superan la capacidad del vehículo: hay que dividirlas o usar otro vehículo. */
  oversized: TripOrderInput[];
};

/**
 * Arma el viaje de un chofer con first-fit por fecha prevista.
 *
 * - Se cargan primero las órdenes con fecha prevista más antigua (las atrasadas antes que las del día); a igual
 *   fecha, por etiqueta, para que la sugerencia sea estable.
 * - Cada orden entra completa si queda lugar; si no, se sugiere pasarla al próximo viaje y se sigue probando con
 *   las siguientes, que pueden ser más chicas.
 * - Una orden que sola supera la capacidad no se carga y se avisa aparte.
 */
export function suggestTrip(capacityPallets: number, orders: TripOrderInput[]): TripSuggestion {
  if (!Number.isInteger(capacityPallets) || capacityPallets <= 0) {
    throw new Error("La capacidad del vehículo tiene que ser un entero positivo de pallets.");
  }

  const sorted = [...orders].sort((left, right) =>
    left.estimatedDate.localeCompare(right.estimatedDate) || left.label.localeCompare(right.label, "es"));

  const loaded: TripOrderInput[] = [];
  const deferred: TripOrderInput[] = [];
  const oversized: TripOrderInput[] = [];
  let loadedPallets = 0;

  for (const order of sorted) {
    if (order.palletCount > capacityPallets) {
      oversized.push(order);
    } else if (loadedPallets + order.palletCount <= capacityPallets) {
      loaded.push(order);
      loadedPallets += order.palletCount;
    } else {
      deferred.push(order);
    }
  }

  return {
    capacityPallets,
    totalPallets: sorted.reduce((total, order) => total + order.palletCount, 0),
    loadedPallets,
    fits: deferred.length === 0 && oversized.length === 0,
    loaded,
    deferred,
    oversized,
  };
}
