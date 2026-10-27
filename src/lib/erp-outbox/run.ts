import "server-only";

import { getErpClient } from "@/lib/erp";
import { isErpEnabled } from "@/lib/erp-sync/enabled";
import { processErpOutbox, type ErpOutboxDb } from "@/lib/erp-outbox/processor";
import type { ErpOutboxRunSummary } from "@/lib/erp-outbox/types";

/**
 * Procesa los reportes vencidos de una empresa con la sesión del usuario (logística o depósito): las RPC
 * limitan los eventos a su empresa. Se llama después de cada confirmación de despacho, así que manda el
 * reporte recién creado y, de paso, reintenta los que ya cumplieron su backoff.
 *
 * Sin ERP configurado no se envía nada y los eventos quedan pendientes. Nunca lanza: una falla del ERP o de
 * la base no tiene que afectar a quien confirmó el despacho.
 */
export async function processCompanyErpOutbox(params: {
  db: ErpOutboxDb;
  companyId: string;
}): Promise<ErpOutboxRunSummary | null> {
  if (!(await isErpEnabled(params.companyId))) return null;
  try {
    return await processErpOutbox({
      db: params.db,
      getClient: () => getErpClient(params.companyId),
    });
  } catch {
    // processErpOutbox ya dejó el motivo en el log (sin datos sensibles). Los eventos siguen pendientes.
    return null;
  }
}

/**
 * TRZ-103: manda al ERP la entrega y los remitos firmados de una orden apenas el chofer los registra, con la
 * sesión del chofer (las RPC erp_outbox_driver_* lo limitan a los eventos de entrega de esa orden suya). Se
 * llama en un after(): el chofer no espera al ERP. Si el ERP falla, el evento queda con su backoff para los
 * procesadores de siempre. Nunca lanza.
 */
export async function processDriverDeliveryEvents(params: {
  db: ErpOutboxDb;
  companyId: string;
  orderId: string;
}): Promise<ErpOutboxRunSummary | null> {
  if (!(await isErpEnabled(params.companyId))) return null;
  try {
    return await processErpOutbox({
      db: params.db,
      getClient: () => getErpClient(params.companyId),
      driverOrderId: params.orderId,
    });
  } catch {
    return null;
  }
}
