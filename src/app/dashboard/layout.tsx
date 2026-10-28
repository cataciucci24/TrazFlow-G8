import { requireUserProfile } from "@/lib/auth/session";
import { FeedbackProvider } from "@/components/ui/feedback";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { getCompanyPlan } from "@/lib/plans/queries";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireUserProfile();
  const companyPlan = profile.role === "logistics_manager" ? await getCompanyPlan(profile.companyId) : null;

  return (
    <FeedbackProvider>
      <a href="#main-content" className="skip-link">Ir al contenido</a>
      <div className="min-h-dvh bg-stone-50 text-stone-950 lg:flex">
        <DashboardSidebar role={profile.role} companyPlan={companyPlan} />
        <section className="min-w-0 flex-1 lg:h-dvh lg:overflow-y-auto">
          <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-7 lg:px-10 lg:py-12">{children}</main>
        </section>
      </div>
    </FeedbackProvider>
  );
}
