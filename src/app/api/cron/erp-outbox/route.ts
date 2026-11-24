import { consoleCronLogger } from "@/lib/cron/logger";
import { runErpOutboxCron } from "@/lib/cron/erp-outbox-job";
import { getErpClient } from "@/lib/erp";
import { isErpEnabled, readProvider } from "@/lib/erp-sync/enabled";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Cron del outbox de reportes al ERP (TRZ-104). Lo llama pg_cron + pg_net desde Supabase cada 5 minutos con
 * `Authorization: Bearer ${CRON_SECRET}`; sin el secreto responde 401. Ver docs/erp-integration-panel.md.
 */

// Nunca se cachea: cada llamada procesa lo que esté vencido en ese momento.
export const dynamic = "force-dynamic";
// Máximo del plan Hobby de Vercel. runErpOutboxCron corta por tiempo bastante antes (ver erp-outbox-job.ts).
export const maxDuration = 300;

export async function GET(request: Request) {
  const result = await runErpOutboxCron({
    authorization: request.headers.get("authorization"),
    secret: process.env.CRON_SECRET,
    createDb: () => {
      const supabase = createServiceClient();
      // storage: para adjuntar los remitos firmados (TRZ-103) que el chofer no pudo enviar.
      return { rpc: (fn, args) => supabase.rpc(fn, args), storage: supabase.storage };
    },
    // TRZ-112: empresa por empresa, cada una con su ERP (configuración guardada o, en transición, ERP_ENV_COMPANY_ID).
    erpEnabled: (companyId, db) => isErpEnabled(companyId, (id) => readProvider(db, id)),
    getClient: (companyId) => getErpClient(companyId),
    logger: consoleCronLogger,
  });
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
