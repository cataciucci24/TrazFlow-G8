/**
 * Historial de escaneos de la pantalla de validación: una sola fila por código, la más reciente. Sin entorno ni
 * red: se usa en el componente cliente y se prueba aparte.
 */

/** Escaneo de esta sesión (todavía no recargado desde la base), del más nuevo al más viejo. */
export type SessionScan = { code: string; message: string; success: boolean };
/** Escaneo confirmado guardado en la base (evento qr_scan), del más nuevo al más viejo. */
export type StoredScan = { id: string; qrCode: string; createdAt: string };

export type ScanHistoryRow = {
  key: string;
  code: string;
  message: string;
  tone: "success" | "danger" | "warning";
};

/**
 * "27/10/2026, 04:38:34" en hora argentina. La zona es fija para que el servidor (UTC) y el navegador escriban lo
 * mismo: si no, React falla al hidratar la pantalla.
 */
const SCAN_DATE = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false, timeZone: "America/Argentina/Buenos_Aires",
});

export function formatScanDate(iso: string): string {
  return SCAN_DATE.format(new Date(iso));
}

/**
 * Lo de la sesión va primero porque es lo más reciente. De cada código queda solo la primera aparición.
 *
 * Un escaneo guardado de un pallet que hoy está pendiente quiere decir que logística le cambió la cantidad
 * después de validarlo (TRZ-100) y la validación se borró: se avisa que hay que volver a escanearlo.
 */
export function latestScans(session: SessionScan[], stored: StoredScan[], pendingCodes: ReadonlySet<string>): ScanHistoryRow[] {
  const seen = new Set<string>();
  const rows: ScanHistoryRow[] = [];
  session.forEach((scan, index) => {
    if (seen.has(scan.code)) return;
    seen.add(scan.code);
    rows.push({ key: `session-${index}`, code: scan.code, message: scan.message, tone: scan.success ? "success" : "danger" });
  });
  for (const scan of stored) {
    if (seen.has(scan.qrCode)) continue;
    seen.add(scan.qrCode);
    const when = formatScanDate(scan.createdAt);
    rows.push(pendingCodes.has(scan.qrCode)
      ? { key: scan.id, code: scan.qrCode, message: `Validado el ${when}, pero después se cambió la cantidad: volvé a escanearlo.`, tone: "warning" }
      : { key: scan.id, code: scan.qrCode, message: `Confirmado el ${when}`, tone: "success" });
  }
  return rows;
}
