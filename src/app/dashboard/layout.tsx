import { requireUserProfile } from "@/lib/auth/session";
import { DashboardSidebar } from "@/components/dashboard-sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireUserProfile();

  return (
    <div className="min-h-dvh bg-stone-50 text-stone-950 lg:flex">
      <DashboardSidebar role={profile.role} />
      <section className="min-w-0 flex-1 lg:h-dvh lg:overflow-y-auto">
        <main id="main-content" className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-7 lg:px-10 lg:py-12">{children}</main>
      </section>
    </div>
  );
}
