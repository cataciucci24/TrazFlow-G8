import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente de Supabase para el servidor (Server Components, Server Actions y
 * Route Handlers). Hay que crear uno nuevo por request: nunca compartirlo
 * entre requests, porque la sesión vive en las cookies de cada uno.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Los Server Components no pueden escribir cookies. Lo ignoramos
            // porque el proxy (proxy.ts) ya refresca la sesión en cada request.
          }
        },
      },
    },
  );
}
