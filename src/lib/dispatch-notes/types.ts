/**
 * TRZ-51: remito digital de un despacho. Es una copia congelada de los datos al confirmar el despacho
 * (tabla dispatch_notes, migración 20261123100000). Seguro para el cliente: sin Supabase.
 */

export type DispatchNoteLine = {
  palletCode: string;
  productName: string;
  productSku: string;
  lotNumber: string;
  expirationDate: string | null;
  quantity: number | null;
  unit: string;
};

export type DispatchNote = {
  id: string;
  orderId: string;
  number: number;
  issuedAt: string;
  issuer: { name: string; taxId: string | null };
  recipient: { name: string; address: string | null };
  order: { id: string; externalId: string | null; createdAt: string | null };
  issuedBy: string | null;
  driver: string | null;
  lines: DispatchNoteLine[];
  /** El remito se generó al aplicar la migración, para una orden despachada antes de TRZ-51. */
  backfilled: boolean;
};

/** Estados en los que la orden ya salió y tiene remito (la base lo genera al confirmar el despacho). */
export function isDispatched(status: string): boolean {
  return !["draft", "validating", "has_discrepancy"].includes(status);
}

/** "R-000012": número del remito con ceros a la izquierda. */
export function formatDispatchNoteNumber(number: number): string {
  return `R-${String(number).padStart(6, "0")}`;
}

/** Varias líneas pueden pertenecer al mismo pallet mixto. */
export function dispatchNotePalletCount(lines: readonly DispatchNoteLine[]): number {
  return new Set(lines.map(line => line.palletCode)).size;
}

/** Totales por unidad ("40 cajas · 356,5 kilogramos"). */
export function dispatchNoteTotals(lines: DispatchNoteLine[]): string {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (typeof line.quantity !== "number") continue;
    totals.set(line.unit, (totals.get(line.unit) ?? 0) + line.quantity);
  }
  const format = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
  return [...totals].map(([unit, total]) => `${format.format(total)} ${unit}`).join(" · ");
}

type Json = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function obj(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

/** Convierte la fila de dispatch_notes. Tolera campos faltantes: un remito viejo nunca rompe la pantalla. */
export function toDispatchNote(row: {
  id: string;
  order_id: string;
  number: number;
  issued_at: string;
  content: unknown;
}): DispatchNote {
  const content = obj(row.content);
  const issuer = obj(content.issuer);
  const recipient = obj(content.recipient);
  const order = obj(content.order);
  const lines = Array.isArray(content.lines) ? content.lines : [];
  return {
    id: row.id,
    orderId: row.order_id,
    number: row.number,
    issuedAt: row.issued_at,
    issuer: { name: str(issuer.name) ?? "—", taxId: str(issuer.taxId) },
    recipient: { name: str(recipient.name) ?? "—", address: str(recipient.address) },
    order: { id: str(order.id) ?? row.order_id, externalId: str(order.externalId), createdAt: str(order.createdAt) },
    issuedBy: str(obj(content.issuedBy).name),
    driver: str(obj(content.driver).name),
    lines: lines.map((value) => {
      const line = obj(value);
      return {
        palletCode: str(line.palletCode) ?? "—",
        productName: str(line.productName) ?? "—",
        productSku: str(line.productSku) ?? "—",
        lotNumber: str(line.lotNumber) ?? "—",
        expirationDate: str(line.expirationDate),
        quantity: typeof line.quantity === "number" ? line.quantity : null,
        unit: str(line.unit) ?? "",
      };
    }),
    backfilled: content.backfilled === true,
  };
}
