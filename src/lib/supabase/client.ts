import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente de Supabase para el navegador (Client Components).
 * La sesión se persiste en cookies, así el servidor también puede leerla.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
