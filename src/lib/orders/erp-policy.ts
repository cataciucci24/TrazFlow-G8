// Con el ERP activo, las órdenes de despacho nacen en el ERP y entran por la sincronización (TRZ-102).
// TrazFlow no puede crearlas en el ERP, y una orden sin external_id se despacharía sin informarse.

/** Aviso que reemplaza "Nueva orden" cuando la empresa trabaja con un ERP. */
export const ERP_ORDERS_NOTICE = "Las órdenes se crean en el ERP y entran a TrazFlow al sincronizar.";

/** Error de createDispatchOrder cuando se la llama con el ERP activo. */
export const ERP_MANAGED_ORDERS_ERROR =
  "Tu empresa trabaja con un ERP: las órdenes se crean en el ERP y entran a TrazFlow al sincronizar.";

/** ¿Se pueden crear órdenes a mano? Solo si la empresa no trabaja con un ERP. */
export function canCreateManualOrders(erpEnabled: boolean): boolean {
  return !erpEnabled;
}
