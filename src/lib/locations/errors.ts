type DatabaseError = { code: string; message: string };

/** Keep deliberate business errors; translate database diagnostics for the operator. */
export function locationErrorMessage(error: DatabaseError, operation: "create" | "move"): string {
  if (error.code === "23505") return "Ya existe ese código o esas coordenadas en el depósito.";
  if (["P0001", "P0002", "40001"].includes(error.code)) return error.message;
  if (error.code === "42501") {
    if (!/permission denied|row.level security/i.test(error.message)) return error.message;
    return operation === "create" ? "No tenés permisos para crear ubicaciones en esta empresa." : "No tenés permisos para mover pallets en esta empresa.";
  }
  if (error.code === "23514") {
    if (operation === "move") return error.message;
    return "Revisá el código y las coordenadas: no cumplen el formato permitido para una ubicación.";
  }
  if (error.code === "23503") return "El pallet, la ubicación o la empresa ya no están disponibles. Actualizá los datos.";
  return operation === "create"
    ? "No se pudo crear la ubicación. Actualizá el catálogo antes de volver a intentar."
    : "No se pudo registrar el movimiento. Actualizá la pantalla e intentá nuevamente.";
}
