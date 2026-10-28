import { consoleCronLogger } from "@/lib/cron/logger";
import { runErpSyncCron } from "@/lib/cron/erp-sync-job";
import { getErpClient } from "@/lib/erp";
import { configuredErpProvider, isErpEnabled } from "@/lib/erp-sync/enabled";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Cron de la sincronización automática con el ERP (TRZ-104). Lo llama pg_cron + pg_net desde Supabase cada
 * 15 minutos con `Authorization: Bearer ${CRON_SECRET}`; sin el secreto responde 401. Ver docs/erp-sync.md.
 */

// Nunca se cachea.
export const dynamic = "force-dynamic";
// Máximo del plan Hobby de Vercel. runErpSyncCron no arranca otra empresa después de 120 s.
export const maxDuration = 300;

export async function GET(request: Request) {
  const result = await runErpSyncCron({
    authorization: request.headers.get("authorization"),
    secret: process.env.CRON_SECRET,
    // isErpEnabled es global hoy (ignora la empresa).
    erpEnabled: () => isErpEnabled(""),
    createDb: () => {
      const supabase = createServiceClient();
      return { rpc: (fn, args) => supabase.rpc(fn, args) };
    },
    getClient: (companyId) => getErpClient(companyId),
    provider: configuredErpProvider(),
    logger: consoleCronLogger,
  });
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
