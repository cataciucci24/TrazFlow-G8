"use client";

import { RouteError } from "@/components/ui/route-error";

export default function Error({ retry }: { retry: () => void }) {
  return <main className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-7 lg:px-10 lg:py-12"><RouteError retry={retry} /></main>;
}
