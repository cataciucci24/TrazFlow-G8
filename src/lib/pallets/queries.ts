import { createClient } from "@/lib/supabase/server";
import { getExpirationThresholds } from "@/lib/expiration/queries";
import { classifyExpiration } from "@/lib/expiration/thresholds";
import type { ExistingProduct, ExpirationAlert, Lot, Pallet } from "@/lib/types";

/**
 * Fila cruda que devuelve Postgrest al embeber batches/products. El cliente
 * de Supabase no tiene tipos generados (createClient no recibe un genérico
 * Database), así que esta forma es la que observamos en runtime: la relación
 * hacia el lado "uno" de un FK puede llegar como objeto o como array según
 * la versión del cliente, por eso el mapeo defensivo en `mapPalletRow`.
 */
type RawPalletRow = {
  id: string;
  qr_code: string;
  status: Pallet["status"];
  current_location: string | null;
  quantity: number | null;
  unit_of_measure: Pallet["unitOfMeasure"];
  created_at: string;
  batches:
    | { batch_number: string; products: { name: string; sku: string } | { name: string; sku: string }[] | null }
    | { batch_number: string; products: { name: string; sku: string } | { name: string; sku: string }[] | null }[]
    | null;
};

export type StalePallet = Pallet & {
  createdAt: string;
  lastMovementAt: string | null;
  daysWithoutMovement: number;
};

function mapPalletRow(row: RawPalletRow): Pallet {
  const batch = Array.isArray(row.batches) ? row.batches[0] : row.batches;
  const product = batch
    ? Array.isArray(batch.products)
      ? batch.products[0]
      : batch.products
    : null;

  return {
    id: row.id,
    qrCode: row.qr_code,
    status: row.status,
    currentLocation: row.current_location,
    productName: product?.name ?? "—",
    productSku: product?.sku ?? "—",
    batchNumber: batch?.batch_number ?? "—",
    quantity: row.quantity,
    unitOfMeasure: row.unit_of_measure,
  };
}

const PALLET_SELECT =
  "id, qr_code, status, current_location, quantity, unit_of_measure, created_at, batches ( batch_number, products ( name, sku ) )";

/** Pallets de la empresa disponibles para asociar a una orden (en depósito, sin asignar). */
export async function getAvailablePallets(companyId: string): Promise<Pallet[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pallets")
    .select(PALLET_SELECT)
    .eq("company_id", companyId)
    .eq("status", "in_warehouse")
    .order("qr_code");

  if (error) {
    throw new Error(
      `No se pudieron leer los pallets disponibles (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  return (data ?? []).map(mapPalletRow);
}

/** Inventario completo para que logística pueda seguir cada pallet por estado. */
export async function getCompanyPallets(companyId: string): Promise<Pallet[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pallets")
    .select(PALLET_SELECT)
    .eq("company_id", companyId)
    .order("qr_code");

  if (error) {
    throw new Error(`No se pudieron leer los pallets (${error.code}: ${error.message}).`, { cause: error });
  }

  return (data ?? []).map(mapPalletRow);
}

/** Mercadería cuya última actividad supera el umbral indicado, ordenada por antigüedad. */
export async function getStalePallets(
  companyId: string,
  thresholdDays: number,
): Promise<StalePallet[]> {
  const supabase = await createClient();
  const { data: palletData, error: palletError } = await supabase
    .from("pallets")
    .select(PALLET_SELECT)
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });

  if (palletError) {
    throw new Error(`No se pudieron leer los pallets inmovilizados (${palletError.code}: ${palletError.message}).`, { cause: palletError });
  }

  const pallets = (palletData ?? []) as unknown as RawPalletRow[];
  if (pallets.length === 0) return [];

  const palletIds = pallets.map((pallet) => pallet.id);
  const { data: movementData, error: movementError } = await supabase
    .from("movements")
    .select("pallet_id, created_at")
    .in("pallet_id", palletIds)
    .order("created_at", { ascending: false });

  if (movementError) {
    throw new Error(`No se pudo consultar la actividad de los pallets (${movementError.code}: ${movementError.message}).`, { cause: movementError });
  }

  const latestMovementByPallet = new Map<string, string>();
  for (const movement of movementData ?? []) {
    if (!latestMovementByPallet.has(movement.pallet_id)) {
      latestMovementByPallet.set(movement.pallet_id, movement.created_at);
    }
  }

  const now = Date.now();
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return pallets
    .map((row) => {
      const pallet = mapPalletRow(row);
      const lastMovementAt = latestMovementByPallet.get(row.id) ?? null;
      const activityAt = lastMovementAt ?? row.created_at;
      const daysWithoutMovement = Math.max(0, Math.floor((now - new Date(activityAt).getTime()) / millisecondsPerDay));
      return { ...pallet, createdAt: row.created_at, lastMovementAt, daysWithoutMovement };
    })
    .filter((pallet) => pallet.daysWithoutMovement >= thresholdDays)
    .sort((left, right) => right.daysWithoutMovement - left.daysWithoutMovement);
}

/** Pallets ya asociados a una orden de despacho. */
export async function getPalletsForOrder(orderId: string): Promise<Pallet[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_pallets")
    .select(`pallets ( ${PALLET_SELECT} )`)
    .eq("order_id", orderId);

  if (error) {
    throw new Error(
      `No se pudieron leer los pallets de la orden (${error.code}: ${error.message}).`,
      { cause: error },
    );
  }

  return (data ?? [])
    .map((row) => {
      const pallet = row.pallets as unknown as RawPalletRow | RawPalletRow[] | null;
      return Array.isArray(pallet) ? pallet[0] : pallet;
    })
    .filter((pallet): pallet is RawPalletRow => pallet != null)
    .map(mapPalletRow);
}

type RawLotRow = {
  id: string;
  batch_number: string;
  expiration_date: string | null;
  products: { name: string; sku: string } | { name: string; sku: string }[] | null;
};

/**
 * Todos los lotes de la empresa del usuario autenticado. No filtra por
 * company_id explícitamente porque la policy `batches_company` de RLS ya
 * restringe las filas a los lotes de productos de la propia empresa.
 */
export async function getCompanyLots(): Promise<Lot[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("batches")
    .select("id, batch_number, expiration_date, products ( name, sku )")
    .order("batch_number");

  if (error) {
    throw new Error(`No se pudieron leer los lotes (${error.code}: ${error.message}).`, { cause: error });
  }

  return (data as RawLotRow[] ?? []).map((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    return {
      id: row.id,
      batchNumber: row.batch_number,
      expirationDate: row.expiration_date,
      productName: product?.name ?? "—",
      productSku: product?.sku ?? "—",
    };
  });
}

/** Productos disponibles para los formularios de logística. */
export async function getCompanyProducts(companyId: string): Promise<ExistingProduct[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("name, sku")
    .eq("company_id", companyId)
    .order("sku");

  if (error) {
    throw new Error(`No se pudieron leer los productos (${error.code}: ${error.message}).`, { cause: error });
  }

  return (data ?? []) as ExistingProduct[];
}

type RawExpirationBatch = {
  batch_number: string;
  expiration_date: string;
  products: { name: string; sku: string } | { name: string; sku: string }[] | null;
};

type RawExpirationAlertRow = {
  id: string;
  current_location: string | null;
  quantity: number;
  unit_of_measure: ExpirationAlert["unitOfMeasure"];
  batches: RawExpirationBatch | RawExpirationBatch[] | null;
};

type RawDistributorBatchRow = {
  id: string;
  quantity: number;
  batches: RawExpirationBatch | RawExpirationBatch[] | null;
  distributor_product_stocks:
    | { unit_of_measure: ExpirationAlert["unitOfMeasure"]; distributors: { name: string } | { name: string }[] | null }
    | { unit_of_measure: ExpirationAlert["unitOfMeasure"]; distributors: { name: string } | { name: string }[] | null }[]
    | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function dateAtMidnightUtc(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function argentinaToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Mercadería que vence dentro del último nivel de alerta de la empresa: pallets
 * disponibles en depósito y lotes informados por las distribuidoras (TRZ-90).
 * La fecha se filtra desde Supabase y los días restantes se calculan contra el
 * calendario local de la operación para clasificar la urgencia en la interfaz.
 */
export async function getExpirationAlerts(companyId: string): Promise<ExpirationAlert[]> {
  const today = argentinaToday();
  const thresholds = await getExpirationThresholds();
  const maximumDate = new Date(dateAtMidnightUtc(today) + thresholds.upcomingDays * 86_400_000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const [warehouseResult, distributorResult] = await Promise.all([
    supabase
      .from("pallets")
      .select("id, current_location, quantity, unit_of_measure, batches!inner ( batch_number, expiration_date, products ( name, sku ) )")
      .eq("company_id", companyId)
      .eq("status", "in_warehouse")
      .gt("quantity", 0)
      .gte("batches.expiration_date", today)
      .lte("batches.expiration_date", maximumDate),
    supabase
      .from("distributor_batch_stocks")
      .select("id, quantity, batches!inner ( batch_number, expiration_date, products ( name, sku ) ), distributor_product_stocks ( unit_of_measure, distributors ( name ) )")
      .eq("company_id", companyId)
      .gte("batches.expiration_date", today)
      .lte("batches.expiration_date", maximumDate),
  ]);

  if (warehouseResult.error) {
    throw new Error(`No se pudieron leer las alertas de vencimiento (${warehouseResult.error.code}: ${warehouseResult.error.message}).`, { cause: warehouseResult.error });
  }
  // Durante un despliegue la app puede llegar antes que la tabla de TRZ-90: se muestran solo las del depósito.
  if (distributorResult.error && distributorResult.error.code !== "PGRST205") {
    throw new Error(`No se pudieron leer las alertas de vencimiento de distribuidoras (${distributorResult.error.code}: ${distributorResult.error.message}).`, { cause: distributorResult.error });
  }

  function toAlert(
    base: Pick<ExpirationAlert, "id" | "source" | "quantity" | "unitOfMeasure" | "currentLocation">,
    rawBatch: RawExpirationBatch | RawExpirationBatch[] | null,
  ): ExpirationAlert[] {
    const batch = one(rawBatch);
    if (!batch?.expiration_date || !base.unitOfMeasure) return [];
    const product = one(batch.products);
    const daysRemaining = Math.round((dateAtMidnightUtc(batch.expiration_date) - dateAtMidnightUtc(today)) / 86_400_000);
    const urgency = classifyExpiration(daysRemaining, thresholds);
    if (!urgency) return [];
    return [{
      ...base,
      productName: product?.name ?? "—",
      productSku: product?.sku ?? "—",
      batchNumber: batch.batch_number,
      expirationDate: batch.expiration_date,
      daysRemaining,
      urgency,
    }];
  }

  const warehouse = ((warehouseResult.data ?? []) as unknown as RawExpirationAlertRow[]).flatMap((row) => toAlert({
    id: `warehouse-${row.id}`,
    source: "warehouse",
    quantity: row.quantity,
    unitOfMeasure: row.unit_of_measure,
    currentLocation: row.current_location,
  }, row.batches));

  const distributors = ((distributorResult.data ?? []) as unknown as RawDistributorBatchRow[]).flatMap((row) => {
    const stock = one(row.distributor_product_stocks);
    if (!stock) return [];
    return toAlert({
      id: `distributor-${row.id}`,
      source: "distributor",
      quantity: row.quantity,
      unitOfMeasure: stock.unit_of_measure,
      currentLocation: one(stock.distributors)?.name ?? "Distribuidora",
    }, row.batches);
  });

  return [...warehouse, ...distributors].sort((a, b) => a.expirationDate.localeCompare(b.expirationDate));
}
