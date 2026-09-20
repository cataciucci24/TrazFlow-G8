import { createClient } from "@/lib/supabase/server";
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

type RawExpirationAlertRow = {
  id: string;
  current_location: string | null;
  quantity: number;
  unit_of_measure: ExpirationAlert["unitOfMeasure"];
  batches:
    | {
        batch_number: string;
        expiration_date: string;
        products: { name: string; sku: string } | { name: string; sku: string }[] | null;
      }
    | {
        batch_number: string;
        expiration_date: string;
        products: { name: string; sku: string } | { name: string; sku: string }[] | null;
      }[]
    | null;
};

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
 * Pallets disponibles que vencen en los próximos 90 días. La fecha se filtra
 * desde Supabase y los días restantes se calculan contra el calendario local
 * de la operación para clasificar la urgencia en la interfaz.
 */
export async function getExpirationAlerts(companyId: string): Promise<ExpirationAlert[]> {
  const today = argentinaToday();
  const maximumDate = new Date(dateAtMidnightUtc(today) + 90 * 86_400_000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pallets")
    .select("id, current_location, quantity, unit_of_measure, batches!inner ( batch_number, expiration_date, products ( name, sku ) )")
    .eq("company_id", companyId)
    .eq("status", "in_warehouse")
    .gt("quantity", 0)
    .gte("batches.expiration_date", today)
    .lte("batches.expiration_date", maximumDate)
    .order("expiration_date", { foreignTable: "batches", ascending: true });

  if (error) {
    throw new Error(`No se pudieron leer las alertas de vencimiento (${error.code}: ${error.message}).`, { cause: error });
  }

  return ((data ?? []) as unknown as RawExpirationAlertRow[])
    .flatMap((row): ExpirationAlert[] => {
      const batch = Array.isArray(row.batches) ? row.batches[0] : row.batches;
      if (!batch?.expiration_date || !row.unit_of_measure) return [];
      const product = Array.isArray(batch.products) ? batch.products[0] : batch.products;
      const daysRemaining = Math.round((dateAtMidnightUtc(batch.expiration_date) - dateAtMidnightUtc(today)) / 86_400_000);
      const urgency = daysRemaining <= 30 ? "critical" : daysRemaining <= 60 ? "warning" : "upcoming";

      return [{
        palletId: row.id,
        productName: product?.name ?? "—",
        productSku: product?.sku ?? "—",
        batchNumber: batch.batch_number,
        quantity: row.quantity,
        unitOfMeasure: row.unit_of_measure,
        currentLocation: row.current_location,
        expirationDate: batch.expiration_date,
        daysRemaining,
        urgency,
      }];
    })
    .sort((a, b) => a.expirationDate.localeCompare(b.expirationDate));
}
