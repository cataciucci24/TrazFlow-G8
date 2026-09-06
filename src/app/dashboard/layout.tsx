import { requireUserProfile } from "@/lib/auth/session";
import { LogoutButton } from "@/components/logout-button";

const ROLE_LABELS = {
  logistics_manager: "Responsable de logística",
  warehouse_operator: "Operador de depósito",
  distributor_operator: "Operador de distribuidor",
} as const;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireUserProfile();

  return (
    <div className="relative min-h-screen flex flex-col bg-zinc-950 text-white overflow-x-hidden">
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-red-900/15 blur-3xl pointer-events-none" />
      <div className="absolute right-0 top-1/3 h-96 w-96 rounded-full bg-red-950/10 blur-3xl pointer-events-none" />

      <header className="relative z-15 border-b border-zinc-800/80 bg-zinc-900/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-xl font-extrabold tracking-tight text-white">
            TrazFlow
          </span>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-sm font-medium text-white">{profile.name}</p>
              <p className="text-xs text-red-400 font-medium">
                {ROLE_LABELS[profile.role]}
              </p>
            </div>
            <LogoutButton className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-all hover:bg-zinc-800 hover:text-white shadow-sm" />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
