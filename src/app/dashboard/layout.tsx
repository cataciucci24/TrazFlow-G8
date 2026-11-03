import { requireUserProfile } from "@/lib/auth/session";
import { FeedbackProvider } from "@/components/ui/feedback";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { InlineAlert } from "@/components/ui/design-system";
import { formatPaymentDate } from "@/lib/plans/payments";
import { getSubscriptionAccess } from "@/lib/plans/payments-query";
import { getCompanyPlan } from "@/lib/plans/queries";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireUserProfile();
  const companyPlan = profile.role === "logistics_manager" ? await getCompanyPlan(profile.companyId) : null;
  const { accessUntil } = await getSubscriptionAccess();

  return (
    <FeedbackProvider>
      <a href="#main-content" className="skip-link">Ir al contenido</a>
      <div className="min-h-dvh bg-stone-50 text-stone-950 lg:flex">
        <DashboardSidebar role={profile.role} companyPlan={companyPlan} />
        <section className="min-w-0 flex-1 lg:h-dvh lg:overflow-y-auto">
          <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-7 lg:px-10 lg:py-12">
            {accessUntil ? <InlineAlert variant="warning" className="mb-6">La suscripción de tu empresa está cancelada. Podés seguir usando TrazFlow hasta el {formatPaymentDate(accessUntil)} inclusive.</InlineAlert> : null}
            {children}
          </main>
        </section>
      </div>
    </FeedbackProvider>
  );
}
