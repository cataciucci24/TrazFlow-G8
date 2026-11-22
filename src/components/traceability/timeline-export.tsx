"use client";

/**
 * TRZ-59: exportar la línea de tiempo. Excel se descarga del servidor; PDF usa la impresión del navegador
 * ("Guardar como PDF"), que imprime solo el bloque .print-root de la página.
 */
export function TimelineExportActions({ excelHref }: { excelHref: string }) {
  return (
    <div className="no-print flex flex-wrap gap-2">
      <a href={excelHref} className="button-secondary button-sm" download>Exportar Excel</a>
      <button type="button" className="button-secondary button-sm" onClick={() => window.print()}>Exportar PDF</button>
    </div>
  );
}
