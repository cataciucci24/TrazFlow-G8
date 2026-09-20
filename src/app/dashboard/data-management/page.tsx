import { redirect } from "next/navigation";

export default async function DataManagementPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view;
  redirect(view === "lotes" ? "/dashboard/lots" : "/dashboard/pallets");
}
