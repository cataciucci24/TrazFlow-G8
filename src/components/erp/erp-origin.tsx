import { Badge } from "@/components/ui/design-system";
import type { ErpOrigin } from "@/lib/erp-sync/types";

// Zona fija: el mismo texto en el servidor y en el navegador (sin desajustes de hidratación).
const SYNCED_AT_FORMAT = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatSyncedAt(value: string): string {
  return SYNCED_AT_FORMAT.format(new Date(value));
}

/** Pallet creado por la sincronización cuando un saldo del ERP era un pallet (antes de TRZ-100). */
export function isInheritedErpBalance(origin?: ErpOrigin): boolean {
  return origin?.sourceSystem === "erp" && (origin.externalId?.startsWith("stock:") ?? false);
}

/** Origen de un registro: badge "ERP" con su identificador externo y la última sincronización. */
export function ErpOriginCell({ origin }: { origin?: ErpOrigin }) {
  if (origin?.sourceSystem !== "erp") return <span className="text-stone-500">TrazFlow</span>;
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1">
      {isInheritedErpBalance(origin)
        ? <Badge tone="warning">Heredado de saldo ERP</Badge>
        : <Badge tone="info">ERP</Badge>}
      {origin.externalId ? <span className="break-all font-mono text-xs text-stone-600" title="Identificador en el ERP">{origin.externalId}</span> : null}
      {origin.syncedAt ? <span className="text-xs text-stone-500">Sincronizado {formatSyncedAt(origin.syncedAt)}</span> : null}
    </span>
  );
}
