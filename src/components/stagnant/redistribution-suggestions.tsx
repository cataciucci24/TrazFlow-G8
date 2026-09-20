import Link from "next/link";

import { EmptyState, SectionHeader, StatusBadge, TableShell } from "@/components/ui/design-system";
import type { RedistributionSuggestion } from "@/lib/redistribution/suggest";

const NUMBER_FORMATTER = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

export function RedistributionSuggestions({
  suggestions,
  stockSourceAvailable,
}: {
  suggestions: RedistributionSuggestion[];
  stockSourceAvailable: boolean;
}) {
  return (
    <section aria-labelledby="redistribution-title" className="section-stack">
      <SectionHeader
        id="redistribution-title"
        title="Sugerencias de distribución"
        description={<>Considera solo pallets inmovilizados en <em>tus depósitos</em>.</>}
      />

      {!stockSourceAvailable ? (
        <div role="status" className="feedback feedback-warning">Las sugerencias estarán disponibles cuando se aplique la migración de stock en Supabase.</div>
      ) : suggestions.length === 0 ? (
        <div className="surface">
          <EmptyState title="Sin sugerencias por ahora" description="Ninguna distribuidora tiene faltante de productos con pallets inmovilizados en tus depósitos para este umbral." />
        </div>
      ) : (
        <TableShell label="Sugerencias de distribución">
          <table className="data-table min-w-[980px]">
            <thead>
              <tr>
                <th scope="col">Distribuidora</th>
                <th scope="col">Producto</th>
                <th scope="col">Cobertura actual</th>
                <th scope="col">Pallets a enviar</th>
                <th scope="col" className="text-right">Cantidad</th>
                <th scope="col" className="text-right">Cobertura después</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {suggestions.map((suggestion) => (
                <tr key={`${suggestion.distributorName}-${suggestion.productSku}`}>
                  <td className="font-medium">{suggestion.distributorName}</td>
                  <td><p className="font-medium">{suggestion.productName}</p><p className="table-secondary font-mono">{suggestion.productSku}</p></td>
                  <td>
                    <StatusBadge status={suggestion.riskLevel} />
                    <p className="table-secondary">{NUMBER_FORMATTER.format(suggestion.currentStockDays)} días</p>
                  </td>
                  <td>
                    <ul className="space-y-1">
                      {suggestion.pallets.map((pallet) => (
                        <li key={pallet.id}>
                          <Link href={`/dashboard/traceability?qr=${encodeURIComponent(pallet.qrCode)}`} className="table-action font-mono">{pallet.qrCode}</Link>
                        </li>
                      ))}
                    </ul>
                  </td>
                  {suggestion.compatible ? (
                    <>
                      <td className="text-right font-mono">{NUMBER_FORMATTER.format(suggestion.suggestedQuantity ?? 0)} <span className="table-secondary">{suggestion.unitOfMeasure}</span></td>
                      <td className="text-right font-mono font-semibold">{NUMBER_FORMATTER.format(suggestion.stockDaysAfter ?? 0)} días</td>
                    </>
                  ) : (
                    <td colSpan={2} className="text-right text-stone-500">
                      Sin cálculo
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
    </section>
  );
}
