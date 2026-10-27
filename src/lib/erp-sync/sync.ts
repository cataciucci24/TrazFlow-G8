import "server-only";

import type { ErpClient } from "../erp/client.ts";
import { checkErpDispatchDocuments } from "../erp-outbox/dispatch-documents.ts";
import { ERP_CONTRACT_VERSION, ErpError, isErpError } from "../erp/types.ts";
import { toErpSyncRunSummary, type ErpSyncRunSummary } from "./types.ts";
import { mapErpUnit } from "./units.ts";

/**
 * Lo único que la sincronización necesita de Supabase: llamar RPC. Toda escritura pasa por las funciones
 * erp_sync_* (SECURITY DEFINER), que verifican empresa y rol del usuario de la sesión.
 */
export type ErpSyncDb = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

export type SyncCompanyParams = {
  /** Cliente autenticado como `actorId`: las RPC rechazan cualquier otro usuario. */
  db: ErpSyncDb;
  companyId: string;
  /** Usuario que dispara la sincronización. Queda como triggered_by y como created_by de las órdenes nuevas. */
  actorId: string;
  /** Nombre del proveedor para la auditoría. */
  provider: string;
  /** Se llama dentro de la ejecución: una configuración inválida queda auditada como falla. */
  getClient: () => ErpClient;
};

/** No se pudo abrir la ejecución (permisos, otra en curso, base caída). No queda run auditado. */
export class ErpSyncStartError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = "ErpSyncStartError";
    this.code = code;
  }
}

class ErpSyncStageError extends Error {}

/**
 * Sincroniza depósitos, productos, lotes, saldos de stock y órdenes (con sus líneas) de una empresa desde su ERP.
 *
 * Antes de traer los maestros consulta el estado de los remitos de los despachos ya reportados
 * (checkErpDispatchDocuments, TRZ-100). El orden importa: primero se ve la confirmación del remito y después se
 * trae el saldo, que ya la refleja, así que los pallets despachados se liberan del tope en la misma corrida. Una
 * falla de esa etapa no corta la sincronización: queda auditada y la corrida termina `partial`.
 *
 * Reutilizable desde una Server Action o, más adelante, un cron/webhook: solo depende de `ErpClient` y de las
 * RPC. Las llamadas al ERP se hacen entre RPC, nunca con una transacción abierta. Si el ERP falla, la
 * ejecución se cierra como `failed` (o `partial` si ya se había aplicado algo) con el mensaje sanitizado.
 */
export async function syncCompanyFromErp(params: SyncCompanyParams): Promise<ErpSyncRunSummary> {
  const { db, companyId, actorId } = params;

  const started = await db.rpc("erp_sync_start", {
    p_company_id: companyId,
    p_actor_id: actorId,
    p_provider: params.provider,
  });
  if (started.error || typeof started.data !== "string") {
    throw new ErpSyncStartError(startErrorMessage(started.error?.code), started.error?.code ?? null);
  }
  const runId = started.data;

  const apply = async (fn: string, records: unknown[], what: string) => {
    const { error } = await db.rpc(fn, { p_run_id: runId, p_records: records });
    if (error) throw new ErpSyncStageError(`No se pudieron guardar ${what} en TrazFlow.`);
  };

  let fatal: string | null = null;
  try {
    const erp = params.getClient();

    await checkDispatchDocuments(db, runId, companyId, erp);

    const master = await fromErp("depósitos, productos, lotes y stock", () => erp.pullMasterData());
    assertContract(master.contractVersion);
    // Depósitos primero (TRZ-101): el stock y las órdenes nombran depósitos que tienen que estar importados.
    await apply("erp_sync_apply_warehouses", master.warehouses.map((warehouse) => ({
      externalId: warehouse.externalId,
      name: warehouse.name,
      active: warehouse.active,
    })), "los depósitos");
    await apply("erp_sync_apply_products", master.products.map((product) => ({
      externalId: product.externalId,
      sku: product.sku,
      name: product.name,
      uom: product.uom,
      unit: mapErpUnit(product.uom),
      active: product.active,
    })), "los productos");
    await apply("erp_sync_apply_lots", master.lots.map((lot) => ({
      externalId: lot.externalId,
      productExternalId: lot.productExternalId,
      lotNumber: lot.lotNumber,
      expirationDate: lot.expirationDate,
      active: lot.active,
    })), "los lotes");
    await apply("erp_sync_apply_stock", master.stock.map((balance) => ({
      productExternalId: balance.productExternalId,
      lotExternalId: balance.lotExternalId,
      warehouseExternalId: balance.warehouseExternalId,
      quantity: balance.quantity,
      uom: balance.uom,
      unit: mapErpUnit(balance.uom),
    })), "los saldos de stock");

    const orders = await fromErp("órdenes de despacho", () => erp.pullDispatchOrders());
    orders.forEach((order) => assertContract(order.contractVersion));
    await apply("erp_sync_apply_orders", orders.map((order) => ({
      externalId: order.externalId,
      status: order.status,
      customer: order.customer,
      scheduledDate: order.scheduledDate,
      lines: order.lines.map((line) => ({
        externalId: line.externalId,
        productExternalId: line.productExternalId,
        quantity: line.quantity,
        uom: line.uom,
        unit: mapErpUnit(line.uom),
        warehouseExternalId: line.warehouseExternalId,
      })),
    })), "las órdenes");
  } catch (error) {
    fatal = fatalMessage(error);
  }

  const finished = await db.rpc("erp_sync_finish", { p_run_id: runId, p_error: fatal });
  if (finished.error || !finished.data) {
    throw new Error("No se pudo cerrar la auditoría de la sincronización con el ERP.");
  }
  return toErpSyncRunSummary(finished.data as Parameters<typeof toErpSyncRunSummary>[0]);
}

/** Estado de los remitos (TRZ-100). Lo que falle queda en la auditoría como `dispatch_document`; nunca corta la corrida. */
async function checkDispatchDocuments(db: ErpSyncDb, runId: string, companyId: string, erp: ErpClient): Promise<void> {
  const result = await checkErpDispatchDocuments({ db, companyId, getClient: () => erp });
  const { error } = await db.rpc("erp_sync_save_dispatch_documents", {
    p_run_id: runId,
    p_counters: result.counters,
    p_errors: result.errors,
  });
  if (error) throw new ErpSyncStageError("No se pudo guardar la consulta de remitos en TrazFlow.");
}

async function fromErp<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (isErpError(error)) throw new ErpSyncStageError(`Al leer ${what} del ERP: ${error.message}`);
    throw error;
  }
}

function assertContract(version: unknown) {
  if (version !== ERP_CONTRACT_VERSION) {
    throw new ErpError("invalid_response", `El ERP respondió con la versión de contrato ${String(version)}; TrazFlow espera ${ERP_CONTRACT_VERSION}.`);
  }
}

/** Solo mensajes conocidos y sanitizados llegan a la auditoría; nada de trazas ni datos del proveedor. */
function fatalMessage(error: unknown): string {
  if (error instanceof ErpSyncStageError) return error.message;
  if (isErpError(error)) return error.message;
  return "Error inesperado durante la sincronización.";
}

function startErrorMessage(code: string | undefined): string {
  if (code === "55P03") return "Ya hay una sincronización con el ERP en curso para tu empresa. Esperá a que termine.";
  if (code === "42501") return "Solo logística de la empresa puede sincronizar con el ERP.";
  return "No se pudo iniciar la sincronización con el ERP. Intentá nuevamente.";
}
