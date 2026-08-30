import type { Metadata } from "next";

import { getUserProfile, hasRole } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Dashboard | TrazFlow",
};

export default async function DashboardPage() {
  // El layout ya garantizó que hay perfil; acá lo leemos del cache del request.
  const profile = await getUserProfile();
  if (!profile) return null;

  // Ejemplo de gating por rol: solo el responsable de logística crea órdenes.
  const canCreateDispatchOrders = hasRole(profile, "logistics_manager");

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">
          Hola, {profile.name}
        </h1>

        {canCreateDispatchOrders && (
          <button
            type="button"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
          >
            Crear orden de despacho
          </button>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-500">
          Acá van a ir las órdenes de despacho de tu empresa.
        </p>
      </div>
    </section>
  );
}
