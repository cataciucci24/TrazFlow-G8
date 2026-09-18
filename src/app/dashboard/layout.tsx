import { requireUserProfile } from "@/lib/auth/session";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { DashboardHeader } from "@/components/dashboard-header";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireUserProfile();

  return (
    <div className="min-h-screen bg-[#faf9f7] text-slate-950 lg:flex">
      <DashboardSidebar role={profile.role} />
      <section className="min-w-0 flex-1 lg:h-screen lg:overflow-y-auto">
        <DashboardHeader />
        <main className="mx-auto w-full max-w-[1120px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">{children}</main>
      </section>
    </div>
  );
}
