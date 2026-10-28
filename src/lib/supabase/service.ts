import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Cliente de Supabase con la clave service_role (TRZ-104). Solo para tareas del servidor sin usuario, hoy el
 * cron del outbox y de la sincronización con el ERP (src/app/api/cron/).
 *
 * La clave salta la RLS: nunca va con prefijo NEXT_PUBLIC_, nunca se importa desde un componente cliente
 * (lo verifican los server-boundary.test.ts) y nunca se loguea. Las RPC que usa el cron igual validan que el
 * rol sea service_role y limitan lo que se puede hacer.
 */
export function createServiceClient(env: Record<string, string | undefined> = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el servidor.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
