import { requireUserProfile } from "@/lib/auth/session";
import { LogoutButton } from "@/components/logout-button";

// Etiquetas legibles para cada rol del enum `user_role`.
const ROLE_LABELS = {
  logistics_manager: "Responsable de logística",
  warehouse_operator: "Operador de depósito",
  distributor_operator: "Operador de distribuidor",
} as const;

/**
 * Layout de todas las rutas privadas.
 *
 * La verificación de sesión va acá además del proxy: el proxy hace el chequeo
 * optimista (redirige rápido) y esto garantiza que ninguna página bajo
 * /dashboard se renderice sin usuario y perfil válidos.
 */
export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const profile = await requireUserProfile();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="text-lg font-semibold text-gray-900">TrazFlow</span>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{profile.name}</p>
              <p className="text-xs text-gray-500">
                {ROLE_LABELS[profile.role]}
              </p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
