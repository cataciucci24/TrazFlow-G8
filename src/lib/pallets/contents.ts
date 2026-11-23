import type { ProductUnit } from "./units.ts";

/** Contrato de lectura compartido. No sumar cantidades entre unidades distintas. */
export type PalletContent = {
  itemId: string;
  palletId: string;
  companyId: string;
  batchId: string;
  batchNumber: string;
  expirationDate: string | null;
  productId: string;
  productName: string;
  productSku: string;
  unitOfMeasure: ProductUnit;
  quantity: number | null;
  lotSourceSystem: "trazflow" | "erp";
};

export type RawPalletContent = {
  item_id: string;
  pallet_id: string;
  company_id: string;
  batch_id: string;
  batch_number: string;
  expiration_date: string | null;
  product_id: string;
  product_name: string;
  product_sku: string;
  unit_of_measure: ProductUnit;
  quantity: number | null;
  lot_source_system: "trazflow" | "erp";
};

export const PALLET_CONTENT_SELECT = "item_id, pallet_id, company_id, batch_id, batch_number, expiration_date, product_id, product_name, product_sku, unit_of_measure, quantity, lot_source_system";

export function mapPalletContent(row: RawPalletContent): PalletContent {
  return {
    itemId: row.item_id, palletId: row.pallet_id, companyId: row.company_id,
    batchId: row.batch_id, batchNumber: row.batch_number, expirationDate: row.expiration_date,
    productId: row.product_id, productName: row.product_name, productSku: row.product_sku,
    unitOfMeasure: row.unit_of_measure, quantity: row.quantity === null ? null : Number(row.quantity),
    lotSourceSystem: row.lot_source_system,
  };
}

// Interfaz estructural: permite usar el cliente autenticado existente sin crear
// otro cliente ni importar dependencias de servidor en los consumidores puros.
type ContentQuery = PromiseLike<{ data: unknown; error: unknown }> & {
  eq(column: string, value: string): ContentQuery;
  in(column: string, values: string[]): ContentQuery;
  order(column: string): ContentQuery;
  range(from: number, to: number): ContentQuery;
};
export type PalletContentsClient = {
  from(table: string): unknown;
};

/** Lectura por lotes y paginada: no depende del límite de 1.000 filas de PostgREST. RLS sigue vigente. */
export async function getPalletContents(
  db: PalletContentsClient,
  palletIds: readonly string[],
  companyId?: string,
): Promise<Map<string, PalletContent[]>> {
  const ids = [...new Set(palletIds)];
  const result = new Map<string, PalletContent[]>(ids.map((id) => [id, []]));
  for (let start = 0; start < ids.length; start += 100) {
    for (let offset = 0; ; offset += 500) {
      const table = db.from("pallet_contents") as { select(columns: string): ContentQuery };
      let query = table.select(PALLET_CONTENT_SELECT).in("pallet_id", ids.slice(start, start + 100));
      if (companyId) query = query.eq("company_id", companyId);
      const { data, error } = await query.order("pallet_id").order("item_id").range(offset, offset + 499);
      if (error) throw new Error("No se pudo consultar el contenido de los pallets.", { cause: error });
      const rows = (data ?? []) as RawPalletContent[];
      for (const row of rows) result.get(row.pallet_id)?.push(mapPalletContent(row));
      if (rows.length < 500) break;
    }
  }
  return result;
}

export async function attachPalletContents<T extends { id: string }>(
  db: PalletContentsClient, rows: T[],
): Promise<(T & { contents: PalletContent[] })[]> {
  const contents = await getPalletContents(db, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, contents: contents.get(row.id) ?? [] }));
}

export type ExpectedPalletItem = { productId: string; batchId: string; quantity: number | null };
export type ExpectedPalletRelation = { pallet_id: string; expected_items: ExpectedPalletItem[] };
type ContentBatch = {
  id: string; company_id: string; batch_number: string; expiration_date: string | null; source_system: "trazflow" | "erp";
  products: { id: string; name: string; sku: string; unit_of_measure: ProductUnit } | { id: string; name: string; sku: string; unit_of_measure: ProductUnit }[] | null;
};

/** Contenido de ESA orden. Reingresar y editar el pallet nunca cambia sus cantidades históricas. */
export async function attachExpectedPalletContents<T extends ExpectedPalletRelation>(
  db: PalletContentsClient, relations: T[],
): Promise<(T & { contents: PalletContent[] })[]> {
  const ids = [...new Set(relations.flatMap((row) => row.expected_items.map((item) => item.batchId)))];
  const batches = new Map<string, ContentBatch>();
  for (let start = 0; start < ids.length; start += 100) {
    const table = db.from("batches") as { select(columns: string): ContentQuery };
    const { data, error } = await table.select("id, company_id, batch_number, expiration_date, source_system, products ( id, name, sku, unit_of_measure )")
      .in("id", ids.slice(start, start + 100)).order("id").range(0, 99);
    if (error) throw new Error("No se pudo consultar el contenido esperado de los pallets.", { cause: error });
    for (const batch of (data ?? []) as ContentBatch[]) batches.set(batch.id, batch);
  }
  return relations.map((row) => ({ ...row, contents: row.expected_items.flatMap((item) => {
    const batch = batches.get(item.batchId);
    const product = Array.isArray(batch?.products) ? batch.products[0] : batch?.products;
    if (!batch || !product || product.id !== item.productId) return [];
    return [{
      itemId: `${row.pallet_id}:${item.batchId}`, palletId: row.pallet_id, companyId: batch.company_id,
      batchId: batch.id, batchNumber: batch.batch_number, expirationDate: batch.expiration_date,
      productId: product.id, productName: product.name, productSku: product.sku, unitOfMeasure: product.unit_of_measure,
      quantity: item.quantity === null ? null : Number(item.quantity), lotSourceSystem: batch.source_system,
    }];
  }) }));
}
