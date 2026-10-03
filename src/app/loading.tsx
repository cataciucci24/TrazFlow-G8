import { LoadingState } from "@/components/ui/design-system";

export default function Loading() {
  return <main className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-7 lg:px-10 lg:py-12"><LoadingState label="Cargando TrazFlow…" skeleton /></main>;
}
