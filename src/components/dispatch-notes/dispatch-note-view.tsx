import { DispatchNoteQr } from "@/components/dispatch-notes/dispatch-note-qr";
import { dispatchNoteTotals, formatDispatchNoteNumber, type DispatchNote } from "@/lib/dispatch-notes/types";

const DATE_TIME = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" });
const DATE = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "UTC" });
const NUMBER = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

/**
 * TRZ-51: remito digital, listo para ver en pantalla (también en el celular) e imprimir o guardar en PDF. Se
 * imprime solo este bloque (.print-root). Sin CAI ni CAE: no tiene validez fiscal.
 */
export function DispatchNoteView({ note }: { note: DispatchNote }) {
  const number = formatDispatchNoteNumber(note.number);
  const totals = note.lines.length ? ` · ${dispatchNoteTotals(note.lines)}` : "";
  return (
    <article className="print-root surface min-w-0 space-y-6 overflow-hidden p-4 text-sm sm:p-8" aria-label={`Remito ${number}`}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Remito digital</p>
          <h2 className="text-2xl font-bold text-slate-950">{number}</h2>
          <p className="text-slate-600">Emitido el {DATE_TIME.format(new Date(note.issuedAt))}</p>
        </div>
        <figure className="flex flex-col items-center gap-1">
          <DispatchNoteQr path={`/dashboard/orders/${note.orderId}`} label={`QR de la orden del remito ${number}`} />
          <figcaption className="max-w-28 text-center text-[11px] leading-tight text-stone-500">Escaneá para ver la trazabilidad</figcaption>
        </figure>
      </header>

      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label="Emisor" value={note.issuer.name} extra={note.issuer.taxId ? `CUIT ${note.issuer.taxId}` : null} />
        <Field label="Destinatario" value={note.recipient.name} extra={note.recipient.address} />
        <Field label="Orden" value={note.order.externalId ?? note.order.id} mono />
        {(note.issuedBy || note.driver) && (
          <Field label="Despacho" value={note.issuedBy ? `Despachó ${note.issuedBy}` : "—"} extra={note.driver ? `Chofer: ${note.driver}` : null} />
        )}
      </dl>

      {/* Pantallas angostas: una tarjeta por pallet. */}
      <ul className="space-y-3 sm:hidden print:hidden" aria-label={`Pallets del remito ${number}`}>
        {note.lines.map((line) => (
          <li key={line.palletCode} className="space-y-2 rounded-xl border border-stone-200 p-3">
            <p className="break-all font-mono text-xs text-slate-950">{line.palletCode}</p>
            <p className="font-semibold text-slate-950">{line.productName} <span className="font-mono text-xs font-normal text-stone-500">{line.productSku}</span></p>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-stone-500">Lote</dt><dd className="break-all font-mono">{line.lotNumber}</dd></div>
              <div><dt className="text-stone-500">Vence</dt><dd>{expiration(line.expirationDate)}</dd></div>
              <div className="text-right"><dt className="text-stone-500">Cantidad</dt><dd className="font-semibold">{quantity(line.quantity, line.unit)}</dd></div>
            </dl>
          </li>
        ))}
      </ul>

      {/* Pantallas anchas e impresión: tabla con columnas fijas; los códigos largos se cortan en vez de desbordar. */}
      <div className="hidden overflow-hidden rounded-xl border border-stone-200 sm:block print:block">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <colgroup>
            <col className="w-[34%]" /><col className="w-[24%]" /><col className="w-[16%]" /><col className="w-[12%]" /><col className="w-[14%]" />
          </colgroup>
          <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Pallet</th>
              <th className="px-3 py-2 font-semibold">Producto</th>
              <th className="px-3 py-2 font-semibold">Lote</th>
              <th className="px-3 py-2 font-semibold">Vence</th>
              <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {note.lines.map((line) => (
              <tr key={line.palletCode} className="border-t border-stone-200 align-top">
                <td className="break-all px-3 py-2 font-mono text-xs">{line.palletCode}</td>
                <td className="break-words px-3 py-2">{line.productName}<span className="block break-all font-mono text-xs text-stone-500">{line.productSku}</span></td>
                <td className="break-all px-3 py-2 font-mono text-xs">{line.lotNumber}</td>
                <td className="px-3 py-2">{expiration(line.expirationDate)}</td>
                <td className="px-3 py-2 text-right font-semibold">{quantity(line.quantity, line.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-right font-semibold text-slate-950">
        {note.lines.length} {note.lines.length === 1 ? "pallet" : "pallets"}{totals}
      </p>

      <footer className="space-y-1 border-t border-stone-200 pt-4 text-xs text-stone-500">
        <p>Documento no válido como factura. No incluye CAI ni CAE.</p>
        <p>Constancia de lo despachado: no se modifica después de emitido.</p>
        {note.backfilled && <p>Generado a partir de los datos de la orden, despachada antes de que existieran los remitos digitales.</p>}
      </footer>
    </article>
  );
}

function Field({ label, value, extra, mono = false }: { label: string; value: string; extra?: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-stone-500">{label}</dt>
      <dd className={`break-words font-semibold text-slate-950${mono ? " break-all font-mono" : ""}`}>{value}</dd>
      {extra && <dd className="break-words text-slate-600">{extra}</dd>}
    </div>
  );
}

function expiration(date: string | null): string {
  return date ? DATE.format(new Date(`${date}T00:00:00Z`)) : "—";
}

function quantity(value: number | null, unit: string): string {
  return value === null ? "—" : `${NUMBER.format(value)} ${unit}`;
}

/** Botón para abrir el remito desde el detalle de la orden (componente aparte, para no tocar el resto de la página). */
export function DispatchNoteLink({ orderId }: { orderId: string }) {
  return <a href={`/dashboard/orders/${orderId}/remito`} className="button-secondary">Ver remito</a>;
}
