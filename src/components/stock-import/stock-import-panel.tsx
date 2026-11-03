"use client";

import { useState, useTransition } from "react";

import { EmptyState, InlineAlert, SectionHeader, TableShell } from "@/components/ui/design-system";
import { confirmStockImport, previewStockImport } from "@/lib/stock-import/actions";
import { IMPORT_COLUMNS, MAX_IMPORT_BYTES, type ImportPreview, type ImportResult, type ImportRowError } from "@/lib/stock-import/rows";

function RowErrors({ errors }: { errors: ImportRowError[] }) {
  if (!errors.length) return null;
  return <section className="section-stack" aria-labelledby="import-errors-title">
    <SectionHeader id="import-errors-title" title="Filas con errores" description="Estas filas no entran. Las demás no se ven afectadas." />
    <TableShell label="Filas con errores" mobileLayout="rows" className="max-h-96 overflow-y-auto">
      <table role="table" aria-label="Filas con errores" className="data-table">
        <thead role="rowgroup"><tr role="row">
          <th role="columnheader" scope="col">Fila</th>
          <th role="columnheader" scope="col">Motivo</th>
        </tr></thead>
        <tbody role="rowgroup">
          {errors.map(error => <tr role="row" key={error.row}>
            <td role="cell" data-label="Fila" className="mobile-primary">{error.row}</td>
            <td role="cell" data-label="Motivo" className="mobile-wide">{error.messages.join(" ")}</td>
          </tr>)}
        </tbody>
      </table>
    </TableShell>
  </section>;
}

export function StockImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Una misma clave para reintentar: la base no vuelve a procesar las filas que ya entraron.
  const [requestId, setRequestId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: File | null) {
    setFile(next); setPreview(null); setResult(null); setRequestId(null);
    setError(next && next.size > MAX_IMPORT_BYTES ? "El archivo supera los 4 MB." : null);
  }

  function review() {
    if (!file) return;
    startTransition(async () => {
      const form = new FormData();
      form.set("file", file);
      const response = await previewStockImport(form).catch(() => ({ error: "No pudimos revisar el archivo. Probá de nuevo." }));
      setResult(null); setRequestId(null);
      if ("error" in response) { setPreview(null); setError(response.error); return; }
      setError(null); setPreview(response); setRequestId(crypto.randomUUID());
    });
  }

  function confirm() {
    if (!file || !requestId) return;
    startTransition(async () => {
      const form = new FormData();
      form.set("file", file);
      form.set("requestId", requestId);
      const response = await confirmStockImport(form).catch(() => ({ error: "No pudimos importar el archivo. Podés reintentar: no se duplica." }));
      if ("error" in response) { setError(response.error); return; }
      setError(null); setResult(response);
      if (!response.unprocessed) setPreview(null);
    });
  }

  const finished = result && !result.unprocessed;
  return <div className="section-stack">
    <section className="surface section-stack p-5 sm:p-6" aria-labelledby="import-file-title">
      <SectionHeader id="import-file-title" title="Archivo" description={`Columnas: ${IMPORT_COLUMNS.map(column => column.header).join(", ")}. Hasta 5.000 filas, en .xlsx o .csv.`}
        action={<a href="/dashboard/inventory/import/template" download className="button-secondary">Descargar plantilla</a>} />
      <label className="block text-sm font-medium text-stone-700">Planilla
        <input type="file" accept=".xlsx,.csv" disabled={pending} className="form-control mt-2"
          onChange={event => choose(event.target.files?.[0] ?? null)} />
      </label>
      <div><button type="button" className="button-primary w-full sm:w-auto" disabled={!file || pending || (file.size > MAX_IMPORT_BYTES)} onClick={review}>
        {pending && !preview ? "Revisando…" : "Revisar archivo"}
      </button></div>
    </section>
    {error ? <InlineAlert variant="danger">{error}</InlineAlert> : null}
    {finished ? <InlineAlert variant={result.imported ? "success" : "warning"}>
      {result.imported === 0 ? "No se importó ninguna fila."
        : result.mode === "erp" ? `${result.imported} de ${result.total} filas enviadas al ERP. Quedan como Stock Entry en borrador y entran a TrazFlow con la sincronización después de confirmarlas ahí. Seguí el envío en Integración ERP.`
        : `${result.imported} de ${result.total} filas importadas como pallets en depósito.`}
    </InlineAlert> : null}
    {result && result.unprocessed ? <InlineAlert variant="warning">{result.imported} filas importadas y {result.unprocessed} sin procesar por una falla. Confirmá de nuevo: las que ya entraron no se duplican.</InlineAlert> : null}
    {result ? <RowErrors errors={result.errors} /> : null}
    {preview && !result ? <>
      <section className="surface section-stack p-5 sm:p-6" aria-labelledby="import-preview-title">
        <SectionHeader id="import-preview-title" title="Vista previa" description={preview.fileName} />
        <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div><dt className="text-stone-500">Filas leídas</dt><dd className="mt-1 text-xl font-bold">{preview.total}</dd></div>
          <div><dt className="text-stone-500">Entran</dt><dd className="mt-1 text-xl font-bold">{preview.validCount}</dd></div>
          <div><dt className="text-stone-500">Con errores</dt><dd className="mt-1 text-xl font-bold">{preview.errors.length}</dd></div>
        </dl>
        {preview.sample.length ? <TableShell label="Primeras filas que entran" mobileLayout="rows">
          <table role="table" aria-label="Primeras filas que entran" className="data-table min-w-[720px]">
            <thead role="rowgroup"><tr role="row">
              {["Fila", "Producto", "SKU", "Lote", "Vencimiento", "Depósito", "Cantidad"].map(title => <th role="columnheader" scope="col" key={title}>{title}</th>)}
            </tr></thead>
            <tbody role="rowgroup">
              {preview.sample.map(row => <tr role="row" key={row.row}>
                <td role="cell" data-label="Fila">{row.row}</td>
                <td role="cell" data-label="Producto" className="mobile-primary">{row.product}</td>
                <td role="cell" data-label="SKU">{row.sku}</td>
                <td role="cell" data-label="Lote">{row.lot}</td>
                <td role="cell" data-label="Vencimiento">{row.expiration}</td>
                <td role="cell" data-label="Depósito">{row.warehouse}</td>
                <td role="cell" data-label="Cantidad">{row.quantity} {row.unit}</td>
              </tr>)}
            </tbody>
          </table>
        </TableShell> : <EmptyState title="Ninguna fila entra" description="Corregí la planilla y volvé a subirla." />}
        {preview.validCount ? <div><button type="button" className="button-primary w-full sm:w-auto" disabled={pending} onClick={confirm}>
          {pending ? "Importando…" : `Confirmar ${preview.validCount} ${preview.validCount === 1 ? "fila" : "filas"}`}
        </button></div> : null}
      </section>
      <RowErrors errors={preview.errors} />
    </> : null}
    {result && result.unprocessed ? <div><button type="button" className="button-primary w-full sm:w-auto" disabled={pending} onClick={confirm}>{pending ? "Importando…" : "Reintentar"}</button></div> : null}
  </div>;
}
