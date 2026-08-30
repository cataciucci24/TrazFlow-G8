import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (antes `middleware`, renombrado en Next.js 16).
 *
 * Corre antes de renderizar cualquier ruta y cumple dos funciones:
 * 1. Refrescar el token de sesión de Supabase y reescribir las cookies.
 * 2. Chequeo optimista de sesión para redirigir a /login sin llegar a renderizar.
 *
 * OJO: esto NO reemplaza la verificación de sesión dentro de cada Server
 * Component / Server Action (ver `requireUser` en src/lib/auth/session.ts).
 */
export async function proxy(request: NextRequest) {
  // Respuesta base: arranca copiando el request para poder mutar sus cookies.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Headers de no-cache: una respuesta que setea cookies de sesión no
          // debe cachearse, o un CDN podría servirle la sesión a otro usuario.
          for (const [key, headerValue] of Object.entries(headers)) {
            response.headers.set(key, headerValue);
          }
        },
      },
    },
  );

  // getUser() valida el token contra Supabase y, de paso, dispara el refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Sin sesión y pidiendo una ruta privada -> al login.
  if (!user && pathname.startsWith("/dashboard")) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  // Con sesión y parado en el login -> al dashboard.
  // Salvo que venga con ?error=..., que es justamente el caso de una sesión
  // válida que no puede entrar (ej: perfil sin dar de alta en `users`).
  // Sin esta excepción se armaría un loop de redirects con requireUserProfile().
  if (user && pathname === "/login" && !request.nextUrl.searchParams.has("error")) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Todas las rutas menos los estáticos, la optimización de imágenes y los assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
