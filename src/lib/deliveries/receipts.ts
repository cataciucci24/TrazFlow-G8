/**
 * Reglas del remito firmado que sube el chofer (TRZ-103). Sin entorno ni red: se usan en el navegador (antes de
 * subir) y en el servidor. Los mismos límites los impone el bucket delivery-receipts y register_delivery_receipt.
 */
import { DELIVERY_RECEIPT_CONTENT_TYPES, DELIVERY_RECEIPT_MAX_BYTES } from "../erp/types.ts";
import type { OrderStatus } from "../types.ts";

export const DELIVERY_RECEIPTS_BUCKET = "delivery-receipts";
export const DELIVERY_RECEIPTS_MAX_PER_ORDER = 5;
export { DELIVERY_RECEIPT_MAX_BYTES };

/** Lo que acepta el selector de archivos del celular. */
export const DELIVERY_RECEIPT_ACCEPT = DELIVERY_RECEIPT_CONTENT_TYPES.join(",");

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export type DeliveryReceiptFileProblem = "type" | "size" | "empty";

export function deliveryReceiptFileProblem(file: { type: string; size: number }): DeliveryReceiptFileProblem | null {
  if (!DELIVERY_RECEIPT_CONTENT_TYPES.some((type) => type === file.type)) return "type";
  if (file.size <= 0) return "empty";
  if (file.size > DELIVERY_RECEIPT_MAX_BYTES) return "size";
  return null;
}

/** Ruta en el bucket: {empresa}/{orden}/{id}.{ext}. El id es aleatorio para que dos fotos nunca choquen. */
export function deliveryReceiptPath(companyId: string, orderId: string, fileId: string, contentType: string): string {
  return `${companyId}/${orderId}/${fileId}.${EXTENSIONS[contentType] ?? "bin"}`;
}

/** Se puede subir mientras la orden está en viaje y también después de cerrar la entrega. */
export function canAttachDeliveryReceipt(status: OrderStatus): boolean {
  return status === "confirmed" || status === "delivered" || status === "delivered_with_discrepancy";
}

export type RegisterReceiptOutcome =
  | "registered"
  | "already_registered"
  | "forbidden"
  | "invalid_input"
  | "order_not_found"
  | "invalid_status"
  | "file_not_found"
  | "invalid_file"
  | "limit_reached"
  | "error";

export const REGISTER_RECEIPT_MESSAGES: Record<RegisterReceiptOutcome, string> = {
  registered: "Remito guardado. Se va a adjuntar en el ERP.",
  already_registered: "Ese remito ya estaba guardado.",
  forbidden: "No tenés permisos para adjuntar remitos a esta entrega.",
  invalid_input: "El archivo no es válido.",
  order_not_found: "La entrega no existe.",
  invalid_status: "La orden no está en viaje ni entregada.",
  file_not_found: "El archivo no terminó de subirse. Probá de nuevo.",
  invalid_file: "Subí una foto o un PDF de hasta 10 MB.",
  limit_reached: `Ya hay ${DELIVERY_RECEIPTS_MAX_PER_ORDER} remitos en esta entrega.`,
  error: "No se pudo guardar el remito. Intentá nuevamente.",
};

export const FILE_PROBLEM_MESSAGES: Record<DeliveryReceiptFileProblem, string> = {
  type: "Subí una foto (JPG, PNG, WEBP o HEIC) o un PDF.",
  size: "El archivo supera los 10 MB.",
  empty: "El archivo está vacío.",
};

export type DeliveryReceiptSummary = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};
